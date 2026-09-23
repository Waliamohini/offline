"""
app/routes/blackbox.py
=======================
Blackbox audit router.

What changed:
  - _get_ai_context() now also returns registration_profile and system_prompt
    (stored by RegisterAi.tsx via ai_routes.py) so the orchestrator has full
    context for all 4 intelligence layers:
      1. Registration profile (end_users, decision_influence, data_types, etc.)
      2. System prompt (if the client pasted it at registration)
      3. Behavioral fingerprint (warm-up probes — orchestrator handles this)
      4. Description + domain (always present)
  - result from run_blackbox_pipeline includes adaptive_meta and fingerprint_meta
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, validator
from typing import Literal, Optional
from datetime import datetime

from app.dependencies import get_current_user
from app.database import db
from app.services.blackbox.orchestrator import run_blackbox_pipeline
from app.services.blackbox.ui_auditor import run_ui_blackbox_pipeline
from app.services.blackbox.enterprise_router import detect_platform, _patch_selectors
from app.services.blackbox import ui_auditor as ui_auditor_module

router = APIRouter(prefix="/blackbox", tags=["Black Box Audit"])

from app.database import blackbox_collection, ai_collection  # PostgreSQL-backed


# ── Schema ─────────────────────────────────────────────────────────────────────

class BlackBoxRequest(BaseModel):
    ai_name:  str
    mode:     str                   # "api" | "ui"
    endpoint: Optional[str] = ""
    api_key:  Optional[str] = ""
    ui_url:   Optional[str] = ""
    cookies:  Optional[str] = ""   # JSON array from Cookie-Editor (UI mode only)
    # Effort tier for the consolidated pipeline: dev | standard | thorough.
    # When set (and mode == "api"), routes through the unified taxonomy-seeded
    # pipeline. Omitted → legacy wave-based pipeline (backward compatible).
    tier:     Optional[str] = None


class RerunRequest(BaseModel):
    prior_audit_id: str
    user_context:   str
    scope_override: Optional[Literal["full", "targeted", "phase1_only"]] = None
    endpoint:       str = ""
    api_key:        str = ""
    mode:           str = "api"

    @validator("user_context")
    def user_context_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("user_context is required before a re-run can proceed")
        return v


# ── Helper: fetch full AI system context from MongoDB ──────────────────────────

def _get_ai_context(ai_name: str, owner_id: str) -> dict:
    """
    Returns all context fields stored at registration time.
    Falls back to empty values if the system is not found.

    Fields returned:
      description           – plain description
      domain                – domain string
      registration_profile  – structured profile dict (Approach 3)
      system_prompt         – pasted system prompt (Approach 2), if provided
    """
    doc = ai_collection.find_one(
        {"name": ai_name, "owner_id": owner_id},
        {
            "description":          1,
            "domain":               1,
            "registration_profile": 1,
            "system_prompt":        1,   # stored by ai_routes.py if client provided it
            "_id":                  0,
        },
    )
    if not doc:
        return {
            "description":          "",
            "domain":               "",
            "registration_profile": None,
            "system_prompt":        "",
        }

    # Flatten registration_profile fields that RegisterAi.tsx captures
    # (end_users, decision_influence, data_types, jurisdictions,
    #  highest_stakes_failure, oversight_model, deployment_status,
    #  autonomous_actions, real_time_data, output_visibility, bias_tested,
    #  risk_scenario, custom_risk_scenario, agent_version)
    rp = doc.get("registration_profile") or {}

    # Some implementations store these at the top level of the AI doc
    # (not nested under registration_profile) — merge both for safety
    top_level_profile_fields = [
        "end_users", "decision_influence", "data_types", "jurisdictions",
        "highest_stakes_failure", "oversight_model", "deployment_status",
        "autonomous_actions", "real_time_data", "output_visibility",
        "bias_tested", "risk_scenario", "custom_risk_scenario", "agent_version",
    ]
    for field in top_level_profile_fields:
        if field not in rp and field in doc:
            rp[field] = doc[field]

    return {
        "description":          doc.get("description", ""),
        "domain":               doc.get("domain", ""),
        "registration_profile": rp if rp else None,
        "system_prompt":        doc.get("system_prompt", ""),
    }


# ── Run Audit ──────────────────────────────────────────────────────────────────

@router.post("/audit")
async def run_blackbox_audit(
    payload:     BlackBoxRequest,
    current_user=Depends(get_current_user),
):
    # ── Validate ───────────────────────────────────────────────────────────────
    if payload.mode == "api":
        if not payload.api_key:
            raise HTTPException(status_code=422, detail="API mode requires an api_key.")
    elif payload.mode == "ui":
        if not payload.ui_url:
            raise HTTPException(status_code=422, detail="UI mode requires ui_url.")
    else:
        raise HTTPException(status_code=422, detail="mode must be 'api' or 'ui'.")

    # ── Fetch all registered context (description, domain, profile, system prompt)
    ctx = _get_ai_context(
        ai_name=payload.ai_name,
        owner_id=str(current_user["_id"]),
    )

    # ── Route to correct pipeline ──────────────────────────────────────────────
    if payload.mode == "api":
        if payload.tier:
            # Consolidated taxonomy-seeded pipeline (dev/standard/thorough)
            from app.services.blackbox.unified_pipeline import run_unified_pipeline
            result = await run_unified_pipeline(
                ai_name=payload.ai_name,
                mode=payload.mode,
                tier=payload.tier,
                endpoint=payload.endpoint or "",
                api_key=payload.api_key or "",
                current_user=current_user,
                ai_description=ctx["description"],
                ai_domain=ctx["domain"],
                registration_profile=ctx["registration_profile"],
                system_prompt=ctx["system_prompt"],
            )
        else:
            result = await run_blackbox_pipeline(
                ai_name=payload.ai_name,
                mode=payload.mode,
                endpoint=payload.endpoint or "",
                api_key=payload.api_key or "",
                current_user=current_user,
                ai_description=ctx["description"],
                ai_domain=ctx["domain"],
                registration_profile=ctx["registration_profile"],
                system_prompt=ctx["system_prompt"],
            )

    elif payload.mode == "ui":
        profile = detect_platform(
            ui_url=payload.ui_url or "",
            ai_name=payload.ai_name,
        )
        _patch_selectors(ui_auditor_module, profile)

        # Pass context to UI pipeline too — ui_auditor should forward to probe_generator
        result = await run_ui_blackbox_pipeline(
            ai_name=payload.ai_name,
            ui_url=payload.ui_url or "",
            cookies=payload.cookies or None,
            stealth=profile["stealth"],
            ai_description=ctx["description"],
            ai_domain=ctx["domain"],
            registration_profile=ctx["registration_profile"],  # ← NEW
            system_prompt=ctx["system_prompt"],                 # ← NEW
            owner_id=str(current_user["_id"]),
        )

        result["platform_detected"] = profile["label"]
        result["platform_notes"]    = profile["notes"]

        if profile["needs_cookies"] and not payload.cookies:
            result["warning"] = (
                f"{profile['label']} requires login. No cookies were provided. "
                f"Export cookies from the target site using Cookie-Editor and pass "
                f"them in the 'cookies' field."
            )

    # ── Save to DB ─────────────────────────────────────────────────────────────
    stored = {
        **result,
        "owner_id":              str(current_user["_id"]),
        "created_at":            datetime.utcnow(),
        "rerun_sequence":        1,
        # Hoist new columns to top level so the schema columns are populated.
        # PgCollection's insert_one maps dict keys to table columns by name;
        # keys not matching any column land in `extra` JSONB automatically.
        "tier":                  result.get("tier"),
        "total_probes_expected": result.get("total_probes_expected"),
    }
    stored.pop("api_key", None)
    blackbox_collection.insert_one(stored)

    from app.database import users_collection
    users_collection.update_one(
        {"_id": current_user["_id"]},
        {"$inc": {"audit_count": 1}}
    )

    return result


# ── History by AI name ─────────────────────────────────────────────────────────

# @router.get("/history/{ai_name}")

# ── Real-time probe progress ───────────────────────────────────────────────────
# Called by the frontend every 2s during an active audit to get the real count
# of probes logged so far. probe_logger writes each row as it completes, so
# COUNT(*) on probe_logs gives the live probe count for this audit_id.

@router.get("/progress/{ai_name}")
def get_probe_progress(ai_name: str, current_user=Depends(get_current_user)):
    """
    Returns real-time probe count for the most recent in-progress or completed
    audit of this AI system. Frontend polls this every 2s during a run.
    """
    from app.database import blackbox_collection, probe_logs_collection

    owner_id = str(current_user.get("id") or current_user.get("_id"))

    audit = blackbox_collection.find_one(
        {"ai_name": ai_name, "owner_id": owner_id}, sort=[("created_at", -1)]
    )
    if not audit:
        return {"probes_logged": 0, "audit_id": None, "status": "no_audit"}

    audit_id = audit.get("audit_id")
    status   = audit.get("status") or "unknown"

    probes_logged = sum(
        1 for d in probe_logs_collection.find({"audit_id": audit_id})
        if d.get("log_type") in ("probe", "fingerprint", "rerun_1", "rerun_2")
    )

    # Expected total — unified pipeline stores it directly; older audits may
    # only have `tier`, in which case fall back to a tier-based estimate.
    expected_total = None
    if audit.get("total_probes_expected"):
        try:
            expected_total = int(audit["total_probes_expected"])
        except (ValueError, TypeError):
            pass
    if expected_total is None:
        tier_defaults = {"dev": 107, "standard": 215, "thorough": 400}
        expected_total = tier_defaults.get(audit.get("tier") or "standard", 215)
    expected_total = expected_total or 215

    return {
        "probes_logged":    probes_logged,
        "probes_expected":  expected_total,
        "progress_pct":     min(100, round(probes_logged / max(expected_total, 1) * 100)),
        "audit_id":         audit_id,
        "status":           status,
    }

# def get_blackbox_history(ai_name: str, current_user=Depends(get_current_user)):
#     records = list(
#         blackbox_collection.find(
#             {"ai_name": ai_name, "owner_id": str(current_user["_id"])},
#             {"_id": 0, "probe_results": 0},
#         ).sort("created_at", -1).limit(10)
#     )
#     return {"history": records}


# ── All audits for current user ────────────────────────────────────────────────

@router.get("/history-all")
def get_all_blackbox_history(current_user=Depends(get_current_user)):
    records = list(
        blackbox_collection.find(
            {"owner_id": str(current_user["_id"])},
            # exclude only large raw data — keep all delta/rerun fields for comparison view
            {"_id": 0, "probe_results": 0, "api_key": 0, "reconciliation": 0},
            sort=[("created_at", -1)],
            limit=100,
        )
    )
    for r in records:
        for field in ("created_at", "started_at", "completed_at"):
            if isinstance(r.get(field), datetime):
                r[field] = r[field].isoformat()
    return {"history": records}


# ── Audit chain by audit_id ────────────────────────────────────────────────────

@router.get("/audit-chain/{audit_id}")
def get_audit_chain(audit_id: str, current_user=Depends(get_current_user)):
    """
    Returns the full audit lineage (original + all re-runs) for the AI system
    that owns the given audit_id, sorted by rerun_sequence ascending.
    Used by AuditHistoryTimeline on the Report and Profile pages.
    """
    owner_id = str(current_user["_id"])
    anchor = blackbox_collection.find_one(
        {"audit_id": audit_id, "owner_id": owner_id},
        {"_id": 0, "ai_name": 1},
    )
    if not anchor:
        raise HTTPException(status_code=404, detail="Audit not found.")
    ai_name = anchor.get("ai_name", "")
    chain = list(
        blackbox_collection.find(
            {"ai_name": ai_name, "owner_id": owner_id},
            # Keep delta_summary + principle_deltas for timeline chart; strip only raw probe data
            {"_id": 0, "api_key": 0, "probe_results": 0, "reconciliation": 0,
             "findings": 0, "resolved_findings": 0, "persisting_findings": 0, "new_findings": 0,
             "phase1_delta": 0},
            sort=[("rerun_sequence", 1), ("created_at", 1)],
            limit=50,
        )
    )
    for r in chain:
        for field in ("created_at", "started_at", "completed_at"):
            if isinstance(r.get(field), datetime):
                r[field] = r[field].isoformat()
    return {"ai_name": ai_name, "chain": chain}


# ── Audit chain by AI name ─────────────────────────────────────────────────────

@router.get("/audit-chain-summary/{ai_name}")
def get_audit_chain_by_name(ai_name: str, current_user=Depends(get_current_user)):
    """
    Same as /audit-chain/{audit_id} but keyed by ai_name directly.
    Used by AuditHistoryTimeline when ai_name is available without an audit_id.
    """
    owner_id = str(current_user["_id"])
    chain = list(
        blackbox_collection.find(
            {"ai_name": ai_name, "owner_id": owner_id},
            {"_id": 0, "api_key": 0, "probe_results": 0, "reconciliation": 0,
             "findings": 0, "resolved_findings": 0, "persisting_findings": 0, "new_findings": 0,
             "phase1_delta": 0},
            sort=[("rerun_sequence", 1), ("created_at", 1)],
            limit=50,
        )
    )
    for r in chain:
        for field in ("created_at", "started_at", "completed_at"):
            if isinstance(r.get(field), datetime):
                r[field] = r[field].isoformat()
    return {"ai_name": ai_name, "chain": chain}


# ── Single audit full detail ───────────────────────────────────────────────────

@router.get("/audit/{audit_id}")
def get_blackbox_audit(audit_id: str, current_user=Depends(get_current_user)):
    record = blackbox_collection.find_one(
        {"audit_id": audit_id, "owner_id": str(current_user["_id"])},
        {"_id": 0, "api_key": 0},
    )
    if not record:
        raise HTTPException(status_code=404, detail="Audit not found.")
    for field in ("created_at", "started_at", "completed_at"):
        if isinstance(record.get(field), datetime):
            record[field] = record[field].isoformat()
    return record


# ── Re-run Audit ───────────────────────────────────────────────────────────────

@router.post("/audit/rerun")
async def run_blackbox_rerun(
    payload:     RerunRequest,
    current_user=Depends(get_current_user),
):
    """
    Trigger a re-run of a prior blackbox audit.

    Always re-runs Phase 1 behavioral fingerprinting, determines probing scope
    from the fingerprint delta (or scope_override), and returns a full delta
    comparison against the prior audit.
    """
    from app.services.blackbox.rerun_orchestrator import run_rerun_pipeline

    result = await run_rerun_pipeline(
        prior_audit_id=payload.prior_audit_id,
        user_context=payload.user_context,
        scope_override=payload.scope_override,
        endpoint=payload.endpoint or "",
        api_key=payload.api_key or "",
        mode=payload.mode,
        current_user=current_user,
        db_collection=blackbox_collection,
    )

    from app.database import users_collection
    users_collection.update_one(
        {"_id": current_user["_id"]},
        {"$inc": {"audit_count": 1}},
    )

    return result


# ── Re-run History by AI name ──────────────────────────────────────────────────

@router.get("/rerun-history/{ai_name}")
def get_rerun_history(ai_name: str, current_user=Depends(get_current_user)):
    """
    Returns all audit documents (original + re-runs) for a given AI system,
    sorted by rerun_sequence ascending and created_at descending within each
    sequence level.
    """
    records = list(
        blackbox_collection.find(
            {"ai_name": ai_name, "owner_id": str(current_user["_id"])},
            {"_id": 0, "probe_results": 0, "api_key": 0},
            sort=[("rerun_sequence", 1), ("created_at", -1)],
            limit=50,
        )
    )
    for r in records:
        for field in ("created_at", "started_at", "completed_at"):
            if isinstance(r.get(field), datetime):
                r[field] = r[field].isoformat()
    return {"history": records, "ai_name": ai_name}