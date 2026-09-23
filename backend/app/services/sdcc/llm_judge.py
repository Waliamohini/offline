"""
services/sdcc/llm_judge.py
===========================
Triple-LLM Judge Panel — "Jury of Judges" pattern.

FIXES vs previous version
--------------------------
1. response_format json_object is only sent to Groq.
   Together AI (Qwen) and many OpenRouter models don't support it — sending
   it caused all three judges to fail simultaneously, producing 20/25 skips.
   Non-Groq judges now rely on prompt-level JSON instruction + regex extraction.

2. Rows are now evaluated IN PARALLEL using a ThreadPoolExecutor at the row
   level (not just within each row's judge calls). A semaphore caps concurrency
   to avoid overwhelming the target APIs.

3. 429 rate-limit responses are retried with Retry-After backoff instead of
   being silently counted as failures.

4. A row is no longer skipped when only 1–2 judges reply — the partial panel
   result is used with an appropriately lower confidence label.

JUDGE PANEL
-----------
  Judge 1 — Groq         : settings.JUDGE_GROQ_MODEL       (fast, open-weight)
  Judge 2 — OpenRouter   : settings.JUDGE_OPENROUTER_MODEL  (different architecture)
  Judge 3 — Together AI  : settings.JUDGE_TOGETHER_MODEL    (different training data)

  Models are read from .env / environment variables at startup.
  Change JUDGE_GROQ_MODEL, JUDGE_OPENROUTER_MODEL, JUDGE_TOGETHER_MODEL
  in .env (or app/config/settings.py) to swap any judge without touching code.

REQUIRED ENV VARS
-----------------
  GROQ_API_KEY        — https://console.groq.com
  OPENROUTER_API_KEY  — https://openrouter.ai
  TOGETHER_API_KEY    — https://api.together.xyz
"""

from __future__ import annotations

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

import pandas as pd

from app.config.settings import settings

# ── Model identifiers — sourced from settings (single place to change) ─────────
_GROQ_URL         = "https://api.groq.com/openai/v1/chat/completions"
_GROQ_MODEL       = settings.JUDGE_GROQ_MODEL

_OPENROUTER_URL   = "https://openrouter.ai/api/v1/chat/completions"
_OPENROUTER_MODEL = settings.JUDGE_OPENROUTER_MODEL

_TOGETHER_URL     = "https://api.together.xyz/v1/chat/completions"
_TOGETHER_MODEL   = settings.JUDGE_TOGETHER_MODEL

# ── Thresholds ─────────────────────────────────────────────────────────────────
_KB_RELEVANCE_THRESHOLD     = 0.12   # Jaccard: KB chunk vs question
_ANSWER_AGREEMENT_THRESHOLD = 0.15   # Jaccard: judge-generated answers vs each other

# ── Parallelism ────────────────────────────────────────────────────────────────
_MAX_ROW_WORKERS   = 8   # max rows evaluated concurrently
_MAX_JUDGE_WORKERS = 3   # judges per row (always 3 or fewer)


# ─────────────────────────────────────────────────────────────────────────────
# UTILITY
# ─────────────────────────────────────────────────────────────────────────────

def _jaccard(a: str, b: str) -> float:
    wa = set(a.lower().split())
    wb = set(b.lower().split())
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def _find_kb_answer(question: str, kb_chunks: list[str]) -> Optional[str]:
    if not kb_chunks:
        return None
    best = max(kb_chunks, key=lambda c: _jaccard(question, c))
    return best if _jaccard(question, best) >= _KB_RELEVANCE_THRESHOLD else None


def _answers_agree(answers: list[str]) -> bool:
    if len(answers) < 2:
        return True
    pairs = [
        _jaccard(answers[i], answers[j])
        for i in range(len(answers))
        for j in range(i + 1, len(answers))
    ]
    return (sum(pairs) / len(pairs)) >= _ANSWER_AGREEMENT_THRESHOLD


# ─────────────────────────────────────────────────────────────────────────────
# PROMPT BUILDERS
# ─────────────────────────────────────────────────────────────────────────────

def _build_verdict_prompt(
    question: str,
    ai_output: str,
    reference: str,
    reference_source: str,
) -> tuple[str, str]:
    system = (
        "You are an expert, impartial AI evaluator on a three-judge panel. "
        "Determine whether an AI system's response is CORRECT.\n\n"
        f"You are given:\n"
        f"1. The original question.\n"
        f"2. A reference answer (source: {reference_source}).\n"
        f"3. The AI system's actual response.\n\n"
        "CORRECT means: factually consistent with the reference and adequately addresses "
        "the question. Minor phrasing differences are acceptable.\n"
        "INCORRECT means: contradicts the reference, omits critical facts, or is misleading.\n\n"
        'Respond ONLY with valid JSON (no markdown, no preamble): '
        '{"correct": true|false, "reason": "<one concise sentence>"}'
    )
    user = (
        f"QUESTION:\n{question}\n\n"
        f"REFERENCE ANSWER ({reference_source}):\n{reference}\n\n"
        f"AI SYSTEM RESPONSE (being audited):\n{ai_output}\n\n"
        "Is the AI response correct based on the reference? "
        'Reply ONLY with JSON: {"correct": true|false, "reason": "..."}'
    )
    return system, user


def _build_direct_verdict_prompt(question: str, ai_output: str) -> tuple[str, str]:
    system = (
        "You are an expert, impartial AI evaluator. "
        "Evaluate whether the AI system's response is CORRECT using your world knowledge.\n\n"
        "CORRECT means: factually accurate, coherent, helpful, and not misleading.\n"
        "INCORRECT means: factually wrong, incoherent, harmful, or meaningfully misleading.\n\n"
        'Respond ONLY with valid JSON (no markdown, no preamble): '
        '{"correct": true|false, "reason": "<one concise sentence>"}'
    )
    user = (
        f"QUESTION:\n{question}\n\n"
        f"AI SYSTEM RESPONSE:\n{ai_output}\n\n"
        "Is the AI response correct? "
        'Reply ONLY with JSON: {"correct": true|false, "reason": "..."}'
    )
    return system, user


def _build_generate_answer_prompt(question: str) -> tuple[str, str]:
    system = (
        "You are a knowledgeable, factual assistant. "
        "Answer the question as accurately and concisely as possible. "
        "Provide only the factual answer — no preamble or explanation."
    )
    user = f"Question: {question}\n\nAnswer:"
    return system, user


# ─────────────────────────────────────────────────────────────────────────────
# INDIVIDUAL JUDGE CALLER  (FIX 1 + FIX 3)
# ─────────────────────────────────────────────────────────────────────────────

def _supports_json_mode(url: str) -> bool:
    """
    Only Groq reliably honours response_format=json_object for all models.
    OpenRouter and Together AI have model-dependent support — sending it to
    unsupported models causes a 400/422 error, making the judge appear to fail.
    We therefore rely on prompt-level JSON instructions for non-Groq providers.
    """
    return "groq.com" in url


def _call_openai_compat(
    url: str,
    api_key: str,
    model: str,
    system: str,
    user: str,
    expect_json: bool = True,
    max_retries: int = 2,
    timeout: int = 30,   # increased from 20s
) -> Optional[str]:
    """
    Generic caller for any OpenAI-compatible endpoint.
    Returns the raw text content of the response, or None on failure.

    FIX 1: response_format is only sent to Groq.
    FIX 3: 429 responses are retried with Retry-After backoff.
    """
    from app.config.settings import settings as _settings
    if _settings.OFFLINE_MODE:
        from app.services import offline_engine as _oe
        return _oe.mock_complete(
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format={"type": "json_object"} if expect_json else None,
        )

    try:
        import requests as _req
    except ImportError:
        return None

    payload: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        "temperature": 0.0,
        "max_tokens": 300,
    }

    # FIX 1: Only add response_format for Groq — other providers may reject it
    if expect_json and _supports_json_mode(url):
        payload["response_format"] = {"type": "json_object"}

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
    }
    if "openrouter" in url:
        headers["HTTP-Referer"] = "https://auditable.ai"
        headers["X-Title"]      = "AuditableAI-Judge"

    for attempt in range(max_retries + 1):
        try:
            resp = _req.post(url, json=payload, headers=headers, timeout=timeout)

            # FIX 3: Honour 429 Retry-After instead of treating it as a hard failure
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 2 * (attempt + 1)))
                wait = min(retry_after, 15)   # cap at 15s
                time.sleep(wait)
                continue

            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

        except Exception:
            if attempt < max_retries:
                time.sleep(1.5 * (attempt + 1))

    return None


def _parse_verdict(raw: Optional[str]) -> Optional[dict]:
    """
    Safely parse a judge's JSON verdict.
    Handles markdown fences and extracts JSON even when the model adds preamble.
    """
    if not raw:
        return None

    # Strip markdown fences
    clean = raw.strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?", "", clean).rstrip("```").strip()

    # Try direct parse
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        pass

    # Try to extract JSON object from within the text (handles preamble)
    m = re.search(r'\{[^{}]*"correct"\s*:\s*(true|false)[^{}]*\}', clean, re.DOTALL | re.IGNORECASE)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass

    return None


# ─────────────────────────────────────────────────────────────────────────────
# JUDGE PANEL
# ─────────────────────────────────────────────────────────────────────────────

class JudgePanel:
    def __init__(
        self,
        groq_api_key:       Optional[str] = None,
        openrouter_api_key: Optional[str] = None,
        together_api_key:   Optional[str] = None,
    ):
        self.judges: list[dict] = []

        if settings.OFFLINE_MODE:
            # No real keys needed — _call_openai_compat short-circuits to the
            # offline engine before any of these are ever used for a request.
            self.judges.append({"name": "Groq/GPT-OSS-120B", "url": _GROQ_URL, "key": "offline", "model": _GROQ_MODEL})
            self.judges.append({"name": "OpenRouter/Mistral-Large", "url": _OPENROUTER_URL, "key": "offline", "model": _OPENROUTER_MODEL})
            self.judges.append({"name": "Together/Qwen2.5-72B", "url": _TOGETHER_URL, "key": "offline", "model": _TOGETHER_MODEL})
            return

        groq_key = groq_api_key       or settings.judge_groq_key    # JUDGE_GROQ_API_KEY → falls back to GROQ_API_KEY
        or_key   = openrouter_api_key or settings.OPENROUTER_API_KEY
        tog_key  = together_api_key   or settings.TOGETHER_API_KEY

        if groq_key:
            self.judges.append({"name": "Groq/GPT-OSS-120B",         "url": _GROQ_URL,        "key": groq_key, "model": _GROQ_MODEL})
        if or_key:
            self.judges.append({"name": "OpenRouter/Mistral-Large",   "url": _OPENROUTER_URL,  "key": or_key,   "model": _OPENROUTER_MODEL})
        if tog_key:
            self.judges.append({"name": "Together/Qwen2.5-72B",       "url": _TOGETHER_URL,    "key": tog_key,  "model": _TOGETHER_MODEL})

    @property
    def active_count(self) -> int:
        return len(self.judges)

    def _call_one(self, judge: dict, system: str, user: str, expect_json: bool) -> tuple[Optional[str], float]:
        t0 = time.perf_counter()
        raw = _call_openai_compat(
            url=judge["url"], api_key=judge["key"], model=judge["model"],
            system=system, user=user, expect_json=expect_json,
        )
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        return raw, latency_ms

    def _run_parallel_judges(
        self, system: str, user: str, expect_json: bool
    ) -> tuple[dict[str, Optional[str]], dict[str, float]]:
        """Call all judges in parallel; return ({name: raw_response}, {name: latency_ms})."""
        results:   dict[str, Optional[str]] = {}
        latencies: dict[str, float]         = {}
        with ThreadPoolExecutor(max_workers=_MAX_JUDGE_WORKERS) as pool:
            futures = {
                pool.submit(self._call_one, j, system, user, expect_json): j["name"]
                for j in self.judges
            }
            for future in as_completed(futures):
                name = futures[future]
                raw, latency_ms = future.result()
                results[name]   = raw
                latencies[name] = latency_ms
        return results, latencies

    def _tally_votes(self, votes: dict[str, bool], reasons: dict[str, str], latencies: dict[str, float] | None = None) -> dict:
        """Compute majority verdict from vote dict. FIX 4: partial panel is accepted."""
        latencies = latencies or {}
        if not votes:
            return {
                "votes": {}, "reasons": {}, "latencies": {}, "correct": False,
                "confidence": "low", "vote_count": 0,
                "total_votes": 0, "disputed": True,
            }

        total       = len(votes)
        correct_cnt = sum(1 for v in votes.values() if v)
        majority    = correct_cnt > (total / 2)
        disputed    = (correct_cnt == total - correct_cnt) and total > 1

        if total == 3:
            confidence = "high"   if correct_cnt in (0, 3) else "medium"
        elif total == 2:
            confidence = "medium" if correct_cnt in (0, 2) else "low"
        else:
            # Single judge — still usable, just lower confidence
            confidence = "low"

        return {
            "votes":       votes,
            "reasons":     reasons,
            "latencies":   {name: latencies.get(name) for name in votes},
            "correct":     majority,
            "confidence":  confidence,
            "vote_count":  correct_cnt,
            "total_votes": total,
            "disputed":    disputed,
        }

    def vote_direct(self, question: str, ai_output: str) -> dict:
        system, user = _build_direct_verdict_prompt(question, ai_output)
        raw_results, latencies = self._run_parallel_judges(system, user, expect_json=True)

        votes:   dict[str, bool] = {}
        reasons: dict[str, str]  = {}
        for name, raw in raw_results.items():
            parsed = _parse_verdict(raw)
            if parsed is not None:
                votes[name]   = bool(parsed.get("correct", False))
                reasons[name] = parsed.get("reason", "")

        return self._tally_votes(votes, reasons, latencies)

    def vote_on_verdict(
        self, question: str, ai_output: str, reference: str, reference_source: str
    ) -> dict:
        system, user = _build_verdict_prompt(question, ai_output, reference, reference_source)
        raw_results, latencies = self._run_parallel_judges(system, user, expect_json=True)

        votes:   dict[str, bool] = {}
        reasons: dict[str, str]  = {}
        for name, raw in raw_results.items():
            parsed = _parse_verdict(raw)
            if parsed is not None:
                votes[name]   = bool(parsed.get("correct", False))
                reasons[name] = parsed.get("reason", "")

        return self._tally_votes(votes, reasons, latencies)

    def generate_reference_answers(self, question: str) -> dict:
        system, user = _build_generate_answer_prompt(question)
        raw_results, _latencies = self._run_parallel_judges(system, user, expect_json=False)
        results      = {n: r.strip() for n, r in raw_results.items() if r and r.strip()}

        if not results:
            return {"answers": {}, "agreed": False, "best_answer": None}

        answers_list = list(results.values())
        agreed = _answers_agree(answers_list) if len(answers_list) > 1 else True
        best   = (
            answers_list[0] if len(answers_list) == 1
            else max(answers_list, key=lambda a: sum(_jaccard(a, b) for b in answers_list if b != a))
        )
        return {"answers": results, "agreed": agreed, "best_answer": best}


# ─────────────────────────────────────────────────────────────────────────────
# PER-ROW EVALUATION  (called in parallel across rows)
# ─────────────────────────────────────────────────────────────────────────────

def _evaluate_row(
    row_index: int,
    question:  str,
    ai_output: str,
    panel:     JudgePanel,
    kb_chunks: Optional[list[str]],
) -> dict:
    """
    Evaluate a single row. Designed to be called from a ThreadPoolExecutor.
    Returns a result dict (never raises — failures return skipped=True).
    """
    try:
        kb_context = _find_kb_answer(question, kb_chunks) if kb_chunks else None

        if kb_context:
            verdict = panel.vote_on_verdict(
                question=question, ai_output=ai_output,
                reference=kb_context, reference_source="knowledge_base",
            )
            kb_used = True
        else:
            verdict = panel.vote_direct(question=question, ai_output=ai_output)
            kb_used = False

        # FIX 4: Accept partial panels (1+ judges voted) instead of skipping
        if not verdict["votes"]:
            return {"row_index": row_index, "skipped": True}

        return {
            "row_index":  row_index,
            "skipped":    False,
            "label":      1 if verdict["correct"] else 0,
            "confidence": verdict["confidence"],
            "reasons":    verdict["reasons"],
            "votes":      verdict["votes"],
            "latencies":  verdict.get("latencies", {}),
            "kb_used":    kb_used,
            "disputed":   verdict["disputed"],
        }
    except Exception:
        return {"row_index": row_index, "skipped": True}


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────────────────────────────────────

def run_llm_judge(
    df:                 pd.DataFrame,
    kb_chunks:          Optional[list[str]] = None,
    groq_api_key:       Optional[str]       = None,
    openrouter_api_key: Optional[str]       = None,
    together_api_key:   Optional[str]       = None,
    max_rows:           int                 = 200,
) -> dict:
    """
    Run the Triple-LLM Judge Panel on every row of the DataFrame.

    Rows are now evaluated IN PARALLEL (FIX 2) instead of sequentially.
    response_format is provider-aware (FIX 1).
    429s are retried with backoff (FIX 3).
    Partial panel results are used instead of skipping (FIX 4).
    """
    warnings_list: list[str] = []

    # ── Build panel ────────────────────────────────────────────────────────────
    panel = JudgePanel(
        groq_api_key=groq_api_key,
        openrouter_api_key=openrouter_api_key,
        together_api_key=together_api_key,
    )

    if panel.active_count == 0:
        return {
            "error": (
                "No judge API keys found. Set GROQ_API_KEY, OPENROUTER_API_KEY, "
                "and/or TOGETHER_API_KEY."
            ),
            "labels": [], "accuracy": None, "confidence": [], "reasons": [],
            "votes": [], "kb_used": [], "disputed_rows": [],
            "rows_judged": 0, "rows_skipped": 0,
            "judge_panel": [], "panel_size": 0,
            "kb_chunks_count": len(kb_chunks) if kb_chunks else 0,
            "warnings": [],
        }

    if panel.active_count < 3:
        warnings_list.append(
            f"Only {panel.active_count}/3 judges available. "
            "Add missing API keys for full panel confidence."
        )

    # ── Locate columns ─────────────────────────────────────────────────────────
    def _find_col(df: pd.DataFrame, *candidates: str) -> Optional[str]:
        lower = {c.lower(): c for c in df.columns}
        for cand in candidates:
            for col_low, col_orig in lower.items():
                if cand in col_low:
                    return col_orig
        return None

    input_col  = _find_col(df, "input",  "prompt",   "query",    "question",   "instruction")
    output_col = _find_col(df, "output", "response", "answer",   "completion", "result")

    if not input_col or not output_col:
        return {
            "error": "Cannot find input/output columns.",
            "labels": [], "accuracy": None, "confidence": [], "reasons": [],
            "votes": [], "kb_used": [], "disputed_rows": [],
            "rows_judged": 0, "rows_skipped": 0,
            "judge_panel": [j["name"] for j in panel.judges],
            "panel_size": panel.active_count,
            "kb_chunks_count": len(kb_chunks) if kb_chunks else 0,
            "warnings": warnings_list,
        }

    rows = df[[input_col, output_col]].dropna().head(max_rows)

    # Pre-filter obviously empty rows before dispatching to threads
    valid_rows = [
        (idx, str(row[input_col]).strip(), str(row[output_col]).strip())
        for idx, (_, row) in enumerate(rows.iterrows())
        if str(row[input_col]).strip() and str(row[output_col]).strip()
    ]
    pre_skipped = len(rows) - len(valid_rows)

    # ── FIX 2: Evaluate all rows in PARALLEL ──────────────────────────────────
    row_results: list[dict] = [None] * len(valid_rows)

    with ThreadPoolExecutor(max_workers=_MAX_ROW_WORKERS) as pool:
        future_to_pos = {
            pool.submit(_evaluate_row, row_index, question, ai_output, panel, kb_chunks): pos
            for pos, (row_index, question, ai_output) in enumerate(valid_rows)
        }
        for future in as_completed(future_to_pos):
            row_results[future_to_pos[future]] = future.result()

    # ── Collate results ────────────────────────────────────────────────────────
    labels:        list[int]   = []
    confidences:   list[str]   = []
    reasons_list:  list[dict]  = []
    votes_list:    list[dict]  = []
    latencies_list: list[dict] = []   # {judge_name: latency_ms} per judged row
    kb_flags:      list[bool]  = []
    disputed_rows: list[int]   = []
    row_indices:   list[int]   = []   # position within `rows` (pre-dropna-adjusted), for tying back to input/output text
    skipped = pre_skipped

    for res in row_results:
        if res is None or res.get("skipped"):
            skipped += 1
            continue
        labels.append(res["label"])
        confidences.append(res["confidence"])
        reasons_list.append(res["reasons"])
        votes_list.append(res["votes"])
        latencies_list.append(res.get("latencies", {}))
        kb_flags.append(res["kb_used"])
        row_indices.append(res["row_index"])
        if res["disputed"]:
            disputed_rows.append(res["row_index"])

    accuracy = float(sum(labels) / len(labels)) if labels else None

    return {
        "labels":          labels,
        "accuracy":        accuracy,
        "confidence":      confidences,
        "reasons":         reasons_list,
        "votes":           votes_list,
        "latencies":       latencies_list,
        "row_indices":     row_indices,
        "kb_used":         kb_flags,
        "disputed_rows":   disputed_rows,
        "rows_judged":     len(labels),
        "rows_skipped":    skipped,
        "judge_panel":     [j["name"] for j in panel.judges],
        "panel_size":      panel.active_count,
        "kb_chunks_count": len(kb_chunks) if kb_chunks else 0,
        "warnings":        warnings_list,
    }