from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.database import ai_collection, reports_collection, sdcc_collection
from app.dependencies import get_current_user
from app.services.sdcc.models import get_evaluator
from app.services.sdcc.orchestrator import run_sdcc_pipeline
from app.services.sdcc.metrics_calculator import calculate_metrics
from app.services.sdcc.llm_judge import run_llm_judge

router = APIRouter()

# ── Schemas ────────────────────────────────────────────────────────────────────

class ConnectorSchema(BaseModel):
    type: str
    endpoint: str
    headers: Dict[str, Any] = {}


# ── Approach 3: Enriched Registration Profile ──────────────────────────────────
# Captured once at registration — low friction, high payoff.
# These axes transform probe relevance dramatically (jurisdiction, user type,
# decision stakes, data sensitivity).

class RegistrationProfileSchema(BaseModel):
    # ── Who uses the agent ─────────────────────────────────────────────────
    end_users: Optional[str] = ""
    # e.g. "Internal Employees", "External Customers (B2C)", "Healthcare Professionals"

    # ── How it makes decisions ─────────────────────────────────────────────
    decision_influence: Optional[str] = ""
    # e.g. "Informational only", "Recommendations", "Approvals", "Automated actions"

    # ── What data it handles ───────────────────────────────────────────────
    data_types: Optional[List[str]] = []
    # multi-select: ["Personal Identifiable Information (PII)", "Financial data",
    #                "Medical / health records", "Legal documents", "Biometric data", "None"]

    jurisdictions: Optional[List[str]] = []
    # e.g. ["European Union (GDPR / EU AI Act)", "United States (CCPA / HIPAA / NIST)"]
    # affects which bias dimensions and regulations are applied to probes

    # ── Deployment context ─────────────────────────────────────────────────
    deployment_status: Optional[str] = ""
    # e.g. "Production — full deployment", "Pilot — limited live users"

    real_time_data: Optional[str] = ""
    # freeform: "Queries customer CRM, weather API, internal knowledge base"
    # maps to fingerprinter "data_access" dimension

    autonomous_actions: Optional[str] = ""
    # freeform: "Books appointments, sends confirmation emails, modifies records"
    # maps to fingerprinter "autonomous_actions" dimension — activates agentic safety probes

    output_visibility: Optional[str] = ""
    # e.g. "External — end-user / customer facing", "Internal only"

    # ── Governance ────────────────────────────────────────────────────────
    oversight_model: Optional[str] = ""
    # e.g. "Human-in-the-loop for every decision", "Fully automated — no human review"
    # directly affects Accountability and Safety TAF scores

    highest_stakes_failure: Optional[str] = ""
    # freeform one sentence: "Misclassifies fraud as legitimate", "Misdiagnosis in triage"
    # maps to fingerprinter "refusals" dimension — generates targeted adversarial probes

    bias_tested: Optional[str] = ""
    # e.g. "Yes — formal bias audit completed", "No — not yet tested for bias"
    # affects Fairness scoring context

    # ── Build provenance (feeds the Code & Build Risk tab) ─────────────────
    # Set on the "Built with AI code-gen tools?" step in RegisterAi.tsx.
    # build_risk.py reads these to decide whether the build-risk checks are
    # applicable and to populate the section's context block.
    ai_generated: Optional[str] = ""
    # "Yes" | "Partially" | "No" | "Unknown"
    ai_codegen_tools: Optional[str] = ""
    # freeform: "Cursor, Copilot, Claude Code, Lovable, v0"
    human_review_gate: Optional[str] = ""
    # "Yes" | "No" | "Unknown"

    # ── TAF applicable risk categories ────────────────────────────────────
    # Registered at onboarding. GAI is always included (every system we audit
    # produces generative text outputs). The user selects which additional
    # categories apply based on what the AI system does:
    #   PAI  — Predictive AI (classification, scoring, forecasting)
    #   PD   — Pattern Discovery (clustering, anomaly detection, segmentation)
    #   DM   — Decision-Making / Agentic AI (autonomous decisions, agents)
    #   DP   — Data Personalisation (recommendation, content personalisation)
    # The taxonomy_mapper uses this list instead of the single auto-detected
    # category so that controls from all applicable categories are evaluated.
    taf_applicable_categories: Optional[List[str]] = []

    # ── Legacy / system prompt (kept for backward compat) ─────────────────
    system_prompt: Optional[str] = ""
    # Prefer providing system_prompt at the top AISystemSchema level.
    # Kept here for existing records that stored it nested in the profile.


class AISystemSchema(BaseModel):
    name:        str
    description: str
    domain:      str
    # connector is now a stub at registration time — type and endpoint will be
    # empty strings, headers will be {}.  Real credentials are entered per-audit
    # in the Dashboard and never persisted.
    connector:   ConnectorSchema
    # Enriched deployment and governance profile — feeds the behavioral fingerprinter,
    # probe generator, and LLM Judge panel.
    profile: Optional[RegistrationProfileSchema] = None


# ── Register AI system ─────────────────────────────────────────────────────────

@router.post("/register-ai")
def register_ai_system(ai_data: AISystemSchema, current_user=Depends(get_current_user)):
    existing = ai_collection.find_one({
        "name":     ai_data.name,
        "owner_id": str(current_user["_id"]),
    })
    if existing:
        raise HTTPException(status_code=400, detail="AI system already registered.")

    doc = {
        "name":        ai_data.name,
        "description": ai_data.description,
        "domain":      ai_data.domain,
        # Connector may be a stub (type="", endpoint="") when registered from
        # the new flow — credentials are provided per-audit via the Dashboard.
        # Still stored so the field is always present for existing code paths.
        "connector":   ai_data.connector.dict(),
        "owner_id":    str(current_user["_id"]),
        "created_at":  datetime.utcnow(),
        "status":      "active",
        "audit_runs":  0,
    }

    if ai_data.profile:
        profile_dict = ai_data.profile.dict()

        # Hoist system_prompt to top level so _get_ai_context() finds it
        # without needing to dig into registration_profile.
        if profile_dict.get("system_prompt"):
            doc["system_prompt"] = profile_dict["system_prompt"]

        # Hoist taf_applicable_categories to a top-level column for easy
        # querying.  GAI is always included; the rest come from the profile.
        raw_cats = profile_dict.get("taf_applicable_categories") or []
        doc["taf_applicable_categories"] = list({"GAI"} | set(raw_cats))

        doc["registration_profile"] = profile_dict

    ai_collection.insert_one(doc)
    return {"message": "AI system registered successfully"}


# ── Update registration profile (standalone endpoint) ─────────────────────────
# Allows updating just the profile without re-registering the full AI system.

@router.patch("/register-ai/{ai_name}/profile")
def update_registration_profile(
    ai_name:  str,
    profile:  RegistrationProfileSchema,
    current_user=Depends(get_current_user),
):
    result = ai_collection.update_one(
        {"name": ai_name, "owner_id": str(current_user["_id"])},
        {"$set": {"registration_profile": profile.dict(), "profile_updated_at": datetime.utcnow()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="AI system not found.")
    return {"message": "Registration profile updated successfully."}


# ── List AI systems ────────────────────────────────────────────────────────────

@router.get("/ai-systems")
def list_ai_systems(current_user=Depends(get_current_user)):
    systems = list(ai_collection.find(
        {"owner_id": str(current_user["_id"])},
        {"_id": 0, "connector.headers": 0},
    ))
    for s in systems:
        if isinstance(s.get("created_at"), datetime):
            s["created_at"] = s["created_at"].isoformat()
    return {"systems": systems}


# ── Helper: persist individual log rows to probe_logs table ──────────────────────

def _save_ingested_rows_to_probe_logs(
    ai_name:  str,
    owner_id: str,
    scan_id:  str,
    records:  list,
    log_type: str = "uploaded_log",
) -> None:
    """
    Fan-out each row from an ingested log file/chat into the probe_logs table so
    every input/output pair is queryable and auditable individually in Postgres.

    Silently swallows per-row errors so a bad row never crashes the upload.
    Null bytes are stripped via the database layer's _strip_nulls().
    """
    import logging as _logging
    _log = _logging.getLogger(__name__)

    from app.database import probe_logs_collection

    saved = 0
    for i, rec in enumerate(records):
        try:
            # Resolve column aliases — SDCC normalises these but raw uploads vary
            task_id  = str(rec.get("task_id") or rec.get("uid") or rec.get("id") or f"{log_type}-{i+1}")
            inp      = str(rec.get("input")   or rec.get("prompt")   or rec.get("query")    or "")
            out      = str(rec.get("output")  or rec.get("response") or rec.get("answer")   or "")
            latency  = float(rec.get("latency") or rec.get("latency_ms") or rec.get("duration") or 0)

            # Carry any extra columns into the JSONB extra field
            known = {"task_id", "uid", "id", "input", "prompt", "query",
                     "output", "response", "answer", "latency", "latency_ms", "duration"}
            extra = {k: v for k, v in rec.items() if k not in known}

            probe_logs_collection.insert_one({
                "audit_id":   scan_id,
                "ai_name":    ai_name,
                "log_type":   log_type,
                "mode":       "ingested",
                "task_id":    task_id,
                "input":      inp,
                "output":     out,
                "latency_ms": latency,
                "extra":      {"owner_id": owner_id, **extra} if extra else {"owner_id": owner_id},
            })
            saved += 1
        except Exception as exc:
            _log.warning("[ingest] Skipped row %d for probe_logs: %s", i, exc)

    _log.info("[ingest] %d/%d rows saved to probe_logs (ai=%s, scan=%s)", saved, len(records), ai_name, scan_id)


# ── Ingest logs (primary upload) ───────────────────────────────────────────────

@router.post("/sdcc/ingest/{ai_name}")
async def ingest_logs(
    ai_name: str,
    file: UploadFile = File(...),
    merge: bool = False,
    current_user=Depends(get_current_user),
):
    """
    Universal log ingestor.
    Accepts CSV, JSON, JSONL, Excel (.xlsx/.xls), SQL dump (.sql), TSV, Parquet.
    Normalises columns, saves ALL rows to probe_logs (Postgres), and stores
    only metadata + 10-row preview in sdcc_results.
    """
    from app.services.sdcc.log_normaliser import ingest_logs_to_postgres
    from app.services.sdcc.detector import detect_model_type

    owner_id = str(current_user.get("id") or current_user.get("_id"))
    scan_id  = str(uuid.uuid4())

    # Read file content
    content = await file.read()
    filename = file.filename or "upload.csv"

    # Ingest to Postgres
    ingest_result = ingest_logs_to_postgres(
        filename=filename,
        content=content,
        ai_name=ai_name,
        owner_id=owner_id,
        scan_id=scan_id,
        merge=merge,
    )

    # Detect model type from column structure + registration context
    ai_doc = ai_collection.find_one(
        {"name": ai_name, "owner_id": owner_id},
        {"description": 1, "domain": 1, "_id": 0},
    ) or {}
    import io, pandas as pd
    try:
        sample_df = pd.DataFrame(ingest_result.get("sample_records", []))
        model_type, det_conf = detect_model_type(
            sample_df,
            ai_description=ai_doc.get("description", ""),
            ai_domain=ai_doc.get("domain", ""),
        ) if not sample_df.empty else ("general_llm", 0.5)
    except Exception:
        model_type, det_conf = "general_llm", 0.5

    # Save metadata + 10-row preview to sdcc_results (NOT the full log)
    sdcc_collection.update_one(
        {"ai_name": ai_name, "owner_id": owner_id},
        {"$set": {
            "ai_name":            ai_name,
            "owner_id":           owner_id,
            "scan_id":            scan_id,
            "model_type":         model_type,
            "det_conf":           det_conf,
            "logs_ingested":      ingest_result["logs_ingested"],
            "column_warnings":    ingest_result["column_warnings"],
            "sample_records":     ingest_result["sample_records"],  # 10-row preview only
            "source_file":        filename,
            "has_task_id_col":    ingest_result["has_task_id_col"],
            "has_input_col":      ingest_result["has_input_col"],
            "has_output_col":     ingest_result["has_output_col"],
            "has_latency_col":    ingest_result["has_latency_col"],
            "schema_complete":    ingest_result["schema_complete"],
            "data_quality_score": 80.0 if ingest_result["schema_complete"] else 50.0,
            "updated_at":         datetime.utcnow(),
        }},
        upsert=True,
    )

    return {
        "logs_ingested":   ingest_result["logs_ingested"],
        "total_parsed":    ingest_result["total_parsed"],
        "dupes_skipped":   ingest_result.get("dupes_skipped", 0),
        "model_type":      model_type,
        "schema_complete": ingest_result["schema_complete"],
        "column_warnings": ingest_result["column_warnings"],
        "column_names":    ingest_result["column_names"],
        "source_file":     filename,
        "merged":          merge,
        "data_quality_score": 80.0 if ingest_result["schema_complete"] else 50.0,
        "structural_risk": "Low" if ingest_result["schema_complete"] else "Medium",
    }


# ── Ingest chat history text ───────────────────────────────────────────────────

class ChatHistoryRequest(BaseModel):
    text: str
    source: str = ""

@router.post("/sdcc/ingest-chat/{ai_name}")
def ingest_chat_history(
    ai_name: str,
    payload: ChatHistoryRequest,
    current_user=Depends(get_current_user),
):
    import re, io, time

    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="No text provided.")

    pairs: list[dict] = []
    blocks = re.split(r'\n(?=You\n|ChatGPT\n|Assistant\n|Claude\n|Gemini\n|Human\n|AI\n)', text)
    if len(blocks) >= 2:
        i = 0
        while i < len(blocks) - 1:
            user_block = blocks[i].strip()
            ai_block   = blocks[i + 1].strip()
            user_match = re.match(r'^(You|Human)\n(.+)', user_block, re.DOTALL)
            ai_match   = re.match(r'^(ChatGPT|Assistant|Claude|Gemini|AI|Copilot)\n(.+)', ai_block, re.DOTALL)
            if user_match and ai_match:
                pairs.append({
                    "input":  user_match.group(2).strip()[:2000],
                    "output": ai_match.group(2).strip()[:2000],
                })
                i += 2
            else:
                i += 1

    if not pairs:
        inline = re.findall(
            r'(?:You|User|Human):\s*(.+?)(?:\n|$).*?(?:ChatGPT|Assistant|Claude|AI|Gemini|Copilot):\s*(.+?)(?=\n(?:You|User|Human):|$)',
            text, re.DOTALL | re.IGNORECASE
        )
        pairs = [{"input": u.strip()[:2000], "output": a.strip()[:2000]} for u, a in inline if u.strip() and a.strip()]

    if not pairs:
        chunks = [c.strip() for c in re.split(r'\n{2,}', text) if c.strip()]
        for i in range(0, len(chunks) - 1, 2):
            pairs.append({"input": chunks[i][:2000], "output": chunks[i + 1][:2000]})

    if not pairs:
        raise HTTPException(
            status_code=422,
            detail="Could not parse conversation turns. Paste the full chat history including role labels."
        )

    header = "task_id,input,output,latency"
    def esc(v: str) -> str:
        return '"' + v.replace('"', '""') + '"'

    rows = [
        f"{esc(f'chat-{i+1}')},{esc(p['input'])},{esc(p['output'])},0"
        for i, p in enumerate(pairs)
    ]
    csv_content = "\n".join([header] + rows).encode("utf-8")

    import tempfile
    with tempfile.SpooledTemporaryFile(max_size=10 * 1024 * 1024) as tmp:
        tmp.write(csv_content)
        tmp.seek(0)

        class _Upload:
            filename = f"{payload.source or 'chat'}_history.csv"
            content_type = "text/csv"
            file = tmp
            def read(self): return tmp.read()

        # Fetch registered AI context for accurate model type detection
        _ai_doc = ai_collection.find_one(
            {"name": ai_name, "owner_id": str(current_user["_id"])},
            {"description": 1, "domain": 1, "_id": 0},
        ) or {}
        result = run_sdcc_pipeline(
            ai_name, _Upload(), current_user,
            ai_description=_ai_doc.get("description", ""),
            ai_domain=_ai_doc.get("domain", ""),
        )

    sdcc_collection.update_one(
        {"ai_name": ai_name, "owner_id": str(current_user["_id"])},
        {"$set": {
            **result,
            "ai_name":    ai_name,
            "owner_id":   str(current_user["_id"]),
            "updated_at": datetime.utcnow(),
            "kb_chunks":  [],
        }},
        upsert=True,
    )

    # ── Fan-out individual chat turns to probe_logs ──
    _save_ingested_rows_to_probe_logs(
        ai_name=ai_name,
        owner_id=str(current_user.get("id") or current_user.get("_id")),
        scan_id=result.get("scan_id", ""),
        records=result.get("sample_records", []),
        log_type="chat_log",
    )

    return {
        **{k: v for k, v in result.items() if k != "sample_records"},
        "turns_parsed": len(pairs),
        "source": payload.source or "chat",
    }


# ── Fetch saved probe/uploaded logs from probe_logs table ─────────────────────

@router.get("/sdcc/logs/{ai_name}")
def get_ingested_logs(
    ai_name:  str,
    limit:    int = 100,
    offset:   int = 0,
    log_type: str = "",         # filter: "uploaded_log" | "chat_log" | "probe" | ""
    current_user=Depends(get_current_user),
):
    """
    Return paginated rows from probe_logs for a given AI system.
    Only returns rows owned by the current user (owner_id stored in extra JSONB).

    Query params:
      limit    — max rows to return (default 100, max 1 000)
      offset   — pagination offset
      log_type — optional filter; empty string returns all types
    """
    from app.database import probe_logs_collection

    limit   = min(limit, 1_000)
    owner_id = str(current_user.get("id") or current_user.get("_id"))

    query: dict = {"ai_name": ai_name, "owner_id": owner_id}
    if log_type:
        query["log_type"] = log_type

    total       = probe_logs_collection.count_documents(query)
    matched     = probe_logs_collection.find(query, sort=[("created_at", -1)], skip=offset, limit=limit)

    result_rows = []
    for r in matched:
        result_rows.append({
            "task_id":    r.get("task_id"),
            "input":      r.get("input"),
            "output":     r.get("output"),
            "latency_ms": r.get("latency_ms"),
            "log_type":   r.get("log_type"),
            "mode":       r.get("mode"),
            "dimension":  r.get("dimension"),
            "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
        })

    return {
        "ai_name": ai_name,
        "total":   total,
        "limit":   limit,
        "offset":  offset,
        "rows":    result_rows,
    }


# ── Upload knowledge base ──────────────────────────────────────────────────────

@router.post("/sdcc/upload-kb/{ai_name}")
async def upload_knowledge_base(
    ai_name: str,
    files: List[UploadFile] = File(...),
    current_user=Depends(get_current_user),
):
    from app.services.sdcc.models.summarization import SummarizationEvaluator
    from app.services.storage_client import get_storage_client, is_storage_configured
    from app.services.kb_lifecycle import purge_kb
    from app.config.settings import settings as _settings
    import io as _io

    if isinstance(files, UploadFile):
        files = [files]
    if not files:
        raise HTTPException(status_code=422, detail="No files received.")

    owner_id = str(current_user["_id"])

    # A fresh upload replaces the KB wholesale — purge any previous upload's
    # blob(s) first so switching documents doesn't silently accumulate
    # orphaned files in storage. Uses the same doc lookup the rest of this
    # function already needs.
    _existing_doc = sdcc_collection.find_one({"ai_name": ai_name, "owner_id": owner_id}) or {}
    if _existing_doc.get("kb_blob_refs"):
        purge_kb(ai_name, owner_id, _existing_doc)

    all_chunks: list[str] = []
    chunk_sources: list[str] = []   # parallel list: which uploaded file each chunk came from
    processed_files: list[str] = []
    blob_refs: list[dict] = []      # what we stored, so it can be found and deleted later
    errors: list[str] = []

    for upload in files:
        raw_name = upload.filename or "unknown"
        filename = raw_name.lower()
        try:
            content = await upload.read()
            if not content:
                errors.append(f"'{raw_name}': file is empty.")
                continue

            if any(filename.endswith(ext) for ext in (".txt", ".md", ".pdf", ".docx")):
                text = SummarizationEvaluator.extract_text_from_document(content, filename)
            elif filename.endswith(".csv"):
                df_kb = pd.read_csv(_io.BytesIO(content))
                text = " ".join(
                    " ".join(str(v) for v in df_kb[col].dropna().tolist())
                    for col in df_kb.columns
                    if not pd.api.types.is_numeric_dtype(df_kb[col])
                )
            elif any(filename.endswith(ext) for ext in (".xlsx", ".xls")):
                # Excel — same text-flattening approach as CSV, but read every
                # sheet (a workbook with multiple tabs is common for KB docs).
                sheets = pd.read_excel(_io.BytesIO(content), sheet_name=None)
                parts = []
                for _sheet_name, df_sheet in sheets.items():
                    parts.append(" ".join(
                        " ".join(str(v) for v in df_sheet[col].dropna().tolist())
                        for col in df_sheet.columns
                        if not pd.api.types.is_numeric_dtype(df_sheet[col])
                    ))
                text = " ".join(p for p in parts if p)
            else:
                text = content.decode("utf-8", errors="replace")

            if not text or not text.strip():
                errors.append(f"'{raw_name}': could not extract any text.")
                continue

            words      = text.split()
            chunk_size = 500
            chunks = [
                " ".join(words[i : i + chunk_size])
                for i in range(0, len(words), chunk_size)
                if " ".join(words[i : i + chunk_size]).strip()
            ]
            if not chunks:
                chunks = [text.strip()]

            all_chunks.extend(chunks)
            chunk_sources.extend([raw_name] * len(chunks))
            processed_files.append(raw_name)

            # Persist the raw file too — best-effort. If storage isn't
            # configured or the write fails, the KB still works (chunks are
            # already extracted above); only "keep the original around"
            # degrades, matching how the rest of this codebase treats
            # optional infrastructure (e.g. llm_client's provider checks).
            if is_storage_configured():
                try:
                    client = get_storage_client()
                    blob_name = client.upload(_settings.AZURE_STORAGE_CONTAINER_KB, content, raw_name)
                    blob_refs.append({
                        "filename":   raw_name,
                        "container":  _settings.AZURE_STORAGE_CONTAINER_KB,
                        "blob_name":  blob_name,
                    })
                except Exception as store_err:
                    import logging as _log_kb
                    _log_kb.getLogger(__name__).warning(
                        "[upload_knowledge_base] raw file storage failed for '%s' (non-fatal): %s",
                        raw_name, store_err,
                    )

        except Exception as exc:
            errors.append(f"'{raw_name}': {str(exc)}")

    sdcc_collection.update_one(
        {"ai_name": ai_name, "owner_id": owner_id},
        {"$set": {
            "kb_chunks":     all_chunks,
            "kb_files":      processed_files,
            "kb_blob_refs":  blob_refs,
            "kb_updated_at": datetime.utcnow().isoformat(),
        }},
        upsert=True,
    )

    # ── Normalized knowledge_base_chunks (replaces the kb_chunks JSONB array
    # above as the queryable source of truth; kb_chunks is kept in sync too
    # since run_llm_judge() and other existing readers still consume it as a
    # plain list of strings) ───────────────────────────────────────────────
    try:
        from app.database import knowledge_base_chunks_collection, ai_collection as _ai_col
        _owner_id_str = str(current_user["_id"])
        _ai_doc = _ai_col.find_one({"name": ai_name, "owner_id": _owner_id_str})
        _ai_system_id = str(_ai_doc["id"]) if _ai_doc and _ai_doc.get("id") else None

        if all_chunks:
            # This upload replaces the KB wholesale (matches the $set above),
            # so the old chunk rows for this AI system are cleared first —
            # otherwise every re-upload would just keep piling on stale rows.
            try:
                knowledge_base_chunks_collection.delete_many({"ai_name": ai_name, "owner_id": _owner_id_str})
            except ValueError:
                pass  # first-ever upload for this AI — nothing to clear

            for idx, chunk_text in enumerate(all_chunks):
                knowledge_base_chunks_collection.insert_one({
                    "ai_system_id": _ai_system_id,
                    "ai_name":      ai_name,
                    "owner_id":     _owner_id_str,
                    "chunk_index":  idx,
                    "content":      chunk_text,
                    "source":       chunk_sources[idx] if idx < len(chunk_sources) else None,
                })
    except Exception as kb_persist_err:
        import logging as _log3
        _log3.getLogger(__name__).warning("[upload_knowledge_base] knowledge_base_chunks persistence failed (non-fatal): %s", kb_persist_err)

    return {
        "files_processed": processed_files,
        "chunks_stored":   len(all_chunks),
        "errors":          errors,
        "message": (
            f"Knowledge base updated: {len(all_chunks)} chunk(s) from "
            f"{len(processed_files)} file(s)."
            + (f" Errors: {len(errors)}." if errors else "")
        ),
    }


@router.get("/sdcc/kb-chunks/{ai_name}")
def get_knowledge_base_chunks(ai_name: str, current_user=Depends(get_current_user)):
    """
    Returns the current knowledge base for an AI system as normalized rows
    (chunk_index, content, source file) instead of the flat kb_chunks
    string array — lets the frontend show which file each chunk of grounding
    context came from.
    """
    from app.database import knowledge_base_chunks_collection
    from app.services.kb_lifecycle import get_active_kb_chunks

    owner_id = str(current_user["_id"])

    # Respects the same 24h TTL as /evaluate — an expired KB is purged here
    # too, so a stale preview never lingers. refresh=False: viewing the
    # preview doesn't count as activity, only upload/evaluate do.
    sdcc_doc = sdcc_collection.find_one({"ai_name": ai_name, "owner_id": owner_id}) or {}
    if not get_active_kb_chunks(ai_name, owner_id, sdcc_doc, refresh=False):
        return {"ai_name": ai_name, "chunks": [], "total": 0}

    rows = knowledge_base_chunks_collection.find(
        {"ai_name": ai_name, "owner_id": owner_id},
        sort=[("chunk_index", 1)],
    )
    return {
        "ai_name": ai_name,
        "chunks": [
            {
                "chunk_index": r.get("chunk_index"),
                "content":     r.get("content"),
                "source":      r.get("source"),
            }
            for r in rows
        ],
        "total": len(rows),
    }


# ── SDCC status ────────────────────────────────────────────────────────────────

@router.get("/sdcc/status/{ai_name}")
def get_sdcc_status(ai_name: str, current_user=Depends(get_current_user)):
    doc = sdcc_collection.find_one(
        {"ai_name": ai_name, "owner_id": str(current_user["_id"])},
        {"_id": 0, "sample_records": 0, "kb_chunks": 0},
    )
    if not doc:
        raise HTTPException(
            status_code=404,
            detail="No ingested data found. Please upload logs first.",
        )
    return doc


# ── Principle descriptions ─────────────────────────────────────────────────────

_PRINCIPLE_DESCRIPTIONS: dict[str, str] = {
    "Fairness": (
        "AI solutions should be designed to reduce or eliminate bias against individuals, "
        "communities, and groups. Ongoing bias monitoring and equal error rates across groups "
        "must be maintained across the full model lifecycle."
    ),
    "Transparency": (
        "AI solutions should include responsible disclosure to provide stakeholders with a "
        "clear understanding of what is happening in each solution across the AI lifecycle, "
        "including training data sources, model architecture, and known limitations."
    ),
    "Explainability": (
        "AI solutions should be developed and delivered in a way that answers the questions "
        "of how and why a conclusion was drawn from the solution. Outputs must be interpretable "
        "to non-technical users, regulators, and affected individuals."
    ),
    "Accountability": (
        "Human oversight and responsibility should be embedded across the AI lifecycle to manage "
        "risk and comply with applicable laws and regulations. Clear governance structures, audit "
        "trails, and escalation procedures must assign and enforce accountability."
    ),
    "Data Integrity": (
        "Data used in AI solutions should be assessed for accuracy, completeness, "
        "appropriateness, and quality to drive trusted decisions."
    ),
    "Reliability": (
        "AI solutions should consistently operate in accordance with their intended purpose and "
        "scope and at the desired level of precision. Performance degradation, failures, and "
        "edge cases must be actively monitored and SLA compliance maintained."
    ),
    "Security": (
        "Robust and resilient practices should be implemented to safeguard AI solutions against "
        "bad actors, misinformation, or adverse events. A defence-in-depth approach covering "
        "input validation, output filtering, adversarial robustness, and continuous red-teaming."
    ),
    "Safety": (
        "AI solutions should be designed and implemented to safeguard against harm to people, "
        "businesses, and property. Safety must be embedded across the full AI lifecycle through "
        "proactive risk assessment, harm prevention controls, and human override mechanisms."
    ),
    "Privacy": (
        "AI solutions should be designed to comply with applicable privacy and data protection "
        "laws and regulations. Data minimisation, purpose limitation, consent management, "
        "anonymisation, and right-to-erasure must be embedded by design."
    ),
    "Sustainability": (
        "AI solutions should be designed to be energy efficient, reduce carbon emissions, and "
        "support a cleaner environment. Efficient model architectures, optimised training and "
        "inference pipelines, and responsible resource allocation reduce climate impact."
    ),
}

_COMPLIANCE_THRESHOLDS: dict[str, dict[str, int]] = {
    "classification":       {"EU_AI_Act": 75, "ISO_42001": 80, "NIST_AI_RMF": 70},
    "rag":                  {"EU_AI_Act": 70, "ISO_42001": 75, "NIST_AI_RMF": 65},
    "summarization":        {"EU_AI_Act": 70, "ISO_42001": 75, "NIST_AI_RMF": 65},
    "general_llm":          {"EU_AI_Act": 70, "ISO_42001": 75, "NIST_AI_RMF": 65},
    "automation":           {"EU_AI_Act": 80, "ISO_42001": 85, "NIST_AI_RMF": 75},
    "image_classification": {"EU_AI_Act": 75, "ISO_42001": 80, "NIST_AI_RMF": 70},
}

_METRIC_LIBRARY_MAP: dict[str, str] = {
    "rouge_l":             "rouge_score library (fallback: n-gram LCS overlap)",
    "rouge_1":             "rouge_score library (fallback: unigram overlap)",
    "rouge_2":             "rouge_score library (fallback: bigram overlap)",
    "bleu":                "sacrebleu corpus BLEU (fallback: smoothed BLEU-4)",
    "bertscore":           "sentence_transformers cosine sim (fallback: token F1)",
    "faithfulness":        "sentence_transformers cosine sim (fallback: Jaccard)",
    "answer_relevance":    "sentence_transformers cosine sim (fallback: Jaccard)",
    "context_recall":      "unigram token recall (reference ∩ context / reference)",
    "hallucination_rate":  "1 − faithfulness score",
    "context_coverage":    "proportion of rows with KB/context available",
    "reference_coverage":  "proportion of rows with reference summaries",
    "coverage_score":      "TF-IDF key-sentence coverage (source → summary)",
    "density_score":       "trigram copy-rate density (extractive vs abstractive)",
    "compression_ratio":   "output token count / input token count",
    "summary_redundancy":  "1 − bigram repetition rate within summaries",
    "toxicity_rate":       "Detoxify classifier (fallback: expanded keyword heuristic)",
    "safety_pass_rate":    "1 − toxicity_rate",
    "avg_coherence":       "sentence-length + TTR + discourse markers + Flesch (textstat)",
    "avg_perplexity":      "vocabulary entropy proxy (unigram distribution)",
    "roc_auc":             "scikit-learn roc_auc_score (requires binary confidence col)",
    "f1_score":            "scikit-learn f1_score (fallback: manual macro-F1)",
    "precision":           "scikit-learn precision_score (fallback: manual)",
    "recall":              "scikit-learn recall_score (fallback: manual)",
    "class_balance":       "min/max class count ratio",
    "avg_confidence":      "mean of confidence/probability column",
    "accuracy":            "LLM-judge (Groq llama-3.3-70b) correctness rate",
    "judge_accuracy":      "LLM-judge (Groq llama-3.3-70b) correctness rate",
    "step_success_rate":   "explicit boolean col or keyword inference from output text",
    "task_completion_rate": "same as step_success_rate",
    "error_rate":          "1 − step_success_rate",
    "avg_retry_rate":      "mean of retry_count column",
    "avg_step_latency_ms": "mean of latency/duration column (ms)",
    "map_score":           "mean of map column (fallback: confidence × 0.85)",
    "avg_iou":             "mean of iou column (fallback: confidence × 0.90)",
    "top_k_accuracy":      "proportion of predictions with confidence ≥ 0.5",
    "label_coverage":      "proportion of rows with non-null ground-truth label",
    "avg_inference_ms":    "mean of latency/inference_time column (ms)",
    "avg_latency_ms":      "mean of latency/response_time column (ms)",
}


# ── Evaluate ───────────────────────────────────────────────────────────────────

@router.post("/evaluate/{ai_name}")
def evaluate_ai(
    ai_name: str,
    include_blackbox: bool = True,
    current_user=Depends(get_current_user),
):
    sdcc_doc = sdcc_collection.find_one({
        "ai_name":  ai_name,
        "owner_id": str(current_user["_id"]),
    })
    if not sdcc_doc:
        raise HTTPException(
            status_code=404,
            detail="No ingested data found. Please upload logs first via /sdcc/ingest.",
        )

    model_type  = sdcc_doc.get("model_type",  "general_llm")
    logs_count  = sdcc_doc.get("logs_ingested", 0)
    dq_score    = sdcc_doc.get("data_quality_score", 0)
    struct_risk = sdcc_doc.get("structural_risk", "Unknown")
    diagnostics = sdcc_doc.get("diagnostics") or {}  # guard against None from new ingest path
    det_conf    = sdcc_doc.get("det_conf", sdcc_doc.get("detection_confidence", 0.0))
    from app.services.kb_lifecycle import get_active_kb_chunks
    kb_chunks   = get_active_kb_chunks(ai_name, str(current_user["_id"]), sdcc_doc, refresh=True)

    # ── Read ALL log rows from probe_logs (Postgres) ──────────────────────────
    # sample_records in sdcc_doc is only a 10-row UI preview.
    # The authoritative source is probe_logs, which holds every ingested row.
    from app.services.sdcc.log_normaliser import fetch_logs_from_postgres
    pg_df = fetch_logs_from_postgres(
        ai_name=ai_name,
        owner_id=str(current_user["_id"]),
        log_type="",     # all types: uploaded_log, chat_log, probe
        limit=5000,
    )
    sample_recs = pg_df.where(pd.notnull(pg_df), None).to_dict(orient="records") if not pg_df.empty else []
    if not sample_recs:
        # Fallback to sdcc_doc preview if probe_logs is empty (e.g. old data)
        sample_recs = sdcc_doc.get("sample_records", [])

    blackbox_rows: list[dict] = []
    blackbox_source_info: dict = {}
    bb_doc: dict | None = None

    # Needed for Code & Build Risk — previously this endpoint never fetched it,
    # so log-only audits had no way to know if the system was AI-generated.
    ai_reg_doc = ai_collection.find_one(
        {"name": ai_name, "owner_id": str(current_user["_id"])},
        {"registration_profile": 1, "taf_applicable_categories": 1, "_id": 0},
    ) or {}
    registration_profile = ai_reg_doc.get("registration_profile") or {}

    if include_blackbox:
        from app.database import blackbox_collection as _bb_col
        bb_doc  = _bb_col.find_one(
            {"ai_name": ai_name, "owner_id": str(current_user["_id"])},
            sort=[("created_at", -1)],
        )
        if bb_doc and bb_doc.get("probe_results"):
            for pr in bb_doc["probe_results"]:
                prompt   = pr.get("prompt", "").strip()
                response = pr.get("response", "").strip()
                if prompt and response and not response.startswith("["):
                    blackbox_rows.append({
                        "input":   prompt,
                        "output":  response,
                        "task_id": pr.get("probe_id", ""),
                        "latency": pr.get("latency_ms", 0),
                        "_source": "blackbox",
                    })
            blackbox_source_info = {
                "audit_id":    bb_doc.get("audit_id", ""),
                "probes_used": len(blackbox_rows),
                "started_at":  str(bb_doc.get("started_at", "")),
            }

    seen_task_ids: set = set()
    combined_recs: list = []
    for row in sample_recs + blackbox_rows:
        tid = row.get("task_id", "") or ""
        if tid and tid in seen_task_ids:
            continue
        if tid:
            seen_task_ids.add(tid)
        combined_recs.append(row)

    logs_count = len(combined_recs)
    df = pd.DataFrame(combined_recs) if combined_recs else pd.DataFrame()

    judge_result: dict = {}
    judge_labels: list = []

    if not df.empty:
        judge_result = run_llm_judge(
            df=df,
            kb_chunks=kb_chunks if kb_chunks else None,
            max_rows=200,
        )
        judge_labels = judge_result.get("labels", [])

        if judge_labels:
            label_series = pd.Series(
                judge_labels + [None] * max(0, len(df) - len(judge_labels)),
                index=df.index[:len(df)]
            )
            df["_judge_label"] = label_series

    computed_values: dict = {}
    computation_notes: dict = {}

    if not df.empty:
        try:
            computed_values = calculate_metrics(
                model_type, df,
                kb_chunks=kb_chunks if kb_chunks else None,
            )

            if judge_result.get("accuracy") is not None:
                computed_values["accuracy"]      = judge_result["accuracy"]
                computed_values["judge_accuracy"] = judge_result["accuracy"]

            for metric_key, value in computed_values.items():
                library = _METRIC_LIBRARY_MAP.get(metric_key, "computed from text/data")
                status  = "computed" if value is not None else "unavailable (missing data)"
                computation_notes[metric_key] = {
                    "library": library,
                    "status":  status,
                    "value":   round(value, 4) if value is not None else None,
                }
        except Exception as exc:
            computation_notes["_error"] = str(exc)

    EvaluatorClass = get_evaluator(model_type)
    evaluator      = EvaluatorClass()

    model_metrics = evaluator.model_metrics(df, computed=computed_values)
    diagnostics = diagnostics or {}  # double-guard before evaluator calls

    # If diagnostics is empty (new ingest path), build it from the actual df
    if not diagnostics and not df.empty:
        has_input  = "input"  in df.columns
        has_output = "output" in df.columns
        text_cols  = [c for c in df.columns if df[c].dtype == object]
        num_cols   = [c for c in df.columns if df[c].dtype != object]
        missing = float(df.isnull().mean().mean()) if not df.empty else 0.0
        dupes   = int(df.duplicated(subset=["task_id"] if "task_id" in df.columns else None).sum())
        diagnostics = {
            "missing_ratio":    missing,
            "duplicates":       dupes,
            "schema_confidence": 0.85 if (has_input and has_output) else 0.5,
            "total_columns":    len(df.columns),
            "text_columns":     len(text_cols),
            "numeric_columns":  len(num_cols),
            "column_names":     list(df.columns),
            "has_input_col":    has_input,
            "has_output_col":   has_output,
        }
        # Persist diagnostics back to sdcc_results so future calls have it
        sdcc_collection.update_one(
            {"ai_name": ai_name, "owner_id": str(current_user["_id"])},
            {"$set": {"diagnostics": diagnostics}},
        )

    principles = evaluator.taf_principles(diagnostics, logs_count, model_metrics, df=df)
    for name in principles:
        principles[name]["description"] = _PRINCIPLE_DESCRIPTIONS.get(name, "")

    overall = evaluator.clamp(
        sum(p["score"] for p in principles.values()) / max(len(principles), 1)
    )

    risk_analysis = evaluator.compute_risk_analysis(principles, diagnostics or {}, logs_count, model_metrics)
    risk_level = risk_analysis["overall_risk_level"]

    # ── AI-generated recommendations (two batched Groq calls, sync) ───────────
    rec_result: dict = {}
    try:
        from app.services.sdcc.rec_synthesizer import synthesize_recommendations
        rec_result = synthesize_recommendations(
            ai_name=ai_name,
            model_type=model_type,
            model_label=evaluator.LABEL,
            domain=ai_reg_doc.get("domain", "") if ai_reg_doc else "",
            registration_profile=registration_profile,
            principles=principles,
            model_metrics=model_metrics,
            model_context_per_principle=evaluator._context_for_rec_all(principles),
            principle_deltas=None,
        )
    except Exception as _rec_err:
        import logging as _rec_log
        _rec_log.getLogger(__name__).warning("[evaluate] rec_synthesizer failed (non-fatal): %s", _rec_err)
        rec_result = {"recs_generated": False, "recommended_actions": [], "finding_recommendations": {}, "rec_principles": {}}

    findings = evaluator.generate_findings(
        principles,
        model_metrics,
        finding_recommendations=rec_result.get("finding_recommendations", {}),
    )

    thr = _COMPLIANCE_THRESHOLDS.get(model_type, _COMPLIANCE_THRESHOLDS["general_llm"])

    # Richer compliance object: carries per-principle scores so the
    # RegulatoryAlignment frontend can resolve clause-level evidence
    # directly from the report. "status" kept for backward compat.
    _pscores = {name: round(pdata.get("score", 0)) for name, pdata in principles.items()}
    framework_compliance = {
        "EU_AI_Act": {
            "status":           "Compliant"       if overall >= thr["EU_AI_Act"]   else "Conditional",
            "overall_score":    overall,
            "threshold":        thr["EU_AI_Act"],
            "principle_scores": _pscores,
        },
        "ISO_42001": {
            "status":           "Certified Ready" if overall >= thr["ISO_42001"]   else "Conditional",
            "overall_score":    overall,
            "threshold":        thr["ISO_42001"],
            "principle_scores": _pscores,
        },
        "NIST_AI_RMF": {
            "status":           "Aligned"         if overall >= thr["NIST_AI_RMF"] else "Conditional",
            "overall_score":    overall,
            "threshold":        thr["NIST_AI_RMF"],
            "principle_scores": _pscores,
        },
        "KPMG_TAF": {
            "status":           "Assessed",
            "overall_score":    overall,
            "principle_scores": _pscores,
        },
    }

    _ts = datetime.utcnow()
    _safe_name = "".join(c if c.isalnum() else "-" for c in ai_name.strip()).strip("-")
    _safe_name = "-".join(p for p in _safe_name.split("-") if p)[:40]
    report_id  = f"{_safe_name}-{_ts.strftime('%H%M')}"

    # ── Code & Build Risk ────────────────────────────────────────────────────
    # Reuse the live BlackBox run's already-computed section when one exists
    # (it has the real adversarial-probe evidence); otherwise synthesize the
    # honest, narrower log-only version instead of leaving this tab permanently
    # "not applicable" for every log-only audit.
    from app.services.blackbox.build_risk import build_log_only_code_build_risk_section
    if bb_doc and bb_doc.get("code_build_risk"):
        code_build_risk = bb_doc["code_build_risk"]
    else:
        code_build_risk = build_log_only_code_build_risk_section(
            outputs=df["output"].tolist() if not df.empty and "output" in df.columns else [],
            registration_profile=registration_profile,
        )

    # Build risk narrative (Call 2) — only when AI-generated
    if code_build_risk.get("applicable"):
        try:
            from app.services.sdcc.rec_synthesizer import synthesize_build_risk_narrative
            br_narrative = synthesize_build_risk_narrative(
                ai_name=ai_name,
                domain=ai_reg_doc.get("domain", "") if ai_reg_doc else "",
                model_type=model_type,
                registration_profile=registration_profile,
                build_risk=code_build_risk,
            )
            if br_narrative.get("generated"):
                if br_narrative.get("overall_narrative"):
                    code_build_risk["ai_narrative"] = br_narrative["overall_narrative"]
                for check in code_build_risk.get("checks", []):
                    cid = check.get("id", "")
                    narr = br_narrative.get("checks", {}).get(cid)
                    if narr:
                        check["ai_summary"] = narr
        except Exception as _br_err:
            import logging as _brlog
            _brlog.getLogger(__name__).warning("[evaluate] build_risk_narrative failed (non-fatal): %s", _br_err)

    report_doc = {
        "report_id":            report_id,
        "ai_name":              ai_name,
        "model_type":           model_type,
        "model_label":          evaluator.LABEL,
        "detection_confidence": det_conf,
        "evaluated_at":         datetime.utcnow().isoformat(),
        "overall_score":        overall,
        "risk_level":           risk_level,
        "structural_risk":      struct_risk,
        "logs_evaluated":       logs_count,
        "data_quality_score":   dq_score,
        "trusted_ai_principles": principles,
        "diagnostics":          diagnostics,
        "model_metrics":        model_metrics,
        "computation_notes":    computation_notes,
        "code_build_risk":      code_build_risk,
        "llm_judge": {
            "rows_judged":     judge_result.get("rows_judged", 0),
            "rows_skipped":    judge_result.get("rows_skipped", 0),
            "accuracy":        judge_result.get("accuracy"),
            "judge_model":     judge_result.get("judge_model", ""),
            "kb_chunks_used":  judge_result.get("kb_chunks_count", 0),
            "kb_grounded":     bool(kb_chunks),
            "error":           judge_result.get("error"),
            "panel_size":      judge_result.get("panel_size", 0),
            "judge_panel":     judge_result.get("judge_panel", []),
            "warnings":        judge_result.get("warnings", []),
        },
        "audit_sources": {
            "uploaded_logs":   len(sample_recs),
            "blackbox_probes": len(blackbox_rows),
            "combined_total":  logs_count,
            "blackbox_info":   blackbox_source_info,
        },
        "findings":             findings,
        "risk_analysis":        risk_analysis,
        "recommendation":       sdcc_doc.get("recommendation", ""),
        # AI-generated recommendation fields from rec_synthesizer
        "overall_narrative":           rec_result.get("overall_narrative", ""),
        "deployment_verdict_context":  rec_result.get("deployment_verdict_context", ""),
        "recommended_actions":         rec_result.get("recommended_actions", []),
        "rec_principles":              rec_result.get("rec_principles", {}),
        "recs_generated":              rec_result.get("recs_generated", False),
        "framework_compliance": framework_compliance,
        "column_warnings":      sdcc_doc.get("column_warnings", []),
        "owner_id":             str(current_user["_id"]),
        "created_at":           datetime.utcnow(),
    }

    # ── Analysis engine tier (honest quality disclosure) ──────────────────────
    try:
        from app.services.sdcc.analysis_engines import engine_status
        report_doc["engine_status"] = engine_status()
    except Exception:
        report_doc["engine_status"] = {}

    result = reports_collection.insert_one(report_doc)
    report_doc["_id"] = str(result.inserted_id)
    _report_uuid = str(result.inserted_id)
    _ai_system_id = ai_reg_doc.get("id")  # PgCollection.find_one always returns the full row, so "id" is present
    _owner_id_str = str(current_user["_id"])

    ai_collection.update_one(
        {"name": ai_name, "owner_id": str(current_user["_id"])},
        {"$inc": {"audit_runs": 1}},
    )

    # ── Persist the report breakdown as normalized, queryable rows ────────────
    # (principle scores, sub-parameters, findings, framework/regulatory
    # alignment, model metrics). Non-fatal: report_doc above is already
    # saved and returned to the user regardless of what happens here.
    try:
        from app.services.report_persistence import persist_report_breakdown, persist_judge_panel_results
        persist_report_breakdown(report_doc, _report_uuid, _ai_system_id, _owner_id_str)

        if judge_result and judge_result.get("labels"):
            persist_judge_panel_results(
                judge_result, _report_uuid, _ai_system_id, _owner_id_str,
                questions=df["input"].tolist() if not df.empty and "input" in df.columns else None,
                outputs=df["output"].tolist() if not df.empty and "output" in df.columns else None,
                task_ids=df["task_id"].tolist() if not df.empty and "task_id" in df.columns else None,
            )
    except Exception as persist_err:
        import logging as _log
        _log.getLogger(__name__).warning("[evaluate] normalized report persistence failed (non-fatal): %s", persist_err)

    # ── Auto-compute TAF taxonomy mapping ─────────────────────────────────────
    # Triggered automatically on every evaluate — no manual button needed.
    # If the user uploaded training data earlier (via Dashboard Section 3b),
    # pull the latest training_data_id and factor it in.
    try:
        from app.services.taf.taxonomy_mapper import compute_taf_mapping, detect_ai_category
        from app.database import taf_assessments_collection, training_uploads_collection
        from app.services.audit_evidence import read_latest_evidence

        owner_id_str = str(current_user.get("id") or current_user.get("_id"))
        taf_ai_category = detect_ai_category(model_type)

        # Check for latest training data upload for this AI
        td_doc = training_uploads_collection.find_one(
            {"ai_name": ai_name, "owner_id": owner_id_str}
        )
        training_analysis  = td_doc.get("analysis") if td_doc else None
        training_data_id   = str(td_doc.get("id") or td_doc.get("_id")) if td_doc else None

        # Pull control_scores from stored blackbox audit
        bb_control_scores = {}
        if bb_doc:
            raw_cs = bb_doc.get("extra", {})
            if isinstance(raw_cs, str):
                try: raw_cs = json.loads(raw_cs)
                except: raw_cs = {}
            bb_control_scores = raw_cs.get("control_scores") or bb_doc.get("control_scores") or {}

        # Resolve the set of applicable TAF categories from the registration
        # profile.  GAI is always included (we only audit generative systems).
        # The user's capability selections add additional categories on top.
        _top_level_cats = ai_reg_doc.get("taf_applicable_categories") or []
        _profile_cats   = registration_profile.get("taf_applicable_categories") or []
        _all_cats = list(set(_top_level_cats) | set(_profile_cats))
        applicable_taf_categories = list({"GAI"} | set(_all_cats))

        # ── Read from the unified per-control evidence store ─────────────────
        # unified_pipeline.py (tier-based blackbox audits) writes one row per
        # control into audit_evidence — probe-synthesized results for GAI plus
        # whatever else was selected at registration. Without this, that
        # evidence never reached compute_taf_mapping(): it always fell back to
        # the pre-unified chain (bb_control_scores / flat category_scores),
        # so a completed unified audit's per-control results never showed up
        # in the report or the TAF Taxonomy page. Non-fatal: an empty dict
        # here just means compute_taf_mapping() uses its legacy fallback,
        # exactly as it did before this store existed.
        try:
            evidence_store = read_latest_evidence(ai_name, owner_id_str)
        except Exception as ev_err:
            import logging as _log_ev
            _log_ev.getLogger(__name__).warning("[evaluate] read_latest_evidence failed (non-fatal): %s", ev_err)
            evidence_store = {}

        taf_result = compute_taf_mapping(
            audit_result              = bb_doc or {},
            report_result             = report_doc,
            training_analysis         = training_analysis,
            ai_category               = taf_ai_category,
            control_scores            = bb_control_scores,
            applicable_categories     = applicable_taf_categories,
            evidence_store            = evidence_store,
        )

        taf_assessments_collection.update_one(
            {"ai_name": ai_name, "owner_id": owner_id_str},
            {"$set": {
                "audit_id":               report_id,
                "ai_name":                ai_name,
                "owner_id":               owner_id_str,
                "ai_category":            taf_ai_category,
                "applicable_categories":  applicable_taf_categories,
                "rows":                   taf_result["rows"],
                "summary":                taf_result["summary"],
                "pillar_breakdown":       taf_result["pillar_breakdown"],
                "has_training_data":      bool(training_analysis),
                "training_data_id":       training_data_id,
                "updated_at":             datetime.utcnow(),
            }},
            upsert=True,
        )

        # Embed TAF summary into report_doc response so frontend has it immediately
        report_doc["taf_summary"] = taf_result["summary"]
        report_doc["taf_ai_category"] = taf_ai_category

        # Persist each Control Matrix row individually (see report_persistence.py)
        # instead of only inside the single taf_assessments.rows JSONB array.
        try:
            from app.services.report_persistence import persist_taxonomy_controls
            persist_taxonomy_controls(
                taf_result["rows"], report_id, _report_uuid, _ai_system_id, owner_id_str,
            )
        except Exception as taxctrl_err:
            import logging as _log2
            _log2.getLogger(__name__).warning("[evaluate] taxonomy control persistence failed (non-fatal): %s", taxctrl_err)

    except Exception as taf_err:
        import logging as _log
        _log.getLogger(__name__).warning("[evaluate] TAF auto-compute failed (non-fatal): %s", taf_err)

    return report_doc