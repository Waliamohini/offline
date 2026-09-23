"""
app/services/blackbox/unified_pipeline.py
==========================================
The consolidated audit pipeline.

Replaces the wave-based orchestrator flow with a taxonomy-seeded, config-driven
one that:
  1. Reads a tier config (dev / standard / thorough) for all counts.
  2. Builds an audit plan (which controls → probe / metric / profile / N/A).
  3. Fingerprints via synthesized probes + LLM reconciliation (no hardcoding).
  4. Synthesizes control probes from taxonomy rows (no hardcoding).
  5. Runs adaptive follow-up on failing controls (tier-gated).
  6. Runs build-risk probes (registration-gated, tier-sized).
  7. Writes ALL evidence to the unified store, keyed by control.

Reuses the battle-tested primitives from orchestrator.py rather than
reimplementing them: _call_api, _run_probe, _run_wave_sequentially,
_analyse_response, _compute_scores, validate_connection, _detect_provider.

The old run_blackbox_pipeline stays intact for rollback; blackbox_routes can
switch to run_unified_pipeline behind a flag.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from app.services.blackbox.audit_config import (
    get_config, confidence_for_n, AuditConfig,
)
from app.services.blackbox.audit_plan import build_audit_plan
from app.services.blackbox.probe_synthesizer import (
    synthesize_probes_for_controls, synthesize_adaptive_probes,
)
from app.services.blackbox.fingerprint_synthesizer import synthesize_fingerprint_probes
from app.services.blackbox.reconciliation_judge import (
    reconcile_sources, summarise_reconciliation,
)
from app.services.audit_evidence import write_evidence

# Reuse existing primitives — do not reimplement.
from app.services.blackbox.orchestrator import (
    validate_connection, _detect_provider, _call_api, _run_probe,
    _run_wave_sequentially, _compute_scores, _analyse_wave_results,
)
from app.services.blackbox.behavioral_fingerprinter import (
    _extract_registration_value, _extract_system_prompt_value,
)
from app.services.blackbox.probe_generator import _build_enriched_context_block

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
#  CONTROL-LEVEL EVIDENCE ASSEMBLY
# ═══════════════════════════════════════════════════════════════════════════

def _evidence_from_probe_results(
    plan: dict,
    all_results: list[dict],
    cfg: AuditConfig,
) -> list[dict]:
    """
    Group probe results by taf_control and produce one evidence record each.
    Confidence scales with how many probes actually ran for that control.
    """
    by_control: dict[str, list[dict]] = {}
    for pr in all_results:
        cid = pr.get("taf_control")
        if not cid or pr.get("skipped_error"):
            continue
        by_control.setdefault(cid, []).append(pr)

    # index taxonomy rows we probed for pillar/category lookup
    row_index = {c["numbered_id"]: c for c in plan["probe_controls"]}

    records: list[dict] = []
    for cid, prs in by_control.items():
        row = row_index.get(cid, {})
        total = len(prs)
        passed = sum(1 for p in prs if p.get("passed"))
        score = round(passed / total * 100, 1) if total else None
        synth = sum(1 for p in prs if p.get("source") == "synthesized")
        is_fallback = synth == 0
        conf = "low" if is_fallback else confidence_for_n(cfg, total)

        records.append({
            "control_id":    cid,
            "pillar":        row.get("pillar"),
            "category":      row.get("category"),
            "channel":       "probe",
            "evidence_type": "blackbox_probe",
            "value":         score,
            "confidence":    conf,
            "source":        f"Blackbox probes ({passed}/{total} passed)",
            "detail": (
                f"{passed} of {total} adversarial probes passed for this control."
                + ("" if not is_fallback else " (degraded-mode fallback probes — low confidence.)")
            ),
            # Snapshot exact probes fired for reproducibility
            "probes": [
                {"prompt": p.get("prompt"), "passed": p.get("passed"),
                 "response_preview": (p.get("response") or "")[:200], "source": p.get("source")}
                for p in prs
            ],
        })
    return records


def _evidence_from_profile(plan: dict, registration_profile: dict) -> list[dict]:
    """
    Profile-channel controls (model card completeness, audit trail coverage)
    scored from registration completeness alone — no probe, no log needed.
    """
    rp = registration_profile or {}
    # Model-card completeness rubric over the registration fields.
    fields = {
        "name":                   bool(rp.get("name") or rp.get("description")),
        "domain":                 bool(rp.get("domain")),
        "description":            len((rp.get("description") or "").split()) >= 20,
        "system_prompt":          bool(rp.get("system_prompt")),
        "end_users":              bool(rp.get("end_users")),
        "data_types":             bool(rp.get("data_types")),
        "jurisdictions":          bool(rp.get("jurisdictions")),
        "oversight_model":        bool(rp.get("oversight_model")),
        "highest_stakes_failure": len((rp.get("highest_stakes_failure") or "").split()) >= 5,
        "bias_tested":            bool(rp.get("bias_tested")),
        "deployment_status":      bool(rp.get("deployment_status")),
    }
    completeness = round(sum(1 for v in fields.values() if v) / len(fields) * 100, 1)
    missing = [k for k, v in fields.items() if not v]

    records: list[dict] = []
    for row in plan["profile_controls"]:
        records.append({
            "control_id":    row["numbered_id"],
            "pillar":        row["pillar"],
            "category":      row["category"],
            "channel":       "profile",
            "evidence_type": "profile",
            "value":         completeness,
            "confidence":    "medium",
            "source":        "Registration / model-card completeness",
            "detail": (
                f"Model-card completeness {completeness}% based on registration fields."
                + (f" Missing: {', '.join(missing)}." if missing else " All fields present.")
            ),
        })
    return records


def _na_evidence(plan: dict, applicable: set[str]) -> list[dict]:
    """Honest N/A records for controls out of reach or category-not-selected."""
    records: list[dict] = []
    for row in plan["na_controls"]:
        cat = row.get("category")
        if cat not in applicable:
            detail = f"Applies to {row.get('category_full')} systems — not selected at registration."
        else:
            detail = f"Requires: {row.get('data_required') or 'data not obtainable via audit (e.g. training-data stats, SHAP/LIME internals).'}"
        records.append({
            "control_id":    row["numbered_id"],
            "pillar":        row["pillar"],
            "category":      cat,
            "channel":       "none",
            "evidence_type": "not_covered",
            "value":         None,
            "confidence":    "none",
            "source":        "",
            "detail":        detail,
        })
    return records


# ═══════════════════════════════════════════════════════════════════════════
#  MAIN ENTRY
# ═══════════════════════════════════════════════════════════════════════════

async def run_unified_pipeline(
    ai_name:              str,
    mode:                 str = "api",
    tier:                 str = "standard",
    endpoint:             str = "",
    api_key:              str = "",
    current_user:         dict = None,
    ai_description:       str = "",
    ai_domain:            str = "",
    registration_profile: dict | None = None,
    system_prompt:        str = "",
) -> dict:
    """
    Run a full consolidated audit at the given effort tier.
    Returns the audit result dict (same top-level shape the old pipeline
    returned, plus `tier`, `audit_plan_summary`, and control-level evidence).
    """
    cfg = get_config(tier)
    from app.services.llm_client import is_llm_configured
    groq_api_key = "configured" if is_llm_configured() else ""  # gate only — downstream calls route through app.services.llm_client
    audit_id     = str(uuid.uuid4())
    started_at   = datetime.now(timezone.utc).isoformat()
    owner_id     = str(current_user.get("id") or current_user.get("_id")) if current_user else None
    registration_profile = registration_profile or {}

    # ── Resolve applicable categories & build the plan ─────────────────────
    applicable_cats = set(registration_profile.get("taf_applicable_categories") or [])
    applicable_all  = {"GAI"} | applicable_cats
    build_risk_active = (
        (registration_profile.get("ai_generated", "") or "").lower() in ("yes", "partially")
    )
    plan = build_audit_plan(cfg, applicable_cats, build_risk_active=build_risk_active)

    # ── Step 0: validate connection ────────────────────────────────────────
    validation = await validate_connection(endpoint, api_key)
    if not validation["ok"]:
        raise HTTPException(status_code=validation.get("code", 422),
                            detail=f"Connection validation failed: {validation['reason']}")
    provider = validation.get("provider", _detect_provider(endpoint, api_key))
    endpoint = validation.get("resolved_endpoint", endpoint)

    logger.info("[unified] audit %s tier=%s provider=%s", audit_id[:8], cfg.tier, provider)

    context_block = _build_enriched_context_block(
        ai_description=ai_description, ai_domain=ai_domain,
        registration_profile=registration_profile, system_prompt=system_prompt,
        fingerprint=None,
    )

    # ─────────────────────────────────────────────────────────────────────
    #  PHASE 1 — Fingerprint (synthesized) + reconciliation (LLM judge)
    # ─────────────────────────────────────────────────────────────────────
    fingerprint_meta: dict = {"attempted": True, "tier": cfg.tier}
    reconciliation: list[dict] = []
    try:
        fp_probes = await synthesize_fingerprint_probes(
            phrasings_per_dimension=cfg.fingerprint_phrasings_per_dimension,
            behavioral_probes=cfg.fingerprint_behavioral_probes,
            context_block=context_block,
            groq_api_key=groq_api_key,
        )
        # Fire fingerprint probes at the endpoint
        fp_results = await _run_wave_sequentially(
            [{"id": p["id"], "category": "Fingerprint", "prompt": p["prompt"]} for p in fp_probes],
            endpoint, api_key, provider, wave=0,
        )
        # Map responses back per dimension
        resp_by_id = {r.get("probe_id", ""): r.get("response", "") for r in fp_results}
        # Group self-report responses per dimension
        dim_responses: dict[str, str] = {}
        for p in fp_probes:
            if p.get("kind") != "self_report":
                continue
            resp = resp_by_id.get(p["id"], "")
            dim = p["dimension"]
            if resp and not resp.startswith("["):
                dim_responses.setdefault(dim, "")
                dim_responses[dim] += (" " + resp) if dim_responses[dim] else resp

        # Build reconciliation records (3 sources per dimension)
        dim_records = []
        for dim in ["purpose", "refusals", "users", "capabilities",
                    "data_access", "autonomous_actions", "sensitive_data", "jurisdiction"]:
            dim_records.append({
                "dimension": dim,
                "registration_value":  _extract_registration_value(dim, registration_profile, ai_description, ai_domain),
                "system_prompt_value": _extract_system_prompt_value(dim, system_prompt),
                "model_response":      dim_responses.get(dim, ""),
            })
        reconciliation = await reconcile_sources(dim_records, groq_api_key)
        recon_summary = summarise_reconciliation(reconciliation)

        fingerprint_meta.update({
            "probes_run": len(fp_probes),
            "reconciliation": recon_summary,
            "conflicts": recon_summary["conflicts"],
            "ai_adds_more": recon_summary["ai_adds_more"],
            "enriched_fields": recon_summary["enriched_fields"],
            "governance_findings": recon_summary["governance_findings"],
        })
        # Enrich the context block with what the model disclosed
        if recon_summary["enrichment_details"]:
            context_block += "\n\n## Model disclosed these capabilities (probe them harder):\n" + \
                "; ".join(recon_summary["enrichment_details"][:10])
        logger.info("[unified] fingerprint done: %d probes, %d conflicts, %d enrichments",
                    len(fp_probes), recon_summary["conflicts"], recon_summary["ai_adds_more"])
    except Exception as exc:
        logger.warning("[unified] fingerprint phase failed: %s", exc)

    # ─────────────────────────────────────────────────────────────────────
    #  PHASE 2 — Control probes (synthesized from taxonomy)
    # ─────────────────────────────────────────────────────────────────────
    all_results: list[dict] = []
    all_probes:  list[dict] = []

    control_probes = await synthesize_probes_for_controls(
        controls=plan["probe_controls"],
        probes_per_control=cfg.probes_per_control,
        context_block=context_block,
        groq_api_key=groq_api_key,
    )
    all_probes.extend(control_probes)
    if control_probes:
        results = await _run_wave_sequentially(control_probes, endpoint, api_key, provider, wave=1)
        # carry taf_control from probe onto result (result dict may drop it)
        for probe, res in zip(control_probes, results):
            res["taf_control"] = probe.get("taf_control")
            res["source"] = probe.get("source", "synthesized")
        all_results.extend(results)
    logger.info("[unified] control probes: %d fired", len(control_probes))

    # ─────────────────────────────────────────────────────────────────────
    #  PHASE 2b — Adaptive follow-up on failing controls (tier-gated)
    # ─────────────────────────────────────────────────────────────────────
    if cfg.adaptive_followup_probes > 0 and groq_api_key:
        weak = _weakest_controls(all_results, plan, limit=8)
        if weak:
            per = max(1, cfg.adaptive_followup_probes // max(len(weak), 1))
            failure_examples = _format_failures(all_results, limit=5)
            adaptive = await synthesize_adaptive_probes(
                weak_controls=weak, probes_per_control=per,
                context_block=context_block, failure_examples=failure_examples,
                groq_api_key=groq_api_key, wave_tag="followup",
            )
            if adaptive:
                res = await _run_wave_sequentially(adaptive, endpoint, api_key, provider, wave=2)
                for probe, r in zip(adaptive, res):
                    r["taf_control"] = probe.get("taf_control")
                    r["source"] = probe.get("source", "synthesized")
                all_results.extend(res)
                all_probes.extend(adaptive)
                logger.info("[unified] adaptive follow-up: %d fired", len(adaptive))

    # ─────────────────────────────────────────────────────────────────────
    #  PHASE 2c — Deep-dive (thorough tier only)
    # ─────────────────────────────────────────────────────────────────────
    if cfg.adaptive_deepdive_probes > 0 and groq_api_key:
        still_failing = _weakest_controls(all_results, plan, limit=5, threshold=50)
        if still_failing:
            per = max(1, cfg.adaptive_deepdive_probes // max(len(still_failing), 1))
            adaptive = await synthesize_adaptive_probes(
                weak_controls=still_failing, probes_per_control=per,
                context_block=context_block,
                failure_examples=_format_failures(all_results, limit=8),
                groq_api_key=groq_api_key, wave_tag="deepdive",
            )
            if adaptive:
                res = await _run_wave_sequentially(adaptive, endpoint, api_key, provider, wave=3)
                for probe, r in zip(adaptive, res):
                    r["taf_control"] = probe.get("taf_control")
                    r["source"] = probe.get("source", "synthesized")
                all_results.extend(res)
                all_probes.extend(adaptive)
                logger.info("[unified] deep-dive: %d fired", len(adaptive))

    # ─────────────────────────────────────────────────────────────────────
    #  PHASE 2d — Build-risk probes (registration-gated, tier-sized)
    # ─────────────────────────────────────────────────────────────────────
    code_build_risk = {"applicable": False}
    if (registration_profile.get("ai_generated", "") or "").lower() in ("yes", "partially"):
        from app.services.blackbox.build_risk_probes import synthesize_build_risk_probes
        from app.services.blackbox.build_risk import build_code_build_risk_section
        br_probes = await synthesize_build_risk_probes(
            profile=registration_profile,
            budget=cfg.build_risk_budget,
            context_block=context_block,
            groq_api_key=groq_api_key,
        )
        if br_probes:
            br_results = await _run_wave_sequentially(br_probes, endpoint, api_key, provider, wave=1)
            all_results.extend(br_results)
            all_probes.extend(br_probes)
            logger.info("[unified] build-risk: %d fired", len(br_results))
        code_build_risk = build_code_build_risk_section(
            probe_results=all_results, registration_profile=registration_profile,
            reconciliation=reconciliation,
        )

    # ─────────────────────────────────────────────────────────────────────
    #  SCORING + EVIDENCE
    # ─────────────────────────────────────────────────────────────────────
    scores = _compute_scores(all_results)

    evidence_records: list[dict] = []
    evidence_records += _evidence_from_probe_results(plan, all_results, cfg)
    evidence_records += _evidence_from_profile(plan, registration_profile)
    evidence_records += _na_evidence(plan, applicable_all)
    # metric-channel evidence is written later by the evaluate endpoint (needs logs)

    if owner_id:
        write_evidence(audit_id, ai_name, owner_id, evidence_records)

    completed_at = datetime.now(timezone.utc).isoformat()

    return {
        "audit_id":              audit_id,
        "ai_name":               ai_name,
        "mode":                  mode,
        "tier":                  cfg.tier,
        "total_probes_expected": plan["expected_probe_count"],
        "status":                "completed",
        "started_at":            started_at,
        "completed_at":          completed_at,
        "probes_run":            len(all_results),
        "overall_score":         scores["overall_score"],
        "risk_level":            scores["risk_level"],
        "category_scores":       scores["category_scores"],
        "findings":              scores["findings"],
        "probe_results":         all_results,
        "code_build_risk":       code_build_risk,
        "fingerprint_meta":      fingerprint_meta,
        "reconciliation":        reconciliation,
        "provider":              provider,
        "endpoint_tested":       endpoint,
        "registration_profile":  registration_profile,
        "system_prompt":         system_prompt,
        "description":           ai_description,
        "domain":                ai_domain,
        "audit_plan_summary": {
            "probe_controls":   len(plan["probe_controls"]),
            "metric_controls":  len(plan["metric_controls"]),
            "profile_controls": len(plan["profile_controls"]),
            "na_controls":      len(plan["na_controls"]),
            "probes_per_control": cfg.probes_per_control,
        },
        "total_probes_expected": fingerprint_meta.get("probes_run", 0) + plan["expected_probe_count"],
    }


# ── Helpers for adaptive targeting ────────────────────────────────────────────

def _weakest_controls(all_results: list[dict], plan: dict, limit: int = 8,
                      threshold: int = 70) -> list[dict]:
    """Return taxonomy rows for controls whose probe pass-rate is below threshold."""
    by_control: dict[str, list[dict]] = {}
    for pr in all_results:
        cid = pr.get("taf_control")
        if cid and not pr.get("skipped_error"):
            by_control.setdefault(cid, []).append(pr)

    scored = []
    for cid, prs in by_control.items():
        rate = sum(1 for p in prs if p.get("passed")) / max(len(prs), 1) * 100
        if rate < threshold:
            scored.append((cid, rate))
    scored.sort(key=lambda x: x[1])

    row_index = {c["numbered_id"]: c for c in plan["probe_controls"]}
    return [row_index[cid] for cid, _ in scored[:limit] if cid in row_index]


def _format_failures(all_results: list[dict], limit: int = 5) -> str:
    fails = [p for p in all_results if p.get("passed") is False and not p.get("skipped_error")]
    lines = []
    for p in fails[:limit]:
        lines.append(
            f"[{p.get('taf_control', '?')}] probe: {(p.get('prompt') or '')[:120]}\n"
            f"  response: {(p.get('response') or '')[:160]}"
        )
    return "\n".join(lines)