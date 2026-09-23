"""
services/sdcc/base_evaluator.py
================================
Shared infrastructure for all model-specific evaluators.

Architecture change
--------------------
Each model evaluator now implements its OWN taf_principles() method
with model-specific sub-parameters for every principle.  There is no
single shared _principle_engine() — that was the root cause of the
generic, non-specific sub-parameters.

What this file provides
------------------------
  - _structural()          schema/column structural signals
  - _sp()                  extract sub-parameter calculator values
  - _mv()                  extract model metric as 0-100
  - Shared analysis        compute_risk_analysis, generate_findings
  - Column-reading helpers _col, _mean, _bool_rate, _coverage
  - _metric_result         standardised metric dict builder
  - _rec_for_principle     recommendation lookup (per subclass)
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any, Optional
import pandas as pd

from app.services.sdcc.sub_parameter_calculator import compute_all_sub_parameters

PRINCIPLE_ORDER = [
    "Fairness", "Transparency", "Explainability", "Accountability",
    "Data Integrity", "Reliability", "Security", "Safety", "Privacy", "Sustainability",
]

PRINCIPLE_DESCRIPTIONS = {
    "Fairness": (
        "AI solutions should be designed to reduce or eliminate bias against individuals, "
        "communities, and groups. Ongoing bias monitoring and equal error rates across groups "
        "must be maintained across the full model lifecycle."
    ),
    "Transparency": (
        "AI solutions should include responsible disclosure to provide stakeholders with a "
        "clear understanding of what is happening in each solution across the AI lifecycle."
    ),
    "Explainability": (
        "AI solutions should be developed and delivered in a way that answers the questions "
        "of how and why a conclusion was drawn from the solution."
    ),
    "Accountability": (
        "Human oversight and responsibility should be embedded across the AI lifecycle to manage "
        "risk and comply with applicable laws and regulations."
    ),
    "Data Integrity": (
        "Data used in AI solutions should be assessed for accuracy, completeness, "
        "appropriateness, and quality to drive trusted decisions."
    ),
    "Reliability": (
        "AI solutions should consistently operate in accordance with their intended purpose and "
        "scope and at the desired level of precision."
    ),
    "Security": (
        "Robust and resilient practices should be implemented to safeguard AI solutions against "
        "bad actors, misinformation, or adverse events."
    ),
    "Safety": (
        "AI solutions should be designed and implemented to safeguard against harm to people, "
        "businesses, and property."
    ),
    "Privacy": (
        "AI solutions should be designed to comply with applicable privacy and data protection "
        "laws and regulations."
    ),
    "Sustainability": (
        "AI solutions should be designed to be energy efficient, reduce carbon emissions, and "
        "support a cleaner environment."
    ),
}


# Patterns used to extract embedded context/documents from input prompts.
# Covers summarization-style prompts ("Summarize the following: ...") and
# RAG-style prompts ("Use the following context: ...").
_CONTEXT_TRIGGER_PATTERNS = [
    r"(?:summarize|summarise|summary of|tl;?dr)[:\s]+",
    r"(?:summarize|summarise)\s+(?:the\s+)?(?:following|below|this)[:\s]+",
    r"(?:article|document|text|passage|report|paper|content)[:\s]+",
    r"(?:given|based on)\s+the\s+(?:following|below)[:\s]+",
    r"(?:context|background|source|document)[:\s]+",
    r"<(?:context|document|article)>",
    r"(?:use|using)\s+(?:the\s+)?following\s+(?:context|information|documents?)[:\s]+",
]

class BaseEvaluator(ABC):

    MODEL_TYPE:  str = "base"
    LABEL:       str = "Base"
    DESCRIPTION: str = ""
    THRESHOLDS:         dict[str, dict] = {}
    TAF_METRIC_WEIGHTS: dict[str, float] = {}

    # ── Abstract interface ─────────────────────────────────────────────────────

    @abstractmethod
    def model_metrics(
        self, df: pd.DataFrame, computed: Optional[dict] = None,
    ) -> dict[str, Any]:
        """Compute model-specific NLP/ML metrics."""

    @abstractmethod
    def taf_principles(
        self,
        diagnostics: dict,
        logs_count:  int,
        metrics:     dict[str, Any],
        df:          Optional[pd.DataFrame] = None,
    ) -> dict[str, dict]:
        """
        Return the 10 KPMG principles with model-specific sub-parameters.
        Each sub-class computes its own 4 sub-parameters per principle
        based on what matters for THAT model type.
        """

    # ── Shared helpers for sub-parameter extraction ───────────────────────────

    # ── Context-from-input extraction ────────────────────────────────────────────
    # Many real-world prompts embed the source document directly in the input, e.g.:
    #   "Summarize the following: [1200 words of article text]. Be concise."
    # This method extracts the embedded context so faithfulness, coverage, etc.
    # can be computed even when there is no separate context/source column.

    _CONTEXT_TRIGGERS: list = []   # populated in __init_subclass__
    _CTX_PATTERNS = None  # compiled lazily

    @classmethod
    def _extract_context_from_input(cls, input_text: str) -> "Optional[str]":
        """
        Extract embedded context/document from an input prompt.

        Handles two common real-world patterns:
          1. Trigger-phrase pattern:
             "Summarize the following article:\n\n<document>"
             "Use the following context:\n\n<document>\n\nQuestion: ..."
          2. Double-newline split:
             Anything after the first blank line that is substantially longer
             than the preamble is likely the embedded document.

        Returns None if no embedded context detected (short queries, etc).
        """
        if not input_text or len(input_text.split()) < 15:
            return None

        import re as _re

        # Inline patterns (avoids class-variable compilation issues)
        TRIGGERS = [
            r"(?:summarize|summarise|summary of|tl;?dr)[:\s]+",
            r"(?:summarize|summarise)\s+(?:the\s+)?(?:following|below|this)[:\s]+",
            r"(?:article|document|text|passage|report|paper|content)[:\s]+",
            r"(?:given|based on)\s+the\s+(?:following|below)[:\s]+",
            r"(?:context|background|source|document)[:\s]+",
            r"<(?:context|document|article)>",
            r"(?:use|using)\s+(?:the\s+)?following\s+(?:context|information|documents?)[:\s]+",
        ]

        best: "Optional[str]" = None
        best_len = 0

        # Strategy 1: trigger-phrase match — capture everything AFTER the trigger
        for pattern_str in TRIGGERS:
            pat = _re.compile(pattern_str, _re.IGNORECASE | _re.DOTALL)
            m = pat.search(input_text)
            if m:
                after_trigger = input_text[m.end():].strip()
                if after_trigger and len(after_trigger) > best_len:
                    best = after_trigger
                    best_len = len(after_trigger)

        # Strategy 2: double-newline split
        # "Summarize:\n\n<document>\n\nBe concise." → take middle block
        if "\n\n" in input_text:
            parts = input_text.split("\n\n", 1)
            if len(parts) == 2:
                remainder = parts[1]
                # If there's a trailing instruction (short, after another blank line), remove it
                sub = remainder.rsplit("\n\n", 1)
                candidate = sub[0].strip() if len(sub)==2 and len(sub[1].split())<20 else remainder.strip()
                if len(candidate) > best_len:
                    best = candidate
                    best_len = len(candidate)

        if best is None:
            return None

        # Validate: must be substantial text, not just the trigger phrase itself
        ctx_tokens   = len(best.split())
        input_tokens = len(input_text.split())
        if ctx_tokens < 10:
            return None
        if ctx_tokens / max(input_tokens, 1) < 0.25:
            return None  # too small a fraction — probably not the real embedded document

        return best


    def _extract_text(self, df: Optional[pd.DataFrame], extract_context: bool = False):
        """
        Return (inputs, outputs, references, contexts) as string lists.

        When extract_context=True (used by summarization and RAG evaluators),
        the method first looks for a dedicated context/source column. If none
        is found, it attempts to extract embedded context from the input column
        using _extract_context_from_input(). This handles the common real-world
        pattern where the source document is embedded directly in the prompt:
            "Summarize the following article:

<document text>"
        """
        if df is None or df.empty:
            return [], [], None, None

        inp_col = self._col(df, "input","prompt","query","instruction","step_name","task")
        out_col = self._col(df, "output","response","answer","completion","result","summary","prediction")
        ref_col = self._col(df, "reference","reference_summary","ground_truth","target","ref_summary")
        ctx_col = self._col(df, "context","retrieved_chunks","chunks","passages","source_doc","source","document")

        inp = df[inp_col].dropna().astype(str).tolist() if inp_col else []
        out = df[out_col].dropna().astype(str).tolist() if out_col else []
        ref = df[ref_col].dropna().astype(str).tolist() if ref_col else None
        ctx = df[ctx_col].dropna().astype(str).tolist() if ctx_col else None

        # ── Context extraction from input column ──────────────────────────────
        # If no dedicated context column exists but the caller needs one
        # (summarization, RAG), try to extract context from the input prompts.
        if extract_context and ctx is None and inp:
            extracted = [self._extract_context_from_input(t) for t in inp]
            valid = [e for e in extracted if e is not None]
            if len(valid) >= max(1, len(inp) * 0.30):
                # At least 30% of rows yielded extractable context — use it
                # For rows where extraction failed, fall back to the full input
                ctx = [e if e is not None else inp[i] for i, e in enumerate(extracted)]

        return inp, out, ref, ctx

    def _compute_sp(self, df: Optional[pd.DataFrame], extract_context: bool = False) -> dict:
        """
        Run sub_parameter_calculator and return flat dict.
        Pass extract_context=True for summarization and RAG evaluators.
        """
        try:
            inp, out, ref, ctx = self._extract_text(df, extract_context=extract_context)
            if not out:
                return {}
            return compute_all_sub_parameters(inp, out, ref, ctx)
        except Exception:
            return {}   # never let computation failures crash the evaluation pipeline

    def _validate_sample_size(self, logs_count: int) -> dict:
        """
        Return a warning dict when sample size is too small for reliable evaluation.
        Attached to the report as sample_size_warning.
        """
        if logs_count < 10:
            return {"level": "Critical", "message": f"Only {logs_count} records — results are statistically unreliable. Minimum recommended: 100."}
        if logs_count < 50:
            return {"level": "High",     "message": f"{logs_count} records — limited statistical reliability. Recommended: ≥ 100 records."}
        if logs_count < 200:
            return {"level": "Moderate", "message": f"{logs_count} records — moderate confidence. ≥ 500 records recommended for production audits."}
        return {"level": "Low",      "message": f"{logs_count} records — adequate sample size for reliable evaluation."}

    def _sp(self, sp: dict, key: str, fallback: int, invert: bool = False) -> int:
        """Get sub-param as 0-100 int, with fallback."""
        v = sp.get(key)
        if v is None:
            return fallback
        score = (1.0 - v) if invert else v
        return self.clamp(score * 100)

    def _mv(self, metrics: dict, key: str, inverted: bool = False) -> int:
        """Get model metric as 0-100 int, with 40 (neutral) fallback."""
        m = metrics.get(key, {})
        v = m.get("value")
        if v is None:
            return 40
        return self.clamp(((1.0 - v) if inverted else v) * 100)

    def _assemble_principles(
        self,
        principle_params: dict[str, dict],
        metrics: dict,
    ) -> dict[str, dict]:
        """Wrap computed params into standard principle dict structure."""
        raw = {}
        for name, params in principle_params.items():
            raw[name] = {
                "score":       self.param_score(params),
                "parameters":  params,
                "description": PRINCIPLE_DESCRIPTIONS.get(name, ""),
            }
        # Apply model-metric boosts
        boost = self._metric_boost(metrics)
        for pr, b in boost.items():
            if pr in raw:
                raw[pr]["score"] = self.clamp(raw[pr]["score"] + b)
        return raw

    # ── Structural helpers ────────────────────────────────────────────────────

    def _structural(self, diagnostics: dict, logs_count: int) -> dict:
        diagnostics = diagnostics or {}  # guard against None
        missing  = diagnostics.get("missing_ratio", 0.0)
        dupes    = diagnostics.get("duplicates", 0)
        schema_c = diagnostics.get("schema_confidence", 0.8)
        total_c  = diagnostics.get("total_columns", 1)
        text_c   = diagnostics.get("text_columns", 0)
        num_c    = diagnostics.get("numeric_columns", 0)
        cols     = [c.lower() for c in diagnostics.get("column_names", [])]

        def has(*keys: str) -> bool:
            return any(k in c for k in keys for c in cols)

        cl = self.clamp
        return {
            "completeness":  cl((1 - missing) * 100),
            "schema_score":  cl(schema_c * 100),
            "dup_penalty":   cl(max(0, 100 - (dupes / max(logs_count, 1)) * 500)),
            "volume_score":  cl(min(logs_count / 100 * 100, 100)),
            "col_diversity": cl(min(total_c / 10 * 100, 100)),
            "text_ratio":    cl((text_c / max(total_c, 1)) * 100),
            "num_ratio":     cl((num_c  / max(total_c, 1)) * 100),
            "total_cols":    total_c,
            "missing":       missing,
            "has_input":     has("input","prompt","query","question","instruction"),
            "has_output":    has("output","response","answer","completion","result","summary","prediction"),
            "has_label":     has("label","class","target","ground_truth","true_label"),
            "has_timestamp": has("timestamp","date","time","created_at"),
            "has_user_id":   has("user_id","user","session_id","session","conversation_id"),
            "has_score":     has("score","confidence","probability","prob","rouge","bleu","f1","auc","iou","map"),
            "has_feedback":  has("feedback","rating","review","human_eval","human_score"),
            "has_safety":    has("is_safe","safety","flagged","moderated","toxicity","content_safe"),
            "has_pii":       has("contains_pii","pii","personal"),
            "has_version":   has("model_version","version","model_id"),
            "has_latency":   has("latency","response_time","duration","inference_time","elapsed"),
            "has_error":     has("error","exception","failed","failure"),
            "has_override":  has("human_override","escalated","manual_intervention","human_review"),
            "has_context":   has("context","retrieved","chunks","passages"),
            "has_ref":       has("reference","reference_summary","ground_truth"),
            "has_halluc":    has("hallucination","faithfulness","groundedness","factual"),
        }

    def _io_bonus(self, s: dict) -> int:
        if s["has_input"] and s["has_output"]: return 20
        if s["has_input"] or  s["has_output"]: return 10
        return 0

    # ── Column-reading helpers ────────────────────────────────────────────────

    def _col(self, df: pd.DataFrame, *candidates: str) -> Optional[str]:
        lower = {c.lower(): c for c in df.columns}
        for cand in candidates:
            for col_low, col_orig in lower.items():
                if cand in col_low:
                    return col_orig
        return None

    def _mean(self, df: pd.DataFrame, *candidates: str) -> Optional[float]:
        col = self._col(df, *candidates)
        if col is None: return None
        vals = pd.to_numeric(df[col], errors="coerce").dropna()
        return float(vals.mean()) if len(vals) > 0 else None

    def _bool_rate(self, df: pd.DataFrame, *candidates: str) -> Optional[float]:
        col = self._col(df, *candidates)
        if col is None: return None
        mapping = {"true":1,"false":0,"yes":1,"no":0,"success":1,
                   "fail":0,"failed":0,"pass":1,"1":1,"0":0}
        series   = df[col].copy()
        numeric  = pd.to_numeric(series, errors="coerce")
        fallback = series.astype(str).str.lower().map(mapping)
        resolved = numeric.combine_first(fallback)
        vals     = resolved.dropna()
        return float(vals.mean()) if len(vals) > 0 else None

    def _coverage(self, df: pd.DataFrame, *candidates: str) -> Optional[float]:
        col = self._col(df, *candidates)
        if col is None: return None
        return float(df[col].notna().mean())

    def _computed_or_fallback(self, computed, metric_key, fallback_fn):
        if computed and metric_key in computed and computed[metric_key] is not None:
            return computed[metric_key]
        return fallback_fn()

    def _metric_result(self, value, description: str, threshold_key: str, unit: str = "") -> dict:
        risk = self.metric_risk(value, threshold_key) if value is not None else "Unavailable"
        thr  = self.THRESHOLDS.get(threshold_key, {})
        return {
            "value":              round(value, 4) if value is not None else None,
            "risk_level":         risk,
            "description":        description,
            "unit":               unit or thr.get("unit", ""),
            "threshold_low":      thr.get("low"),
            "threshold_moderate": thr.get("moderate"),
            "higher_is_better":   not thr.get("inverted", False),
        }

    def metric_risk(self, value: float, threshold_key: str) -> str:
        thr = self.THRESHOLDS.get(threshold_key)
        if not thr: return "Unknown"
        inverted = thr.get("inverted", False)
        low, moderate = thr["low"], thr["moderate"]
        if not inverted:
            if value >= low:      return "Low"
            if value >= moderate: return "Moderate"
            return "High"
        else:
            if value <= low:      return "Low"
            if value <= moderate: return "Moderate"
            return "High"

    def _metric_boost(self, metrics, weights=None) -> dict:
        w = weights or self.TAF_METRIC_WEIGHTS
        available = {k: v for k, v in metrics.items() if v.get("value") is not None}
        if not available: return {}
        risk_pts = {"Low": 7, "Moderate": 3, "High": 0}
        avg = sum(risk_pts.get(m["risk_level"], 0) for m in available.values()) / len(available)
        return {pr: self.clamp(int(avg * wt)) for pr, wt in w.items()}

    # ── Shared analysis ───────────────────────────────────────────────────────

    def compute_risk_analysis(self, principles, diagnostics, logs_count, model_metrics) -> dict:
        risk_items = []
        for name, data in principles.items():
            score  = data["score"]
            params = data.get("parameters", {})
            worst  = min(params, key=lambda k: params[k]) if params else "N/A"
            if   score < 40: severity, color = "Critical", "#ff4d4d"
            elif score < 60: severity, color = "High",     "#ff7043"
            elif score < 75: severity, color = "Moderate", "#ffb020"
            else:            severity, color = "Low",      "#00C896"
            risk_items.append({
                "principle": name, "score": score, "severity": severity,
                "color": color, "worst_param": worst,
                "worst_val": params.get(worst, score), "gap": 100 - score,
            })
        risk_items.sort(key=lambda x: x["score"])
        counts = {sv: sum(1 for r in risk_items if r["severity"] == sv)
                  for sv in ("Critical","High","Moderate","Low")}
        avg = sum(r["score"] for r in risk_items) / max(len(risk_items), 1)
        if   counts["Critical"] > 0: overall = "Critical"
        elif counts["High"] >= 3:    overall = "High"
        elif avg >= 75:              overall = "Low"
        elif avg >= 55:              overall = "Moderate"
        else:                        overall = "High"
        missing_ratio = diagnostics.get("missing_ratio", 0)
        high_metrics  = [k for k,v in model_metrics.items()
                         if v.get("risk_level")=="High" and v.get("value") is not None]
        return {
            "overall_risk_level": overall, "risk_items": risk_items,
            "critical_count": counts["Critical"], "high_count": counts["High"],
            "moderate_count": counts["Moderate"], "low_count": counts["Low"],
            "average_score":  round(avg, 1),
            "data_volume_risk": (
                "High — insufficient log volume" if logs_count < 30
                else "Moderate — limited dataset" if logs_count < 100
                else "Low — adequate data volume"
            ),
            "missing_data_risk": (
                "High" if missing_ratio > 0.2 else
                "Moderate" if missing_ratio > 0.05 else "Low"
            ),
            "high_model_metric_risks": high_metrics,
        }

    def generate_findings(
        self,
        principles: dict,
        model_metrics: dict,
        finding_recommendations: Optional[dict] = None,
    ) -> list:
        """
        Generate per-principle and per-metric findings.

        finding_recommendations: optional dict from rec_synthesizer (Call 1).
        When present, uses the Groq-generated specific recommendation;
        falls back to the generic _rec_for_principle() when absent.
        """
        fr = finding_recommendations or {}
        findings = []
        for name, data in principles.items():
            if data["score"] < 60:
                findings.append({
                    "category":       name,
                    "type":           "structural",
                    "severity":       "High" if data["score"] < 40 else "Medium",
                    "issue":          f"{name} score is {data['score']}/100 — governance gap detected.",
                    "recommendation": fr.get(name) or self._rec_for_principle(name, data.get("parameters", {})),
                })
        for metric_name, metric_data in model_metrics.items():
            if metric_data.get("risk_level") == "High" and metric_data.get("value") is not None:
                findings.append({
                    "category":   metric_name,
                    "type":       "model_metric",
                    "severity":   "High",
                    "issue":      (
                        f"{metric_data['description']} is at risk "
                        f"(value: {metric_data['value']:.3f}"
                        f"{' ' + metric_data['unit'] if metric_data.get('unit') else ''})."
                    ),
                    "recommendation": fr.get(metric_name) or self._rec_for_metric(metric_name),
                })
        return findings

    @staticmethod
    def clamp(v: float) -> int:
        return max(0, min(100, int(v)))

    def param_score(self, params: dict) -> int:
        return self.clamp(sum(params.values()) / max(len(params), 1))

    # ── Recommendation hooks ───────────────────────────────────────────────────
    # _STRUCTURAL_RECS is kept for backward compat but is no longer the primary
    # path — rec_synthesizer.py generates tailored recommendations via Groq.
    # Subclasses should also implement _context_for_rec() which provides a
    # model-type-specific context sentence that feeds the Groq prompt, making
    # Groq's output aware of model-type nuances without hardcoding the rec text.
    _STRUCTURAL_RECS: dict[str, dict[str, str]] = {}

    def _context_for_rec(self, principle: str, worst_param: str) -> str:
        """
        Return a SHORT context sentence for the Groq prompt that makes the
        generated recommendation model-type-aware.

        Subclasses override this. Base returns empty string (Groq still works,
        just without model-type context).
        """
        return ""

    def _context_for_rec_all(self, principles: dict) -> dict[str, str]:
        """Build the context dict for all principles to feed into rec_synthesizer."""
        out = {}
        for name, data in principles.items():
            params = data.get("parameters", {})
            worst = min(params, key=lambda k: params[k]) if params else ""
            ctx = self._context_for_rec(name, worst)
            if ctx:
                out[name] = ctx
        return out

    def _rec_for_principle(self, principle: str, params: dict) -> str:
        """Generic fallback — used when Groq is unavailable."""
        worst = min(params, key=lambda k: params[k]) if params else None
        table = self._STRUCTURAL_RECS.get(principle, {})
        if worst and worst in table:
            return table[worst]
        return f"Review and strengthen {principle.lower()} controls across all sub-parameters."

    def _rec_for_metric(self, metric_name: str) -> str:
        """Generic fallback — used when Groq is unavailable."""
        return f"Investigate elevated risk in metric '{metric_name}' and review model outputs."