"""
app/routes/taf_routes.py
=========================
KPMG Trusted AI Framework taxonomy mapping endpoints.

POST /taf/assess/{ai_name}
  — Compute TAF mapping for the latest audit of a given AI system.
    Optionally accepts a training-data upload ID to unlock training-gated controls.

POST /taf/upload-training/{ai_name}
  — Upload fine-tuning / training data (CSV/XLSX/JSON) for analysis.
    Stores metadata + analysis in training_data_uploads table.
    Returns a training_data_id to pass into /assess.

GET /taf/assessment/{ai_name}
  — Retrieve the latest stored TAF assessment for an AI system.

GET /taf/training-uploads/{ai_name}
  — List all training data uploads for an AI system.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import uuid
from datetime import datetime
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.database import (
    taf_assessments_collection,
    training_uploads_collection,
    blackbox_collection,
    reports_collection,
)
from app.dependencies import get_current_user
from app.services.taf.taxonomy_mapper import (
    compute_taf_mapping,
    analyse_training_data,
    detect_ai_category,
)

router  = APIRouter()
logger  = logging.getLogger(__name__)

MAX_TRAINING_BYTES = 50 * 1024 * 1024  # 50 MB


# ── Helpers ────────────────────────────────────────────────────────────────────

def _owner_id(user) -> str:
    return str(user.get("id") or user.get("_id"))


def _get_latest_audit(ai_name: str, owner_id: str) -> Optional[dict]:
    """Return the most recent blackbox audit for this AI+owner."""
    from app.database import blackbox_collection
    return blackbox_collection.find_one(
        {"ai_name": ai_name, "owner_id": owner_id}, sort=[("created_at", -1)]
    )


def _get_latest_report(ai_name: str, owner_id: str) -> Optional[dict]:
    """Return the most recent SDCC/evaluate report for this AI+owner."""
    from app.database import reports_collection
    return reports_collection.find_one(
        {"ai_name": ai_name, "owner_id": owner_id}, sort=[("created_at", -1)]
    )


def _parse_upload(file: UploadFile) -> list[dict]:
    """Parse CSV/XLSX/JSON training file into list of dicts."""
    raw = file.file.read()
    fname = (file.filename or "").lower()

    if fname.endswith(".json"):
        data = json.loads(raw.decode("utf-8"))
        return data if isinstance(data, list) else list(data.values())

    if fname.endswith((".xlsx", ".xls")):
        df = pd.read_excel(io.BytesIO(raw))
    else:
        # CSV (default)
        try:
            df = pd.read_csv(io.BytesIO(raw))
        except Exception:
            df = pd.read_csv(io.BytesIO(raw), encoding="latin-1")

    df = df.where(pd.notnull(df), None)
    return df.to_dict(orient="records")


# ── Upload training / fine-tuning data ────────────────────────────────────────

@router.post("/upload-training/{ai_name}")
async def upload_training_data(
    ai_name:     str,
    upload_type: str = Form("fine_tuning"),   # fine_tuning | training | eval
    file:        UploadFile = File(...),
    current_user = Depends(get_current_user),
):
    """
    Upload fine-tuning or training data CSV/XLSX/JSON for bias and quality analysis.
    Returns training_data_id to use in /assess.
    """
    owner_id = _owner_id(current_user)

    # Size check
    raw = await file.read()
    if len(raw) > MAX_TRAINING_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Training file too large ({len(raw)//1024//1024} MB). Max 50 MB.",
        )
    # Reset for parsing
    file.file = io.BytesIO(raw)

    file_hash = hashlib.sha256(raw).hexdigest()

    # Parse
    try:
        records = _parse_upload(file)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not parse training file: {exc}")

    if not records:
        raise HTTPException(status_code=422, detail="Training file appears empty.")

    # Analyse
    analysis = analyse_training_data(records, file.filename or "training_data")

    doc_id = uuid.uuid4()
    training_uploads_collection.insert_one({
        "id":              doc_id,
        "ai_name":         ai_name,
        "owner_id":        owner_id,
        "filename":        file.filename,
        "file_hash":       file_hash,
        "file_size_bytes": len(raw),
        "upload_type":     upload_type,
        "row_count":       len(records),
        "analysis":        analysis,
        "column_names":    list((records[0] or {}).keys()) if records else [],
        "sample_rows":     records[:5],
        "status":          "analysed",
        "created_at":      datetime.utcnow(),
    })

    return {
        "training_data_id": str(doc_id),
        "filename":         file.filename,
        "row_count":        len(records),
        "upload_type":      upload_type,
        "analysis_summary": {
            "representation_score": analysis.get("representation_score"),
            "deduplication_rate":   analysis.get("deduplication_rate"),
            "pii_exposure_rate":    analysis.get("pii_exposure_rate"),
            "compute_size_proxy":   analysis.get("compute_size_proxy"),
        },
        "azure_note": analysis.get("azure_note"),
    }


# ── Compute TAF assessment ─────────────────────────────────────────────────────

class AssessRequest(BaseModel):
    training_data_id: Optional[str] = None   # optional training upload ID

@router.post("/assess/{ai_name}")
def compute_taf_assessment(
    ai_name:     str,
    payload:     AssessRequest,
    current_user = Depends(get_current_user),
):
    """
    Compute (or recompute) the TAF taxonomy mapping for the latest audit
    of this AI system. Optionally factor in uploaded training data.
    """
    owner_id = _owner_id(current_user)

    # ── Fetch audit data ──────────────────────────────────────────────────────
    audit  = _get_latest_audit(ai_name, owner_id)
    report = _get_latest_report(ai_name, owner_id)

    if not audit and not report:
        raise HTTPException(
            status_code=404,
            detail="No audit or report found for this AI system. Run a blackbox audit or evaluation first.",
        )

    # ── Detect AI category from model_type ────────────────────────────────────
    model_type  = str(report.get("model_type") if report else "") or str(audit.get("model_type") if audit else "") or ""
    ai_category = detect_ai_category(model_type)

    # ── Training data ─────────────────────────────────────────────────────────
    training_analysis = None
    training_data_id  = None

    if payload.training_data_id:
        td = training_uploads_collection.find_one({"id": payload.training_data_id})
        if not td:
            raise HTTPException(status_code=404, detail="Training data upload not found.")
        training_analysis = td.get("analysis")
        training_data_id  = payload.training_data_id

    # ── Compute mapping ───────────────────────────────────────────────────────
    result = compute_taf_mapping(
        audit_result      = audit or {},
        report_result     = report,
        training_analysis = training_analysis,
        ai_category       = ai_category,
    )

    # ── Persist ───────────────────────────────────────────────────────────────
    audit_id = str(audit.get("audit_id") if audit else report.get("report_id", ""))

    taf_assessments_collection.update_one(
        {"ai_name": ai_name, "owner_id": owner_id},
        {"$set": {
            "audit_id":         audit_id,
            "ai_name":          ai_name,
            "owner_id":         owner_id,
            "ai_category":      ai_category,
            "rows":             result["rows"],
            "summary":          result["summary"],
            "has_training_data": bool(training_analysis),
            "training_data_id": training_data_id,
            "updated_at":       datetime.utcnow(),
        }},
        upsert=True,
    )

    return result


# ── Retrieve stored assessment ─────────────────────────────────────────────────

@router.get("/assessment/{ai_name}")
def get_taf_assessment(
    ai_name:     str,
    current_user = Depends(get_current_user),
):
    """Return the stored TAF assessment for this AI system (latest)."""
    owner_id = _owner_id(current_user)
    doc = taf_assessments_collection.find_one({"ai_name": ai_name, "owner_id": owner_id})
    if not doc:
        raise HTTPException(
            status_code=404,
            detail="No TAF assessment found. Run POST /taf/assess/{ai_name} first.",
        )
    # Serialise datetime
    if isinstance(doc.get("created_at"), datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    if isinstance(doc.get("updated_at"), datetime):
        doc["updated_at"] = doc["updated_at"].isoformat()
    return doc


# ── List training uploads ──────────────────────────────────────────────────────

@router.get("/training-uploads/{ai_name}")
def list_training_uploads(
    ai_name:     str,
    current_user = Depends(get_current_user),
):
    owner_id = _owner_id(current_user)
    docs = training_uploads_collection.find({"ai_name": ai_name, "owner_id": owner_id})
    for d in docs:
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
        d.pop("sample_rows", None)  # don't return raw rows in list
    return {"ai_name": ai_name, "uploads": docs}


# ── Merged view: taxonomy controls + sub-parameters, grouped by principle ─────

@router.get("/detailed/{ai_name}")
def get_detailed_taf(ai_name: str, current_user=Depends(get_current_user)):
    """
    Consolidated per-principle view combining:
      - TAF taxonomy controls (from taf_assessments)
      - Sub-parameter scores (from reports.trusted_ai_principles)
      - The engine tier used (ml vs heuristic) for honesty
    Returns principles[] each with: score, sub_parameters[], controls[], why_not_computed[]
    """
    owner_id = str(current_user.get("id") or current_user.get("_id"))

    # Pull stored TAF assessment
    taf = taf_assessments_collection.find_one({"ai_name": ai_name, "owner_id": owner_id})
    # Pull latest report for sub-parameter scores.
    # NOTE: engine_status is deliberately NOT selected here — it's not a real
    # column on `reports` (see database.py: the table has no "extra"/overflow
    # column, so PgCollection.insert_one silently drops it on save; it was
    # never actually persisted). It's also not per-report data at all — it's
    # a static snapshot of which ML libs (VADER/textstat/detoxify/presidio)
    # are installed on *this server*, computed fresh with no arguments. So we
    # just call it directly, exactly like ai_routes.py does at insert time.
    from app.database import reports_collection
    rep_doc = reports_collection.find_one(
        {"ai_name": ai_name, "owner_id": owner_id}, sort=[("created_at", -1)]
    )
    rep = (rep_doc.get("trusted_ai_principles"), rep_doc.get("model_type")) if rep_doc else None

    if not taf and not rep:
        raise HTTPException(status_code=404, detail="No assessment yet. Run a Governance Evaluation first.")

    import json as _json
    principles_data = {}
    if rep and rep[0]:
        tap = rep[0] if isinstance(rep[0], dict) else _json.loads(rep[0])
        principles_data = tap or {}
    try:
        from app.services.sdcc.analysis_engines import engine_status as _engine_status_fn
        engine_status = _engine_status_fn()
    except Exception:
        engine_status = {}

    # ── Fallback: no stored TAF assessment yet (e.g. no Blackbox Audit has
    # been run for this AI system). Rather than showing a blank/partial
    # taxonomy, build the view straight from the static 133-control
    # taxonomy so *every* control, in *every* principle, is always visible
    # — correctly flagged as "not yet computed" with a concrete reason.
    if taf and taf.get("rows"):
        taf_rows          = taf.get("rows", []) or []
        ai_category       = taf.get("ai_category", "GAI")
        has_training_data = taf.get("has_training_data", False)
    else:
        from app.services.taf.taxonomy_mapper import TAXONOMY, detect_ai_category as _detect_cat
        model_type  = (rep[1] if rep else None) or "general_llm"
        ai_category = _detect_cat(model_type)
        taf_rows = []
        for row in TAXONOMY:
            if row["category"] != ai_category:
                continue
            base_mapped = row["mapped"]
            computed_status = "N/A" if base_mapped == "N/A" else "Not Covered"
            reason = None
            if computed_status == "Not Covered":
                if row.get("training_gated"):
                    reason = row.get("data_required") or "Training / fine-tuning data has not been provided."
                else:
                    reason = (
                        "No audit has been run yet for this AI system. Run a Blackbox Audit "
                        "or Governance Evaluation to compute this control."
                        if (row.get("data_required") or "None") == "None"
                        else row.get("data_required")
                    )
            taf_rows.append({
                "numbered_id":     row["numbered_id"],
                "category":        row["category"],
                "category_full":   row["category_full"],
                "pillar":          row["pillar"],
                "risk":            row["risk"],
                "test":            row.get("test"),
                "base_mapped":     base_mapped,
                "computed_status": computed_status,
                "evidence":        None,
                "score":           None,
                "training_gated":  row.get("training_gated", False),
                "where":           row.get("where"),
                "data_required":   reason,
                "confidence_note": row.get("confidence_note"),
            })
        has_training_data = False

    # Group taxonomy controls by pillar
    controls_by_pillar = {}
    for row in taf_rows:
        controls_by_pillar.setdefault(row["pillar"], []).append(row)

    PILLARS = ["Fairness","Explainability","Data Integrity","Security","Privacy",
               "Transparency","Accountability","Reliability","Safety","Sustainability"]

    out_principles = []
    for pillar in PILLARS:
        pdata = principles_data.get(pillar, {})
        # Report stores sub-params under "parameters" as {name: float_0_to_1}
        sub_params = pdata.get("parameters", {}) or pdata.get("sub_parameters", {}) or {}
        sp_list = []
        for name, val in sub_params.items():
            if name in ("score","band","sample_size_warning","description"):
                continue
            score = val.get("score") if isinstance(val, dict) else val
            # Normalise 0-1 floats to 0-100
            if score is not None and score <= 1.0:
                score = round(score * 100, 1)
            sp_list.append({"name": name, "score": score})

        controls = controls_by_pillar.get(pillar, [])

        # Build "why not computed" reasons
        why_not = []
        for c in controls:
            if c["computed_status"] == "Not Covered":
                if c.get("training_gated"):
                    why_not.append({
                        "control": c["numbered_id"],
                        "reason": "Training / fine-tuning data not provided.",
                        "fix": "Upload training data in the audit pipeline to compute this control.",
                    })
                else:
                    why_not.append({
                        "control": c["numbered_id"],
                        "reason": c.get("data_required") or "Requires data outside current audit scope.",
                        "fix": "This control needs infrastructure or data access not available from external probing.",
                    })

        out_principles.append({
            "pillar":          pillar,
            "score":           pdata.get("score"),
            "band":            pdata.get("band"),
            "sub_parameters":  sp_list,
            "controls":        controls,
            "why_not_computed": why_not,
            "control_count":   len(controls),
            "covered_count":   sum(1 for c in controls if c["computed_status"] == "Covered"),
        })

    # Prefer the stored summary (has real coverage_pct maths incl. Training
    # Unlocked weighting); fall back to a fresh count over taf_rows so the
    # pre-audit view still shows accurate totals instead of zeros.
    summary = (taf or {}).get("summary") or {}
    if not summary:
        covered_n  = sum(1 for r in taf_rows if r["computed_status"] == "Covered")
        partial_n  = sum(1 for r in taf_rows if r["computed_status"] == "Partial")
        no_n       = sum(1 for r in taf_rows if r["computed_status"] == "Not Covered")
        unlocked_n = sum(1 for r in taf_rows if r["computed_status"] == "Training Unlocked")
        na_n       = sum(1 for r in taf_rows if r["computed_status"] == "N/A")
        total_n    = len(taf_rows)
        denom      = max(total_n - na_n, 1)
        summary = {
            "covered": covered_n, "partial": partial_n, "not_covered": no_n,
            "training_unlocked": unlocked_n, "na": na_n, "total": total_n,
            "coverage_pct": round((covered_n + partial_n * 0.5 + unlocked_n) / denom * 100, 1),
        }

    return {
        "ai_name":       ai_name,
        "ai_category":   ai_category,
        "summary":       summary,
        "engine_status": engine_status,
        "principles":    out_principles,
        "has_training_data": has_training_data,
        "audit_run":     bool(taf and taf.get("rows")),
    }


# ── Excel export: reference taxonomy + live model-specific metrics/tests ──────

@router.get("/export/{ai_name}")
def export_taf_excel(ai_name: str, current_user=Depends(get_current_user)):
    """
    Downloadable workbook with:
      Sheet 1 "Reference Taxonomy" — the static 133-control KPMG TAF mapping.
      Sheet 2 "Model Assessment"   — this AI system's live, per-control
        computed status/score/test/evidence, and for anything not computed,
        the concrete reason (e.g. "training data not given") plus how to fix it.

    If no audit has been run yet, sheet 2 still lists all 133 controls with
    status "Not Covered" and an explicit reason, rather than being empty.
    """
    from fastapi.responses import StreamingResponse
    from app.services.taf.excel_export import build_taf_workbook, workbook_to_bytes

    owner_id = _owner_id(current_user)
    taf = taf_assessments_collection.find_one({"ai_name": ai_name, "owner_id": owner_id})

    if taf and taf.get("rows"):
        mapping = {
            "rows": taf.get("rows", []),
            "summary": taf.get("summary", {}),
        }
        audit_run = True
    else:
        # Build the same "pending" view used by /detailed so the sheet is
        # never empty — every control shown, correctly marked not-computed.
        audit = _get_latest_audit(ai_name, owner_id)
        report = _get_latest_report(ai_name, owner_id)
        model_type = (report or {}).get("model_type") or "general_llm"
        ai_category = detect_ai_category(model_type)
        if audit:
            mapping = compute_taf_mapping(
                audit_result=audit, report_result=report, ai_category=ai_category,
            )
            audit_run = True
        else:
            from app.services.taf.taxonomy_mapper import TAXONOMY
            rows = []
            for row in TAXONOMY:
                if row["category"] != ai_category:
                    continue
                status = "N/A" if row["mapped"] == "N/A" else "Not Covered"
                rows.append({**row, "numbered_id": row["numbered_id"], "computed_status": status,
                             "score": None, "evidence": None})
            mapping = {"rows": rows, "summary": {}}
            audit_run = False

    wb = build_taf_workbook(ai_name, mapping, audit_run=audit_run)
    data = workbook_to_bytes(wb)
    filename = f"TrustShield_TAF_{ai_name}.xlsx".replace(" ", "_")
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )