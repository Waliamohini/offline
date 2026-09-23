"""
app/services/report_persistence.py
====================================
Fans a freshly-computed report (and the LLM judge panel's raw deliberation)
out into the normalized tables added alongside `reports`. This runs
*after* reports_collection.insert_one(report_doc) succeeds, and is
non-fatal by design (wrapped in try/except at the call site in
ai_routes.py) — a failure here should never prevent a report from being
saved and returned to the user, since the JSONB blob on `reports` is still
the source of truth the frontend reads from today.

Every row written here carries report_id + ai_system_id + owner_id so a
single AI system's full audit history (scores, sub-parameters, findings,
regulatory alignment, taxonomy controls, judge panel votes) is one indexed
query away instead of requiring the caller to parse nested JSON.
"""
from __future__ import annotations

import uuid
from typing import Any, Optional

from app.services.report_definitions import PRINCIPLE_DESCRIPTIONS, SUB_PARAMETER_DEFINITIONS

# Sub-parameters whose value comes from an engine-tier metric flagged in
# compute_all_sub_parameters() as "_engine_pii" / "_engine_toxicity"
# ("ml" when a real model is available, "heuristic" for the regex/keyword
# fallback). Everything else is always formula/regex-computed, so "engine"
# is left null for those rows rather than guessed at.
_ENGINE_TIER_SUB_PARAMS = {
    "pii_in_outputs":        "_engine_pii",
    "pii_leakage_rate":      "_engine_pii",
    "harmful_content_rate":  "_engine_toxicity",
    "harm_prevention_rate":  "_engine_toxicity",
}


def _uuid_or_none(val) -> Optional[str]:
    if not val:
        return None
    try:
        return str(uuid.UUID(str(val)))
    except (ValueError, TypeError):
        return None


def persist_report_breakdown(report_doc: dict, report_id: str, ai_system_id, owner_id: str) -> None:
    """
    Writes report_principle_scores, report_sub_parameters, report_findings,
    report_framework_compliance (+ report_framework_principle_scores), and
    report_model_metrics from a completed report_doc.
    """
    from app.database import (
        report_principle_scores_collection,
        report_sub_parameters_collection,
        report_findings_collection,
        report_framework_compliance_collection,
        report_framework_principle_scores_collection,
        report_model_metrics_collection,
    )

    ai_system_id = _uuid_or_none(ai_system_id)

    # ── Principle scores + sub-parameters ──────────────────────────────────────
    principles: dict = report_doc.get("trusted_ai_principles") or {}
    for principle_name, pdata in principles.items():
        if not isinstance(pdata, dict):
            continue
        report_principle_scores_collection.insert_one({
            "report_id":    report_id,
            "ai_system_id": ai_system_id,
            "owner_id":     owner_id,
            "principle":    principle_name,
            "score":        pdata.get("score"),
            "description":  pdata.get("description") or PRINCIPLE_DESCRIPTIONS.get(principle_name, ""),
        })

        parameters: dict = pdata.get("parameters") or {}
        for sub_param_name, sub_score in parameters.items():
            if sub_param_name.startswith("_"):
                continue  # internal engine-tier flags (e.g. "_engine_pii"), not a real sub-parameter
            try:
                score_val = float(sub_score) if sub_score is not None else None
            except (TypeError, ValueError):
                score_val = None
            engine_flag_key = _ENGINE_TIER_SUB_PARAMS.get(sub_param_name)
            engine_val = parameters.get(engine_flag_key) if engine_flag_key else None
            report_sub_parameters_collection.insert_one({
                "report_id":     report_id,
                "ai_system_id":  ai_system_id,
                "owner_id":      owner_id,
                "principle":     principle_name,
                "sub_parameter": sub_param_name,
                "score":         score_val,
                "definition":    SUB_PARAMETER_DEFINITIONS.get(sub_param_name, ""),
                "engine":        engine_val if isinstance(engine_val, str) else None,
            })

    # ── Findings ────────────────────────────────────────────────────────────────
    for finding in (report_doc.get("findings") or []):
        if not isinstance(finding, dict):
            continue
        report_findings_collection.insert_one({
            "report_id":      report_id,
            "ai_system_id":   ai_system_id,
            "owner_id":       owner_id,
            "category":       finding.get("category"),
            "severity":       finding.get("severity"),
            "issue":          finding.get("issue"),
            "recommendation": finding.get("recommendation"),
            "finding_type":   finding.get("type"),
        })

    # ── Regulatory / framework alignment ──────────────────────────────────────
    framework_compliance: dict = report_doc.get("framework_compliance") or {}
    for framework_name, fdata in framework_compliance.items():
        if not isinstance(fdata, dict):
            continue
        fw_result = report_framework_compliance_collection.insert_one({
            "report_id":      report_id,
            "ai_system_id":   ai_system_id,
            "owner_id":       owner_id,
            "framework":      framework_name,
            "status":         fdata.get("status"),
            "overall_score":  fdata.get("overall_score"),
            "threshold":      fdata.get("threshold"),
        })
        fw_id = fw_result.inserted_id
        for principle_name, pscore in (fdata.get("principle_scores") or {}).items():
            report_framework_principle_scores_collection.insert_one({
                "framework_compliance_id": fw_id,
                "principle":               principle_name,
                "score":                   pscore,
            })

    # ── Model metrics ───────────────────────────────────────────────────────────
    for metric_key, mdata in (report_doc.get("model_metrics") or {}).items():
        if not isinstance(mdata, dict):
            continue
        report_model_metrics_collection.insert_one({
            "report_id":          report_id,
            "ai_system_id":       ai_system_id,
            "owner_id":           owner_id,
            "metric_key":         metric_key,
            "value":              mdata.get("value"),
            "risk_level":         mdata.get("risk_level"),
            "unit":               mdata.get("unit"),
            "description":        mdata.get("description"),
            "threshold_low":      mdata.get("threshold_low"),
            "threshold_moderate": mdata.get("threshold_moderate"),
            "higher_is_better":   mdata.get("higher_is_better"),
        })


def persist_taxonomy_controls(taf_rows: list[dict], audit_id: str, report_id, ai_system_id, owner_id: str) -> None:
    """
    Writes one report_taxonomy_controls row per Control Matrix entry, replacing
    the single JSONB `rows` array that used to be the only place this lived
    (on taf_assessments). Called right after compute_taf_mapping() runs.
    """
    from app.database import report_taxonomy_controls_collection

    ai_system_id = _uuid_or_none(ai_system_id)
    report_id = _uuid_or_none(report_id)

    for row in (taf_rows or []):
        if not isinstance(row, dict):
            continue
        report_taxonomy_controls_collection.insert_one({
            "audit_id":         audit_id,
            "report_id":        report_id,
            "ai_system_id":     ai_system_id,
            "owner_id":         owner_id,
            "numbered_id":      row.get("numbered_id"),
            "category":         row.get("category"),
            "category_full":    row.get("category_full"),
            "pillar":           row.get("pillar"),
            "risk_description": row.get("risk"),
            "test_description": row.get("test"),
            "base_mapped":      row.get("base_mapped"),
            "computed_status":  row.get("computed_status"),
            "evidence":         row.get("evidence"),
            "score":            row.get("score"),
            "score_source":     row.get("score_source"),
            "training_gated":   row.get("training_gated"),
            "evidence_chain":   row.get("where"),
            "data_required":    row.get("data_required") or row.get("confidence_note"),
        })


def persist_judge_panel_results(judge_result: dict, report_id: str, ai_system_id, owner_id: str,
                                 questions: Optional[list[str]] = None,
                                 outputs: Optional[list[str]] = None,
                                 task_ids: Optional[list[str]] = None) -> None:
    """
    Writes one llm_judge_row_verdicts row per row judged, and one
    llm_judge_votes row per (row, judge) pair — this is the panel
    deliberation that previously existed only in memory during
    run_llm_judge() and was discarded once the aggregate accuracy % was
    computed.
    """
    from app.database import llm_judge_row_verdicts_collection, llm_judge_votes_collection

    ai_system_id = _uuid_or_none(ai_system_id)

    labels        = judge_result.get("labels") or []
    confidences   = judge_result.get("confidence") or []
    reasons_list  = judge_result.get("reasons") or []
    votes_list    = judge_result.get("votes") or []
    latencies_list = judge_result.get("latencies") or []
    kb_flags      = judge_result.get("kb_used") or []
    row_indices   = judge_result.get("row_indices") or []
    disputed_set  = set(judge_result.get("disputed_rows") or [])

    for i in range(len(labels)):
        row_index = row_indices[i] if i < len(row_indices) else i
        votes:      dict = votes_list[i] if i < len(votes_list) else {}
        reasons:    dict = reasons_list[i] if i < len(reasons_list) else {}
        latencies:  dict = latencies_list[i] if i < len(latencies_list) else {}

        verdict_result = llm_judge_row_verdicts_collection.insert_one({
            "report_id":     report_id,
            "ai_system_id":  ai_system_id,
            "owner_id":      owner_id,
            "row_index":     row_index,
            "task_id":       task_ids[row_index] if task_ids and row_index < len(task_ids) else None,
            "input":         questions[row_index] if questions and row_index < len(questions) else None,
            "output":        outputs[row_index] if outputs and row_index < len(outputs) else None,
            "final_correct": bool(labels[i]),
            "confidence":    confidences[i] if i < len(confidences) else None,
            "disputed":      row_index in disputed_set,
            "kb_used":       kb_flags[i] if i < len(kb_flags) else None,
        })
        verdict_id = verdict_result.inserted_id

        for judge_name, vote in votes.items():
            llm_judge_votes_collection.insert_one({
                "row_verdict_id": verdict_id,
                "judge_name":     judge_name,
                "vote":           bool(vote),
                "reason":         reasons.get(judge_name, ""),
                "latency_ms":     latencies.get(judge_name),
            })