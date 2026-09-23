"""
app/services/blackbox/control_router.py
=========================================
Routes every taxonomy control to the ONE evidence channel that can honestly
test it, by parsing the control's `test` field from taf_taxonomy.json.

Channels
--------
  probe    — a live adversarial prompt fired at the endpoint can exercise this
             (toxicity, injection, PII disclosure, red-team, membership
             inference, input manipulation, accountability deferral, etc.)
  metric   — needs uploaded logs + a statistical/ML metric computed over them
             (ROC-AUC by group, PSI, ECE, concept drift, silhouette,
             fairness drift, imbalance ratio, ...). No probe can produce these.
  profile  — determinable from registration completeness alone
             (model card completeness, audit trail coverage).
  none     — needs data we cannot obtain (training-data stats, carbon from
             training, SHAP/LIME internals). Stays an honest N/A.

The routing is DERIVED from the taxonomy text — there is no per-control
hardcoded table. Add a control to the JSON and it routes automatically.

Why this matters
----------------
GAI controls are ~90% probe-testable (you audit them by talking to the model).
PAI/PD/DM/DP controls are ~75% metric-testable (you audit them by analysing
what they produced). Firing probes at a fraud-scoring model to test ROC-AUC
parity is meaningless — that needs the log + the metric. This router is what
stops the pipeline from generating useless probes for metric-only controls.
"""

from __future__ import annotations

from typing import Literal

Channel = Literal["probe", "metric", "profile", "none"]


# ── Signal vocabularies parsed out of the taxonomy `test` field ───────────────
# Order of precedence when a test names several methods:  none > metric > profile > probe
# (a control that needs training data can't be rescued by a probe, so 'none' wins).

# Methods that REQUIRE data we cannot obtain from an endpoint or normal logs.
_NONE_SIGNALS = (
    "training data", "training-data", "fine-tuning data", "fine-tune data",
    "raw training", "differential privacy epsilon", "epsilon differential",
    "carbon footprint", "training energy", "compute cost", "kwh",
    "shap", "lime", "attention visualization", "feature importance",
    "counterfactual explanation",
)

# Methods that need structured logs + a statistical / ML metric.
_METRIC_SIGNALS = (
    "roc-auc", "roc auc", "demographic parity", "fairness drift", "disparate impact",
    "population stability", "psi", "expected calibration", "ece", "calibration error",
    "concept drift", "silhouette", "cluster stability", "cluster purity",
    "fowlkes", "adjusted rand", "imbalance ratio", "mutual information",
    "data completeness", "generalization gap", "anomaly detection rate",
    "data validity", "data quality", "novelty", "hit rate", "diversity",
    "false positive", "false negative", "adversarial accuracy", "facet",
    "policy fairness", "retrieval metric", "recall@", "bleu", "rouge",
    "groundedness", "kl divergence", "perplexity", "cross-validation",
    "output consistency rate", "inference energy", "sustainability compliance",
    "incident response time",
)

# Methods determinable from registration completeness alone.
_PROFILE_SIGNALS = (
    "model card", "audit trail coverage", "foundation model transparency",
    "data provenance coverage", "documentation",
)

# Methods a live adversarial probe can genuinely exercise.
_PROBE_SIGNALS = (
    "adversarial perturbation", "adversarial robustness", "adversarial benchmark",
    "prompt injection", "red team", "red-team", "red teaming", "jailbreak",
    "toxicity", "hallucination rate", "hhem", "pii detection", "pii in output",
    "membership inference", "input manipulation", "backdoor",
    "inference linkability", "ai accountability metric", "chain-of-thought",
    "cot prompting", "statistical outlier", "input manipulation attack",
    "stress test", "perturbation test",
)


def _matches(test: str, signals: tuple) -> bool:
    return any(s in test for s in signals)


def route_control(row: dict) -> Channel:
    """
    Decide the evidence channel for one taxonomy row.

    Uses `mapped` first (No/N-A short-circuit to 'none'), then parses `test`.
    A control with no usable test string but a documentation-style pillar
    (Transparency/Accountability) defaults to 'profile'; everything else with
    an empty test defaults to 'metric' (it produced something to analyse) —
    except pure-probe pillars which default to 'probe'.
    """
    mapped = (row.get("mapped") or "").strip().lower()
    if mapped in ("no", "n/a", "na", ""):
        # 'No' may still be training-unlockable, but that's handled downstream;
        # for routing purposes it is not a live-probe or metric target.
        # We still route 'No' training-gated rows to 'none' here.
        return "none"

    test = (row.get("test") or "").strip().lower()
    pillar = (row.get("pillar") or "").strip().lower()
    category = (row.get("category") or "").strip().upper()

    # Explicit precedence
    if _matches(test, _NONE_SIGNALS):
        return "none"
    if _matches(test, _PROBE_SIGNALS):
        return "probe"
    if _matches(test, _METRIC_SIGNALS):
        return "metric"
    if _matches(test, _PROFILE_SIGNALS):
        return "profile"

    # ── GAI is conversation-audited ─────────────────────────────────────────
    # A GAI control that wasn't caught by the metric/none/profile signals above
    # is testable by talking to the model. Only the documentation pillars
    # (where the risk is "no docs exist", not a behaviour) route to profile.
    # This deliberately routes GAI Reliability/Data-Integrity/Transparency
    # behaviour controls (output consistency under pressure, groundedness,
    # AI self-identification) to probe — they ARE exercisable in conversation
    # even though a metric could corroborate them.
    if category == "GAI":
        if pillar == "accountability":
            return "profile"
        return "probe"

    # Non-GAI categories are output-audited: default to metric, except the
    # documentation pillars.
    if pillar in ("transparency", "accountability"):
        return "profile"
    if pillar in ("safety", "security", "privacy"):
        # these pillars DO have probe-testable non-GAI controls (red-team,
        # membership inference, input manipulation) — but only when the test
        # named them, which _PROBE_SIGNALS already caught above. An empty test
        # here means we can't probe it; fall to metric.
        return "metric"
    return "metric"


def channel_summary(taxonomy: list[dict]) -> dict:
    """Debug helper: count controls per channel per category."""
    from collections import defaultdict
    out: dict = defaultdict(lambda: defaultdict(int))
    for row in taxonomy:
        ch = route_control(row)
        out[row.get("category", "?")][ch] += 1
    return {k: dict(v) for k, v in out.items()}