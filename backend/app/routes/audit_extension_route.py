from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime

from app.services.blackbox.orchestrator import _analyse_response, _compute_scores

router = APIRouter(prefix="/api/v1/audit", tags=["audit"])


class ProbeResult(BaseModel):
    probe_id: str
    category: str
    prompt:   str
    response: str


class ExtensionAuditRequest(BaseModel):
    ai_name:       str
    mode:          str = "extension"
    ui_url:        Optional[str] = ""
    probe_results: List[ProbeResult]


@router.post("/score")
async def score_extension_audit(req: ExtensionAuditRequest):
    """
    Called by the Chrome extension after collecting all 14 probe responses.
    Runs analysis + scoring and returns a full audit report.
    The extension does the prompting; this endpoint does the analysis.
    """
    if not req.probe_results:
        raise HTTPException(status_code=422, detail="probe_results cannot be empty.")

    HTTP_ERROR_PREFIXES = ("[HTTP ", "[CONNECTION", "[ERROR", "[TIMEOUT")

    analysed = []
    for pr in req.probe_results:
        # Skip HTTP/transport errors — not a reflection of the AI's behaviour
        is_error = any(pr.response.startswith(p) for p in HTTP_ERROR_PREFIXES)
        if is_error:
            analysed.append({
                "probe_id":      pr.probe_id,
                "category":      pr.category,
                "prompt":        pr.prompt,
                "response":      pr.response,
                "passed":        None,
                "severity":      "Skipped",
                "note":          f"Skipped — transport/rate-limit error: {pr.response[:120]}",
                "skipped_error": True,
            })
            continue

        analysis = _analyse_response(pr.response, pr.category)
        analysed.append({
            "probe_id":      pr.probe_id,
            "category":      pr.category,
            "prompt":        pr.prompt,
            "response":      pr.response,
            "passed":        analysis["passed"],
            "severity":      analysis["severity"],
            "note":          analysis["note"],
            "skipped_error": False,
        })

    scores = _compute_scores(analysed)

    return {
        "audit_id":           str(uuid.uuid4()),
        "ai_name":            req.ai_name,
        "mode":               "extension",
        "status":             "completed",
        "completed_at":       datetime.utcnow().isoformat(),
        "probes_run":         len(analysed),
        "probes_evaluated":   scores["probes_evaluated"],
        "probes_skipped":     scores["probes_skipped"],
        "skipped_by_category": scores["skipped_by_category"],
        "overall_score":      scores["overall_score"],
        "risk_level":         scores["risk_level"],
        "category_scores":    scores["category_scores"],
        "findings":           scores["findings"],
        "probe_results":      analysed,
        "ui_url_tested":      req.ui_url,
    }


@router.get("/platforms")
async def get_platforms():
    """Returns list of known enterprise platforms for frontend dropdowns."""
    from app.services.blackbox.enterprise_router import list_platforms
    return list_platforms()