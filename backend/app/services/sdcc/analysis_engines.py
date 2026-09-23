"""
app/services/sdcc/analysis_engines.py
======================================
Real ML-backed analysis engines with graceful fallback.

Each engine tries to import a proper free library. If the library is
installed, it uses the real model. If not, it falls back to the existing
heuristic and reports which tier it ran at, so the audit trail is honest
about the quality of every score.

Tiers (returned in every result as `engine`):
  "ml"        — real model (VADER, textstat, detoxify, presidio)
  "heuristic" — keyword/regex fallback (dev-grade)

Install to upgrade (no code change needed):
  pip install vaderSentiment textstat          # always worth it — tiny, pure-python
  pip install detoxify                          # real toxicity — needs torch (~2GB)
  pip install presidio-analyzer presidio-anonymizer && python -m spacy download en_core_web_lg   # real PII NER
"""

from __future__ import annotations
import logging
import re
from functools import lru_cache
from typing import Optional

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
# 1. SENTIMENT  (Fairness bias detection)
#    Real: VADER (lexicon + grammatical rules, tuned for social text)
#    Fallback: positive/negative word-count
# ═══════════════════════════════════════════════════════════════════════════

@lru_cache(maxsize=1)
def _vader():
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
        return SentimentIntensityAnalyzer()
    except Exception:
        return None


def sentiment_polarity(text: str, pos_terms: set = None, neg_terms: set = None) -> tuple[float, str]:
    """
    Return (polarity in [-1, 1], engine).
    VADER compound score if available, else pos/neg word-count fallback.
    """
    analyzer = _vader()
    if analyzer is not None:
        return analyzer.polarity_scores(text)["compound"], "ml"

    # Fallback — word count
    pos_terms = pos_terms or set()
    neg_terms = neg_terms or set()
    toks = re.findall(r'\b\w+\b', text.lower())
    pos = sum(1 for t in toks if t in pos_terms)
    neg = sum(1 for t in toks if t in neg_terms)
    total = pos + neg
    if total == 0:
        return 0.0, "heuristic"
    return (pos - neg) / total, "heuristic"


def group_sentiment_disparity(
    group_a: list[str], group_b: list[str],
    pos_terms: set = None, neg_terms: set = None,
) -> tuple[float, str]:
    """
    Mean |sentiment(A) - sentiment(B)| — the core Fairness bias signal.
    Returns (disparity in [0, 1], engine).
    """
    if not group_a or not group_b:
        return 0.0, "heuristic"
    eng = "ml" if _vader() is not None else "heuristic"
    sa = sum(sentiment_polarity(t, pos_terms, neg_terms)[0] for t in group_a) / len(group_a)
    sb = sum(sentiment_polarity(t, pos_terms, neg_terms)[0] for t in group_b) / len(group_b)
    return abs(sa - sb) / 2.0, eng   # /2 normalises [-1,1] range to [0,1]


# ═══════════════════════════════════════════════════════════════════════════
# 2. READABILITY  (Explainability — Flesch)
#    Real: textstat (proper syllable dictionary + all readability formulas)
#    Fallback: vowel-group syllable estimate
# ═══════════════════════════════════════════════════════════════════════════

@lru_cache(maxsize=1)
def _has_textstat() -> bool:
    try:
        import textstat  # noqa
        return True
    except Exception:
        return False


def flesch_reading_ease(text: str) -> tuple[float, str]:
    """Return (Flesch Reading Ease 0-100+, engine)."""
    if not text.strip():
        return 50.0, "heuristic"
    if _has_textstat():
        import textstat
        try:
            return float(textstat.flesch_reading_ease(text)), "ml"
        except Exception:
            pass
    # Fallback — manual estimate
    words = text.split()
    sents = max(len(re.split(r'[.!?]+', text)), 1)
    if not words:
        return 50.0, "heuristic"
    syllables = sum(max(1, len(re.findall(r'[aeiouAEIOU]+', w))) for w in words)
    fre = 206.835 - 1.015 * (len(words) / sents) - 84.6 * (syllables / len(words))
    return fre, "heuristic"


# ═══════════════════════════════════════════════════════════════════════════
# 3. TOXICITY  (Safety / Security — harmful content)
#    Real: detoxify (unbiased RoBERTa, 6 toxicity dimensions)
#    Mid:  VADER strong-negativity as a weak toxicity proxy
#    Fallback: keyword-list rate
# ═══════════════════════════════════════════════════════════════════════════

@lru_cache(maxsize=1)
def _detoxify():
    try:
        from detoxify import Detoxify
        return Detoxify("original")
    except Exception:
        return None


def toxicity_score(text: str, harmful_terms: set = None) -> tuple[float, str]:
    """
    Return (toxicity in [0, 1], engine).
    detoxify > VADER-negativity > keyword rate.
    """
    model = _detoxify()
    if model is not None:
        try:
            return float(model.predict(text)["toxicity"]), "ml"
        except Exception:
            pass

    # Mid-tier: VADER strong negativity as a weak toxicity proxy
    analyzer = _vader()
    if analyzer is not None:
        neg = analyzer.polarity_scores(text)["neg"]
        # Only count as toxicity signal if strongly negative
        if neg > 0.5:
            return neg, "heuristic"   # honest: still heuristic tier

    # Fallback: keyword rate
    harmful_terms = harmful_terms or set()
    toks = set(re.findall(r'\b\w+\b', text.lower()))
    if harmful_terms and (toks & harmful_terms):
        return 0.8, "heuristic"
    return 0.0, "heuristic"


def toxicity_rate(texts: list[str], harmful_terms: set = None) -> tuple[float, str]:
    """Mean toxicity across a list. Returns (rate, engine)."""
    if not texts:
        return 0.0, "heuristic"
    model = _detoxify()
    if model is not None:
        try:
            preds = model.predict(texts)
            tox = preds["toxicity"]
            vals = tox if isinstance(tox, list) else [tox]
            return sum(float(v) for v in vals) / len(vals), "ml"
        except Exception:
            pass
    # Non-ML path
    scores = [toxicity_score(t, harmful_terms) for t in texts]
    eng = "heuristic"
    return sum(s for s, _ in scores) / len(scores), eng


# ═══════════════════════════════════════════════════════════════════════════
# 4. PII DETECTION  (Privacy / Security)
#    Real: Microsoft Presidio (spaCy NER + context + checksums)
#    Fallback: enhanced regex (email, phone, Aadhaar, PAN, credit card, SSN)
# ═══════════════════════════════════════════════════════════════════════════

@lru_cache(maxsize=1)
def _presidio():
    try:
        from presidio_analyzer import AnalyzerEngine
        return AnalyzerEngine()
    except Exception:
        return None


# Enhanced fallback regex — India + international
_PII_PATTERNS = [
    re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'),          # email
    re.compile(r'\b(?:\+?91[\s-]?)?[6-9]\d{9}\b'),                               # Indian mobile
    re.compile(r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b'),                              # Aadhaar
    re.compile(r'\b[A-Z]{5}\d{4}[A-Z]\b'),                                       # PAN
    re.compile(r'\b(?:\d{4}[\s-]?){3}\d{4}\b'),                                  # credit card
    re.compile(r'\b\d{3}-\d{2}-\d{4}\b'),                                        # US SSN
    re.compile(r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b'),                            # DOB
]


def pii_detected(text: str) -> tuple[bool, str]:
    """Return (True if PII present, engine)."""
    analyzer = _presidio()
    if analyzer is not None:
        try:
            results = analyzer.analyze(text=text, language="en")
            # Only count high-confidence entities
            return any(r.score >= 0.5 for r in results), "ml"
        except Exception:
            pass
    return any(p.search(text) for p in _PII_PATTERNS), "heuristic"


def pii_rate(texts: list[str]) -> tuple[float, str]:
    """Fraction of texts containing PII. Returns (rate, engine)."""
    if not texts:
        return 0.0, "heuristic"
    analyzer = _presidio()
    eng = "ml" if analyzer is not None else "heuristic"
    hits = sum(1 for t in texts if pii_detected(t)[0])
    return hits / len(texts), eng




# ═══════════════════════════════════════════════════════════════════════════
# 5. FAIRNESS METRICS  (fairlearn — demographic parity, equalized odds)
#    Real: fairlearn (Microsoft, free, pip install fairlearn)
#    Fallback: VADER sentiment disparity (already above)
#
#    fairlearn needs: sensitive_feature col + label/prediction col in logs.
#    When present → real demographic parity / equalized odds computation.
#    When absent  → fall back to VADER sentiment disparity.
# ═══════════════════════════════════════════════════════════════════════════

@lru_cache(maxsize=1)
def _has_fairlearn() -> bool:
    try:
        import fairlearn  # noqa
        return True
    except Exception:
        return False


def fairlearn_metrics(
    y_true: list,
    y_pred: list,
    sensitive_features: list,
) -> tuple[dict, str]:
    """
    Compute demographic parity difference and equalized odds difference.
    Returns ({metric_name: value}, engine).
    Requires fairlearn installed + label/prediction/sensitive_feature columns.
    Lower values = fairer (0 = perfectly fair).
    """
    if not y_true or not y_pred or not sensitive_features:
        return {}, "heuristic"
    if _has_fairlearn():
        try:
            from fairlearn.metrics import (
                demographic_parity_difference,
                equalized_odds_difference,
            )
            import numpy as np
            yt = np.array(y_true)
            yp = np.array(y_pred)
            sf = np.array(sensitive_features)
            dpd = float(demographic_parity_difference(yt, yp, sensitive_features=sf))
            eod = float(equalized_odds_difference(yt, yp, sensitive_features=sf))
            return {
                "demographic_parity_difference": round(dpd, 4),
                "equalized_odds_difference":     round(eod, 4),
                # 0 = perfectly fair, 1 = maximally unfair — invert to 0-100 score
                "fairness_score": round(max(0.0, 100.0 - (abs(dpd) + abs(eod)) * 100), 1),
            }, "ml"
        except Exception as e:
            logger.warning("fairlearn failed: %s", e)
    return {}, "heuristic"

# ═══════════════════════════════════════════════════════════════════════════
# ENGINE STATUS  (surfaced to the frontend so users see the tier)
# ═══════════════════════════════════════════════════════════════════════════

def engine_status() -> dict:
    """Report which real engines are active vs falling back to heuristics."""
    return {
        "sentiment":  {"engine": "VADER"    if _vader()     else "keyword-count", "tier": "ml" if _vader()     else "heuristic"},
        "readability":{"engine": "textstat" if _has_textstat() else "manual-flesch", "tier": "ml" if _has_textstat() else "heuristic"},
        "toxicity":   {"engine": "detoxify" if _detoxify()  else ("vader-neg" if _vader() else "keyword"), "tier": "ml" if _detoxify() else "heuristic"},
        "pii":        {"engine": "presidio" if _presidio()  else "regex", "tier": "ml" if _presidio() else "heuristic"},
        "fairness":   {"engine": "fairlearn" if _has_fairlearn() else "vader-sentiment", "tier": "ml" if _has_fairlearn() else "heuristic"},
    }