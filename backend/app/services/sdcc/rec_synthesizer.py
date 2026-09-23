"""
app/services/sdcc/rec_synthesizer.py
======================================
Generates all governance recommendations via Groq — synchronous, two-call design.

Why two calls?
--------------
10 principles × (what + owner + root_cause + 4 actions each) = ~2500+ tokens output.
At Groq's 8k TPM free tier, one call requesting 4000 output tokens exhausts the quota
immediately and often gets cut off mid-JSON. We split:
  Call 1A — high-priority principles (score < 75, or HIGH_IMPACT with score < 85)
  Call 1B — lower-priority principles (score >= 75 and not HIGH_IMPACT)
Both use max_tokens=2000. Together they stay within rate limits while covering everything.

Call 2 — build risk narratives (only when ai_generated flag is set).

Fallback discipline
-------------------
Each call has independent fallback. If Call 1A fails, 1B still runs.
If both fail, generic per-principle text is used and recs_generated=False is set.
The frontend shows a "re-run to generate" banner when recs_generated=False.

day_target clamping
-------------------
Groq proposes a specific day. The governance policy clamps to phase band:
  Phase 0 (Immediate)  → day 1–30
  Phase 1 (Short-term) → day 31–60
  Phase 2 (Ongoing)    → day 61–90
"""

from __future__ import annotations

import json
import logging
import os
import time
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_PHASE_CLAMP = {0: (1, 30), 1: (31, 60), 2: (61, 90)}
_HIGH_IMPACT  = {"Safety", "Privacy", "Security", "Fairness"}


# ── Phase assignment ───────────────────────────────────────────────────────────

def _phase_for(principle: str, score: int, regressed: bool = False) -> int:
    hi = principle in _HIGH_IMPACT
    if score < 50 or regressed:
        return 0
    if score < 75 or (hi and score < 85):
        return 1
    return 2


def _clamp_day(day: int, phase: int) -> int:
    lo, hi = _PHASE_CLAMP.get(phase, (1, 90))
    return max(lo, min(hi, int(day)))


# ── Key management ─────────────────────────────────────────────────────────────

def _get_groq_keys() -> list:
    from app.config.settings import settings
    keys = []
    for k in (settings.GROQ_API_KEY, settings.GROQ_API_KEY_2):
        k = (k or "").strip()
        if k:
            keys.append(k)
    return keys


# ── Synchronous Groq caller with key rotation ──────────────────────────────────

def _call_groq_json(
    prompt: str,
    groq_api_key: str,
    max_tokens: int = 2000,
    label: str = "rec_synthesizer",
) -> Optional[Dict]:
    """
    Call the active primary LLM (LLM_PROVIDER) and return a parsed JSON dict,
    or None on failure.

    NOTE: kept the name `_call_groq_json` and the `groq_api_key` positional
    parameter for backward compatibility with call sites in this file — the
    provider and its credentials now come from app.services.llm_client
    (settings.LLM_PROVIDER), except for one Groq-specific behavior that's
    preserved because it doesn't map to enterprise providers: rotating
    across GROQ_API_KEY / GROQ_API_KEY_2 on 429, which exists purely to
    work around Groq's free-tier per-key TPM limit. Under Azure/Gemini this
    function just does one call via the shared client and lets the SDK's
    own retry/backoff handle transient errors.
    """
    from app.config.settings import settings
    from app.services.llm_client import get_primary_model

    # response_format=json_object is only reliably supported by Groq (same
    # caveat llm_judge.py documents for the judge panel) — for other
    # providers we rely on the prompt's own "return ONLY JSON" instruction.
    response_format = {"type": "json_object"} if settings.LLM_PROVIDER == "groq" else None

    if settings.OFFLINE_MODE or settings.LLM_PROVIDER != "groq":
        from app.services.llm_client import chat_complete
        try:
            raw = chat_complete(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=0.3,
                response_format=response_format,
            )
            raw = (raw or "").strip()
            if raw.startswith("```"):
                lines = raw.split("\n")
                raw = "\n".join(l for l in lines if not l.strip().startswith("```")).strip()
            return json.loads(raw)
        except Exception as e:
            logger.error("[%s] error: %s", label, e)
            return None

    # ── Groq path — preserves free-tier key rotation on 429 ─────────────────
    import openai as _openai

    all_keys = _get_groq_keys()
    rotation = [groq_api_key] + [k for k in all_keys if k != groq_api_key]
    cur = 0
    max_attempts = len(rotation) * 3

    for attempt in range(max_attempts):
        api_key = rotation[cur % len(rotation)]
        client = _openai.OpenAI(api_key=api_key, base_url=settings.GROQ_BASE_URL, max_retries=0, timeout=120.0)
        try:
            kwargs = dict(
                model=get_primary_model(),
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=0.3,
            )
            if response_format is not None:
                kwargs["response_format"] = response_format
            completion = client.chat.completions.create(**kwargs)
            raw = (completion.choices[0].message.content or "").strip()
            if raw.startswith("```"):
                lines = raw.split("\n")
                raw = "\n".join(l for l in lines if not l.strip().startswith("```")).strip()
            return json.loads(raw)

        except _openai.RateLimitError as e:
            wait = 25.0
            try:
                msg = str(e)
                m = re.search(r"try again in ([\d.]+)s", msg)
                if m:
                    wait = float(m.group(1)) + 2.0
            except Exception:
                pass
            next_cur = (cur + 1) % len(rotation)
            if next_cur != cur:
                logger.warning("[%s] 429 key %d → rotating to key %d", label, cur + 1, next_cur + 1)
                cur = next_cur
            else:
                logger.warning("[%s] 429 — single key, sleeping %.1fs", label, wait)
                time.sleep(wait)
            continue

        except json.JSONDecodeError as e:
            logger.warning("[%s] JSON parse error (attempt %d): %s", label, attempt + 1, e)
            return None
        except Exception as e:
            logger.error("[%s] error (attempt %d): %s", label, attempt + 1, e)
            return None

    logger.error("[%s] all keys exhausted after %d attempts", label, max_attempts)
    return None


# ── Prompt builder ─────────────────────────────────────────────────────────────

def _build_rec_prompt(
    ai_name: str,
    model_label: str,
    domain: str,
    end_users: str,
    deployment_status: str,
    highest_stakes: str,
    system_prompt_excerpt: str,
    autonomous_actions: str,
    principle_subset: Dict[str, Dict],
    model_metrics: Dict[str, Any],
    model_context_per_principle: Dict[str, str],
    include_narrative: bool = False,
) -> str:
    """
    Build a recommendation prompt for a SUBSET of principles.
    Keeping the subset small (4-6 principles) keeps output under 2000 tokens.
    """
    lines = []
    for name, data in principle_subset.items():
        score = data.get("score", 0)
        params = data.get("parameters", {})
        # Only include sub-params with actual values
        real_params = {k: v for k, v in params.items() if isinstance(v, (int, float)) and v > 0}
        worst = min(real_params, key=real_params.get) if real_params else "unknown"
        worst_val = real_params.get(worst, 0)
        phase = _phase_for(name, int(score))
        ctx = model_context_per_principle.get(name, "")
        line = f"- {name}: score={int(score)}/100, phase={phase}(0=Immediate,1=Short-term,2=Ongoing), worst_sub_param={worst}({int(worst_val)}/100)"
        if ctx:
            line += f", model_context={ctx}"
        lines.append(line)

    high_risk_metrics = [
        f"- {name}: {v.get('value','?')}, risk=High, note={str(v.get('description',''))[:50]}"
        for name, v in (model_metrics or {}).items()
        if v and v.get("risk_level") == "High" and v.get("value") is not None
    ][:4]  # cap at 4 to save tokens

    narrative_instruction = ""
    if include_narrative:
        narrative_instruction = (
            '\n  "overall_narrative": "3-4 sentences specific to this system, naming domain '
            'and biggest governance gaps — not generic advice.",\n'
            '  "deployment_verdict_context": "One sentence: why is/is not this system deployment-ready.",\n'
        )

    principles_block = "\n".join(lines) or "No principles."
    metrics_block = "\n".join(high_risk_metrics) if high_risk_metrics else "None."

    return f"""You are a senior AI governance auditor generating a targeted remediation plan.

## System being audited
Name: {ai_name}
Type: {model_label}
Domain: {domain or "Not specified"}
End users: {end_users or "Not specified"}
Deployment: {deployment_status or "Unknown"}
Worst-case failure: {highest_stakes or "Not specified"}
System prompt (excerpt): {system_prompt_excerpt or "Not provided"}
Autonomous actions: {autonomous_actions or "None"}

## Principles to address
{principles_block}

## High-risk model metrics
{metrics_block}

## Instructions
Generate a JSON object with SPECIFIC, ACTIONABLE recommendations for the principles listed above.
Be specific to THIS system — not boilerplate. Tailor to the domain, end users, and worst-case failure.

For each principle:
- "what": one sentence — what is the SPECIFIC gap for this system (not generic)
- "owner": the specific team/role responsible (e.g. "Medical AI Safety Team" not "ML team")
- "root_cause": one sentence on likely underlying cause
- "actions": exactly 3 actions, each with:
    "text": specific concrete step (not "improve X", but "implement Y using Z by doing W")
    "effort": Low | Medium | High
    "impact": Quick win | Structural | Ongoing
    "day_target": integer — day to COMPLETE this (phase 0=1-30, phase 1=31-60, phase 2=61-90)
    "owner_team": specific team who executes this
- "rec": one sentence for the findings table (if score < 60)

Output ONLY a valid JSON object. No markdown fences. No preamble. Start with {{:

{{{narrative_instruction}  "principles": {{
    "PrincipleName": {{
      "what": "...",
      "owner": "...",
      "root_cause": "...",
      "actions": [
        {{"text": "...", "effort": "Low", "impact": "Quick win", "day_target": 7, "owner_team": "..."}}
      ],
      "rec": "..."
    }}
  }},
  "finding_recommendations": {{
    "PrincipleName": "..."
  }}
}}

Generate now for: {", ".join(principle_subset.keys())}"""


# ── Main entry: synthesize_recommendations ────────────────────────────────────

def synthesize_recommendations(
    ai_name: str,
    model_type: str,
    model_label: str,
    domain: str,
    registration_profile: Optional[Dict],
    principles: Dict[str, Dict],
    model_metrics: Dict[str, Any],
    model_context_per_principle: Dict[str, str],
    principle_deltas: Optional[List[Dict]] = None,
) -> Dict[str, Any]:
    """
    Generate governance recommendations in two batched Groq calls.

    Splits principles into:
      Batch A — high-priority (score < 75, or HIGH_IMPACT with score < 85) — max 6
      Batch B — lower-priority (score >= 75, not HIGH_IMPACT) — max 6

    Returns unified dict with overall_narrative, deployment_verdict_context,
    rec_principles (per-principle data), finding_recommendations, recommended_actions.
    """
    from app.services.llm_client import is_llm_configured
    if not is_llm_configured():
        logger.warning("[rec_synthesizer] Primary LLM provider not configured — using fallbacks")
        return _fallback_result(principles)

    keys = _get_groq_keys()
    groq_key = keys[0] if keys else ""  # only meaningful on the Groq path inside _call_groq_json

    rp = registration_profile or {}
    end_users         = rp.get("end_users", "")
    deployment_status = rp.get("deployment_status", "")
    highest_stakes    = rp.get("highest_stakes_failure", "")
    system_prompt     = (rp.get("system_prompt") or "")[:250]
    autonomous        = rp.get("autonomous_actions", "") or rp.get("real_time_data", "")

    regressed = {
        d["principle"]
        for d in (principle_deltas or [])
        if d.get("movement_label") in ("REGRESSED", "WORSENING")
    }

    # Filter to only principles with real scores
    real_principles = {
        name: data for name, data in principles.items()
        if data.get("score") is not None and int(data.get("score", 0)) >= 0
    }

    if not real_principles:
        return _fallback_result(principles)

    # Split into priority batches
    batch_a, batch_b = {}, {}
    for name, data in real_principles.items():
        score = int(data.get("score", 0))
        hi = name in _HIGH_IMPACT
        is_priority = score < 75 or (hi and score < 85) or name in regressed
        if is_priority:
            batch_a[name] = data
        else:
            batch_b[name] = data

    # Always put at least something in batch_a
    if not batch_a:
        # All scores are strong — still generate recommendations for 3 worst
        sorted_p = sorted(real_principles.items(), key=lambda x: x[1].get("score", 100))
        batch_a = dict(sorted_p[:3])
        batch_b = dict(sorted_p[3:])

    logger.info(
        "[rec_synthesizer] Batch A: %d principles %s | Batch B: %d principles %s",
        len(batch_a), list(batch_a.keys()),
        len(batch_b), list(batch_b.keys()),
    )

    shared_kwargs = dict(
        ai_name=ai_name, model_label=model_label, domain=domain,
        end_users=end_users, deployment_status=deployment_status,
        highest_stakes=highest_stakes, system_prompt_excerpt=system_prompt,
        autonomous_actions=autonomous, model_metrics=model_metrics,
        model_context_per_principle=model_context_per_principle,
    )

    # ── Batch A: priority principles + narrative ──────────────────────────────
    prompt_a = _build_rec_prompt(
        principle_subset=batch_a,
        include_narrative=True,
        **shared_kwargs,
    )
    result_a = _call_groq_json(prompt_a, groq_key, max_tokens=2500, label="rec_A")
    if not result_a:
        logger.warning("[rec_synthesizer] Batch A failed — using fallbacks for priority principles")
        result_a = {}

    # ── Batch B: lower-priority principles (skip if tiny) ────────────────────
    result_b = {}
    if batch_b:
        # Small sleep to avoid hammering Groq between calls
        time.sleep(8)
        prompt_b = _build_rec_prompt(
            principle_subset=batch_b,
            include_narrative=False,
            **shared_kwargs,
        )
        result_b = _call_groq_json(prompt_b, groq_key, max_tokens=2000, label="rec_B")
        if not result_b:
            logger.warning("[rec_synthesizer] Batch B failed — using fallbacks for lower-priority principles")
            result_b = {}

    # ── Merge results ─────────────────────────────────────────────────────────
    overall_narrative          = result_a.get("overall_narrative", "")
    deployment_verdict_context = result_a.get("deployment_verdict_context", "")

    rec_principles: Dict = {}
    rec_principles.update(result_a.get("principles", {}))
    rec_principles.update(result_b.get("principles", {}))

    finding_recommendations: Dict = {}
    finding_recommendations.update(result_a.get("finding_recommendations", {}))
    finding_recommendations.update(result_b.get("finding_recommendations", {}))
    # Also pull "rec" field from within each principle if finding_recommendations is sparse
    for pname, pdata in rec_principles.items():
        if pname not in finding_recommendations and pdata.get("rec"):
            finding_recommendations[pname] = pdata["rec"]

    # ── Build flat action list for DB + report ────────────────────────────────
    flat_actions: List[Dict] = []
    sort_order = 0

    for principle_name, pdata in rec_principles.items():
        score = int(real_principles.get(principle_name, {}).get("score", 50))
        is_regressed = principle_name in regressed
        phase = _phase_for(principle_name, score, is_regressed)

        for action in pdata.get("actions", []):
            try:
                raw_day = int(action.get("day_target", 30))
            except (TypeError, ValueError):
                raw_day = 30
            clamped = _clamp_day(raw_day, phase)
            flat_actions.append({
                "principle":   principle_name,
                "action_text": action.get("text", ""),
                "effort":      action.get("effort", "Medium"),
                "impact":      action.get("impact", "Structural"),
                "day_target":  clamped,
                "phase":       phase,
                "owner_team":  action.get("owner_team", pdata.get("owner", "")),
                "sort_order":  sort_order,
            })
            sort_order += 1

    any_generated = bool(rec_principles)
    logger.info(
        "[rec_synthesizer] Done — %d principles, %d actions, narrative=%s",
        len(rec_principles), len(flat_actions), bool(overall_narrative),
    )

    return {
        "overall_narrative":           overall_narrative,
        "deployment_verdict_context":  deployment_verdict_context,
        "rec_principles":              rec_principles,    # per-principle details for frontend/report
        "finding_recommendations":     finding_recommendations,
        "recommended_actions":         flat_actions,
        "recs_generated":              any_generated,
    }


# ── Build risk narrative ───────────────────────────────────────────────────────

def synthesize_build_risk_narrative(
    ai_name: str,
    domain: str,
    model_type: str,
    registration_profile: Optional[Dict],
    build_risk: Dict,
) -> Dict[str, Any]:
    """
    Call 2: one-sentence narratives per build-risk check, plus an overall paragraph.
    Only called when ai_generated = yes/partially.
    """
    from app.services.llm_client import is_llm_configured
    if not is_llm_configured() or not build_risk.get("applicable"):
        return {"overall_narrative": "", "checks": {}, "generated": False}

    rp = registration_profile or {}
    ai_codegen_tools = rp.get("ai_codegen_tools", "")
    checks = build_risk.get("checks", [])
    evaluated = [c for c in checks if c.get("status") == "evaluated"]

    if not evaluated:
        return {"overall_narrative": "", "checks": {}, "generated": False}

    checks_block = "\n".join(
        f"- {c['id']}: score={c.get('score','?')}/100 ({c.get('band','?')}), "
        f"probes={c.get('probes_run',0)}, group={c.get('group','?')}"
        for c in evaluated
    )

    prompt = f"""You are a security auditor summarising build-risk probe results.

System: {ai_name} ({model_type}, {domain or 'unspecified domain'})
Built with: {ai_codegen_tools or 'AI code generation tools'}

Probe results:
{checks_block}

Write a JSON object with:
- "overall_narrative": 2-3 sentences on the overall build-risk posture. Specific to this system.
- "checks": for each check_id above, one sentence saying what the score MEANS for this system.
  Pass = say what the result confirms. Fail/Weak = say the specific risk it introduces.

Output ONLY valid JSON. No markdown. Start with {{:
{{"overall_narrative": "...", "checks": {{"check_id": "sentence", ...}}}}"""

    _groq_keys = _get_groq_keys()
    result = _call_groq_json(prompt, _groq_keys[0] if _groq_keys else "", max_tokens=1200, label="build_risk_narr")
    if not result:
        return {"overall_narrative": "", "checks": {}, "generated": False}

    return {
        "overall_narrative": result.get("overall_narrative", ""),
        "checks":            result.get("checks", {}),
        "generated":         True,
    }


# ── Fallback ───────────────────────────────────────────────────────────────────

def _fallback_result(principles: Dict[str, Dict]) -> Dict[str, Any]:
    """Used when Groq is unavailable. Frontend shows re-run banner."""
    return {
        "overall_narrative":          "",
        "deployment_verdict_context": "",
        "rec_principles":             {},
        "finding_recommendations":    {
            name: f"Review and strengthen {name.lower()} controls — score is {data.get('score', '?')}/100."
            for name, data in principles.items()
            if isinstance(data.get("score"), (int, float)) and data["score"] < 60
        },
        "recommended_actions":        [],
        "recs_generated":             False,
    }