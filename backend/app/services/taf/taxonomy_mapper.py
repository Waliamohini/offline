"""
app/services/taf/taxonomy_mapper.py
=====================================
KPMG Trusted AI Framework taxonomy mapping engine — v2.

Reads per-control evidence from the unified audit_evidence store instead of
stitching three different result dicts together. Falls back to the probe-result
and principle-score chain only for legacy audits that predate the evidence store.

Score priority (new path):
  1. audit_evidence store (highest-confidence record per control)

Score priority (legacy fallback):
  2. Blackbox probe pass-rate for that pillar  (category_scores)
  3. TAF principle score from evaluate report  (trusted_ai_principles)
  4. Training data metric                      (training-gated controls)
  5. None
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_TAXONOMY_PATH = Path(__file__).parent.parent.parent / "config" / "taf_taxonomy.json"

def _load_taxonomy() -> List[Dict]:
    with open(_TAXONOMY_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

TAXONOMY: List[Dict] = _load_taxonomy()

_MODEL_TYPE_TO_CATEGORY: Dict[str, str] = {
    "general_llm":    "GAI",
    "rag":            "GAI",
    "summarization":  "GAI",
    "classification": "PAI",
    "automation":     "DM",
}

def detect_ai_category(model_type: str) -> str:
    return _MODEL_TYPE_TO_CATEGORY.get((model_type or "").lower(), "GAI")

_CATEGORY_FULL: Dict[str, str] = {row["category"]: row["category_full"] for row in TAXONOMY}

_PILLAR_TO_PROBE_CAT: Dict[str, List[str]] = {
    "Fairness":       ["Fairness", "Fair", "Bias", "Equity"],
    "Explainability": ["Explainability", "Explain", "Transparency", "Reasoning"],
    "Data Integrity": ["Data Integrity", "Accuracy", "Hallucination", "Groundedness"],
    "Security":       ["Security", "Robustness", "Adversarial", "Injection"],
    "Privacy":        ["Privacy", "Data Privacy", "PII"],
    "Transparency":   ["Transparency", "Disclosure", "Identity"],
    "Accountability": ["Accountability", "Governance", "Oversight"],
    "Reliability":    ["Reliability", "Consistency", "Stability"],
    "Safety":         ["Safety", "Harm", "Content Safety"],
    "Sustainability": ["Sustainability", "Environmental", "Energy"],
}

_PILLAR_TO_PRINCIPLE_KEY: Dict[str, str] = {
    p: p for p in [
        "Fairness", "Explainability", "Data Integrity", "Security", "Privacy",
        "Transparency", "Accountability", "Reliability", "Safety", "Sustainability",
    ]
}

_TRAINING_METRIC_MAP: Dict[str, str] = {
    "GAI.FAIR.04": "representation_score",
    "GAI.FAIR.05": "representation_score",
    "PAI.FAIR.01": "representation_score",
    "GAI.EXP.04":  "deduplication_rate",
    "GAI.DI.04":   "deduplication_rate",
    "GAI.SEC.04":  "_pii_inverse",
    "PAI.SEC.02":  "_pii_inverse",
    "GAI.PRI.04":  "_pii_inverse",
    "GAI.PRI.05":  "_pii_inverse",
    "PAI.PRI.01":  "_pii_inverse",
    "GAI.REL.05":  "deduplication_rate",
    "GAI.SUS.04":  "_compute_score",
    "GAI.SUS.05":  "_compute_score",
    "PAI.SUS.01":  "_compute_score",
    "DM.SUS.01":   "_compute_score",
    "DP.SUS.01":   "_compute_score",
}


def _extract_training_metric(numbered_id: str, ta: Dict) -> Optional[float]:
    key = _TRAINING_METRIC_MAP.get(numbered_id)
    if not key:
        return None
    if key == "_compute_score":
        return {"small": 85.0, "medium": 62.0, "large": 38.0}.get(
            str(ta.get("compute_size_proxy", "medium")), 55.0)
    if key == "_pii_inverse":
        pii = ta.get("pii_exposure_rate")
        return round(max(0.0, 100.0 - float(pii)), 1) if pii is not None else None
    return ta.get(key)


def _probe_score_for_pillar(probe_results, category_scores, pillar):
    if category_scores:
        aliases = _PILLAR_TO_PROBE_CAT.get(pillar, [pillar])
        for alias in aliases:
            for key in category_scores:
                if alias.lower() == key.lower():
                    val = category_scores[key]
                    if isinstance(val, dict):
                        s = val.get("pass_rate") or val.get("score") or val.get("pct")
                        if s is not None:
                            return round(float(s) * (100 if float(s) <= 1 else 1), 1)
                    elif isinstance(val, (int, float)):
                        v = float(val)
                        return round(v * 100 if v <= 1 else v, 1)
    if not probe_results:
        return None
    aliases = _PILLAR_TO_PROBE_CAT.get(pillar, [pillar])
    relevant = [p for p in probe_results if any(a.lower() in str(p.get("category", "")).lower() for a in aliases)]
    if not relevant:
        return None
    passed = sum(1 for p in relevant if p.get("passed", False))
    return round(passed / len(relevant) * 100, 1)


def _principle_has_real_data(val) -> bool:
    """
    True only if this principle actually had sub-parameters computed.
    base_evaluator.param_score({}) returns 0 (not None) for a principle with
    zero sub-parameters, so a numeric score alone can't be trusted — an empty
    `parameters` dict means "never evaluated", not "evaluated and scored 0".
    """
    if not isinstance(val, dict):
        return val is not None
    params = val.get("parameters")
    return bool(params)  # non-empty dict = real sub-parameter data exists


def _principle_score_for_pillar(principles, pillar):
    if not principles:
        return None
    key = _PILLAR_TO_PRINCIPLE_KEY.get(pillar, pillar)
    if key in principles:
        val = principles[key]
        if not _principle_has_real_data(val):
            return None
        return val.get("score") if isinstance(val, dict) else float(val)
    for pkey, pval in principles.items():
        if key.lower() in pkey.lower() or pkey.lower() in key.lower():
            if not _principle_has_real_data(pval):
                return None
            return pval.get("score") if isinstance(pval, dict) else float(pval)
    return None


def _best_score(probe_results, category_scores, principles, pillar):
    s = _probe_score_for_pillar(probe_results, category_scores, pillar)
    return s if s is not None else _principle_score_for_pillar(principles, pillar)


def _source_label(probe_results, category_scores, principles, pillar):
    if _probe_score_for_pillar(probe_results, category_scores, pillar) is not None:
        return "Blackbox probe pass-rate"
    if _principle_score_for_pillar(principles, pillar) is not None:
        return "Governance evaluation score"
    return ""


def _evidence_confidence_to_status(base_mapped: str, confidence: str) -> str:
    """Convert evidence-store confidence to computed_status."""
    if base_mapped in ("No", "N/A"):
        return "Not Covered"
    if confidence in ("high", "medium"):
        return "Covered" if base_mapped == "Yes" else "Partial"
    if confidence in ("low", "proxy"):
        return "Partial"
    return "Partial" if base_mapped == "Partial" else "Covered"


def compute_taf_mapping(
    audit_result:           Dict[str, Any],
    report_result:          Optional[Dict[str, Any]] = None,
    training_analysis:      Optional[Dict[str, Any]] = None,
    ai_category:            str = "GAI",
    control_scores:         Optional[Dict[str, Any]] = None,
    applicable_categories:  Optional[List[str]] = None,
    # New param: evidence store keyed by control_id (from read_evidence_for_audit / read_latest_evidence)
    evidence_store:         Optional[Dict[str, Dict]] = None,
) -> Dict[str, Any]:
    """
    Compute TAF mapping for all applicable categories.

    When evidence_store is provided (new path), it is the PRIMARY source.
    The probe-result / principle-score chain is the LEGACY fallback.
    """
    if not applicable_categories:
        applicable_categories = [ai_category]
    applicable_set: set = {"GAI"} | set(applicable_categories)

    # ── Unpack legacy sources ──────────────────────────────────────────────
    probe_results: List[Dict] = audit_result.get("probe_results", []) or []
    if isinstance(probe_results, str):
        try:   probe_results = json.loads(probe_results)
        except Exception: probe_results = []
    if not isinstance(probe_results, list):
        probe_results = []

    raw_summary = audit_result.get("summary") or {}
    if isinstance(raw_summary, str):
        try:   raw_summary = json.loads(raw_summary)
        except Exception: raw_summary = {}
    category_scores: Dict = (raw_summary.get("category_scores")
                              or audit_result.get("category_scores") or {})
    if isinstance(category_scores, str):
        try:   category_scores = json.loads(category_scores)
        except Exception: category_scores = {}

    legacy_control_scores: Dict = audit_result.get("control_scores") or {}
    if isinstance(legacy_control_scores, str):
        try:   legacy_control_scores = json.loads(legacy_control_scores)
        except Exception: legacy_control_scores = {}

    principles: Dict = {}
    if report_result:
        raw_p = report_result.get("trusted_ai_principles") or {}
        if isinstance(raw_p, str):
            try:   raw_p = json.loads(raw_p)
            except Exception: raw_p = {}
        principles = raw_p or {}

    has_training = bool(training_analysis)
    store = evidence_store or {}

    # ── Map each taxonomy row ──────────────────────────────────────────────
    rows_out: List[Dict] = []

    for row in TAXONOMY:
        pillar        = row["pillar"]
        numbered_id   = row["numbered_id"]
        training_gated = row.get("training_gated", False)

        # Category not selected → N/A
        if row["category"] not in applicable_set:
            applicable_names = ", ".join(
                f"{_CATEGORY_FULL.get(c, c)} ({c})" for c in sorted(applicable_set)
            )
            rows_out.append({
                "numbered_id":     numbered_id,
                "category":        row["category"],
                "category_full":   row["category_full"],
                "pillar":          pillar,
                "risk":            row["risk"],
                "test":            row.get("test"),
                "base_mapped":     row["mapped"],
                "computed_status": "N/A",
                "evidence":        None,
                "score":           None,
                "score_source":    None,
                "training_gated":  training_gated,
                "where":           row.get("where"),
                "data_required":   (
                    f"Applies to {row['category_full']} ({row['category']}) AI systems only — "
                    f"this system is registered for: {applicable_names}."
                ),
                "confidence_note": row.get("confidence_note"),
            })
            continue

        base_mapped = row["mapped"]

        # ── NEW PATH: evidence store ─────────────────────────────────────
        ev = store.get(numbered_id)
        if ev:
            score      = ev.get("value")
            confidence = ev.get("confidence") or "low"
            source_lbl = ev.get("source") or ""
            detail     = ev.get("detail") or ""
            computed_status = _evidence_confidence_to_status(base_mapped, confidence)
            if base_mapped in ("No", "N/A"):
                if training_gated and has_training:
                    computed_status = "Training Unlocked"
                    score = _extract_training_metric(numbered_id, training_analysis or {})
                    source_lbl = "Training data analysis"
                    detail = f"Computed from training data."
                else:
                    computed_status = "Not Covered"
                    score = None
            corroboration = ev.get("corroboration")
            rows_out.append({
                "numbered_id":     numbered_id,
                "category":        row["category"],
                "category_full":   row["category_full"],
                "pillar":          pillar,
                "risk":            row["risk"],
                "test":            row.get("test"),
                "base_mapped":     base_mapped,
                "computed_status": computed_status,
                "evidence":        detail + (f" | Corroborated by: {corroboration[0]['source']}" if corroboration else ""),
                "score":           score,
                "score_source":    source_lbl,
                "training_gated":  training_gated,
                "where":           row.get("where"),
                "data_required":   row.get("data_required"),
                "confidence_note": f"Confidence: {confidence}",
                "confidence":      confidence,
            })
            continue

        # ── LEGACY FALLBACK PATH ─────────────────────────────────────────
        score: Optional[float] = None
        source_lbl = ""
        computed_status = base_mapped

        if base_mapped == "Yes":
            computed_status = "Covered"
            ctrl_data = legacy_control_scores.get(numbered_id)
            if ctrl_data:
                score = ctrl_data.get("pass_rate")
                source_lbl = f"TAF probe bank ({ctrl_data.get('passed',0)}/{ctrl_data.get('total',0)} probes passed)"
            else:
                score = _best_score(probe_results, category_scores, principles, pillar)
                source_lbl = _source_label(probe_results, category_scores, principles, pillar)
            # No real evidence anywhere (no probes, no evaluated sub-parameters) —
            # never claim "Covered" over a control with nothing behind it.
            if score is None:
                computed_status = "Not Covered"
                source_lbl = ""

        elif base_mapped == "Partial":
            computed_status = "Partial"
            ctrl_data = legacy_control_scores.get(numbered_id)
            if ctrl_data:
                score = ctrl_data.get("pass_rate")
                source_lbl = f"TAF probe bank ({ctrl_data.get('passed',0)}/{ctrl_data.get('total',0)} probes passed)"
            else:
                score = _best_score(probe_results, category_scores, principles, pillar)
                source_lbl = _source_label(probe_results, category_scores, principles, pillar)
            if score is None:
                computed_status = "Not Covered"
                source_lbl = ""

        elif base_mapped == "No":
            if training_gated and has_training:
                computed_status = "Training Unlocked"
                score = _extract_training_metric(numbered_id, training_analysis or {})
                source_lbl = "Training data analysis"
            else:
                computed_status = "Not Covered"

        evidence_str: Optional[str] = None
        if computed_status in ("Covered", "Partial") and score is not None:
            evidence_str = f"{source_lbl}: {score}%"
            conf_note = row.get("confidence_note") or ""
            if conf_note and computed_status == "Partial":
                evidence_str += f" | {conf_note}"
            where = row.get("where") or ""
            if where and where != "—":
                evidence_str += f" | Measured via: {where}"
        elif computed_status == "Training Unlocked":
            ta = training_analysis or {}
            if score is not None:
                evidence_str = f"Computed from training data: {score}%"
            evidence_str = (evidence_str or "") + f" | File: {ta.get('filename', 'uploaded training dataset')}"
        elif computed_status == "Not Covered":
            req = row.get("data_required") or ""
            if base_mapped in ("Yes", "Partial") and not req:
                # We expected evidence for this control but got none — say so plainly,
                # rather than silently showing a blank "Not Covered" row.
                evidence_str = "Not yet evaluated — run a Black Box Audit or upload inference logs to compute this control."
            elif req:
                evidence_str = f"Requires: {req}"

        rows_out.append({
            "numbered_id":     numbered_id,
            "category":        row["category"],
            "category_full":   row["category_full"],
            "pillar":          pillar,
            "risk":            row["risk"],
            "test":            row.get("test"),
            "base_mapped":     base_mapped,
            "computed_status": computed_status,
            "evidence":        evidence_str,
            "score":           score,
            "score_source":    source_lbl,
            "training_gated":  training_gated,
            "where":           row.get("where"),
            "data_required":   row.get("data_required"),
            "confidence_note": row.get("confidence_note"),
        })

    # ── Summaries ──────────────────────────────────────────────────────────
    applicable_rows = [r for r in rows_out if r["computed_status"] != "N/A"]
    covered         = sum(1 for r in applicable_rows if r["computed_status"] == "Covered")
    partial         = sum(1 for r in applicable_rows if r["computed_status"] == "Partial")
    not_covered     = sum(1 for r in applicable_rows if r["computed_status"] == "Not Covered")
    training_unlocked = sum(1 for r in applicable_rows if r["computed_status"] == "Training Unlocked")

    scored = [r for r in applicable_rows if r.get("score") is not None]
    overall = round(sum(r["score"] for r in scored) / len(scored), 1) if scored else None

    pillar_scores: Dict[str, Dict] = {}
    for r in applicable_rows:
        p = r["pillar"]
        pillar_scores.setdefault(p, {"scores": [], "statuses": []})
        if r.get("score") is not None:
            pillar_scores[p]["scores"].append(r["score"])
        pillar_scores[p]["statuses"].append(r["computed_status"])
    pillar_breakdown = {
        p: {
            "avg_score": round(sum(v["scores"]) / len(v["scores"]), 1) if v["scores"] else None,
            "covered":   sum(1 for s in v["statuses"] if s == "Covered"),
            "partial":   sum(1 for s in v["statuses"] if s == "Partial"),
            "not_covered": sum(1 for s in v["statuses"] if s == "Not Covered"),
        }
        for p, v in pillar_scores.items()
    }

    return {
        "rows": rows_out,
        "summary": {
            "overall_score":      overall,
            "covered":            covered,
            "partial":            partial,
            "not_covered":        not_covered,
            "training_unlocked":  training_unlocked,
            "total_applicable":   len(applicable_rows),
            "using_evidence_store": bool(store),
        },
        "pillar_breakdown":   pillar_breakdown,
        "ai_category":        ai_category,
        "has_training_data":  has_training,
    }


def analyse_training_data(df) -> Dict[str, Any]:
    """Kept here for backward compat; the heavy lifting is in taf_routes.py."""
    try:
        from app.routes.taf_routes import _analyse_training_df
        return _analyse_training_df(df)
    except Exception:
        pass
    return {
        "representation_score": None,
        "deduplication_rate": None,
        "pii_exposure_rate": None,
        "compute_size_proxy": "medium",
        "filename": "uploaded training dataset",
    }