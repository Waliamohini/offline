"""
app/services/blackbox/audit_config.py
======================================
Single source of truth for how big an audit is.

Three effort tiers — every probe count in the entire pipeline is derived from
the tier. There are NO magic numbers scattered anywhere else.

    dev       ~66-100 probes    fast iteration / CI            low confidence
    standard  ~175-270 probes   real client audits             medium/high confidence
    thorough  ~350-540 probes   certification-grade evidence   high confidence

ALL THREE TIERS evaluate ALL applicable taxonomy controls.
The tier controls how many probes per control, not which controls get skipped.

GAI has 22 probe-testable controls.
Each selected non-GAI category adds 2-5 probe-testable controls.
Metrics (log-based) and profile (registration-based) controls always run
regardless of tier — they cost nothing in probe budget.

Actual probe counts (GAI only, no build risk):
    dev:      22 controls × 1 probe = 22 + 8-22 fingerprint    = ~44-66
    standard: 22 controls × 3 probes = 66 + 22-36 fingerprint  = ~88-102
    thorough: 22 controls × 6 probes = 132 + 36-60 fingerprint = ~168-192
    (adaptive follow-up adds up to 30 more for standard/thorough)

With all 5 categories selected (36 probe-testable controls total):
    dev:      36 × 1  + fingerprint                = ~44-80
    standard: 36 × 3  + fingerprint + 15 adaptive  = ~145-180
    thorough: 36 × 6  + fingerprint + 45 adaptive  = ~280-350
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Literal

Tier = Literal["dev", "standard", "thorough"]


@dataclass(frozen=True)
class AuditConfig:
    tier: Tier

    # ── Fingerprint depth ──────────────────────────────────────────────────
    # phrasings_per_dimension × 8 dimensions = self-report probes
    # behavioral_elicitation: inferred probes that catch self-misreporting
    fingerprint_phrasings_per_dimension: int = 1
    fingerprint_behavioral_probes:       int = 0

    # ── Control-probe generation ───────────────────────────────────────────
    # All applicable controls are always evaluated. This controls depth only.
    probes_per_control: int = 1

    # ── Adaptive follow-up waves (targets weakest controls after main pass) ─
    adaptive_followup_probes: int = 0   # 0 = skip
    adaptive_deepdive_probes: int = 0   # 0 = skip (thorough only)

    # ── Build-risk probes (only when ai_generated flagged) ─────────────────
    # 16 checks active; budget sets how many probes per check on average.
    # synthesize_build_risk_probes() distributes floor(budget/active_checks).
    build_risk_budget: int = 11

    # ── Confidence thresholds (probes needed per control) ──────────────────
    conf_high_min:   int = 6
    conf_medium_min: int = 3
    conf_low_min:    int = 1

    # ── Concurrency ────────────────────────────────────────────────────────
    concurrency: int = 3


_CONFIGS: Dict[str, AuditConfig] = {
    "dev": AuditConfig(
        tier="dev",
        fingerprint_phrasings_per_dimension=2,   # 2 phrasings × 8 dims = 16 fp probes
        fingerprint_behavioral_probes=0,
        probes_per_control=2,                    # 2 × 22 GAI controls = 44 control probes
        adaptive_followup_probes=0,
        adaptive_deepdive_probes=0,
        build_risk_budget=16,                    # one probe per build-risk check
        concurrency=4,
    ),
    "standard": AuditConfig(
        tier="standard",
        fingerprint_phrasings_per_dimension=2,
        fingerprint_behavioral_probes=6,
        probes_per_control=3,
        adaptive_followup_probes=15,
        adaptive_deepdive_probes=0,
        build_risk_budget=30,
        concurrency=3,
    ),
    "thorough": AuditConfig(
        tier="thorough",
        fingerprint_phrasings_per_dimension=3,
        fingerprint_behavioral_probes=12,
        probes_per_control=6,
        adaptive_followup_probes=30,
        adaptive_deepdive_probes=15,
        build_risk_budget=55,
        concurrency=3,
    ),
}


def get_config(tier: str | None) -> AuditConfig:
    """Resolve a tier string to its AuditConfig. Defaults to 'standard'."""
    key = (tier or "standard").strip().lower()
    return _CONFIGS.get(key, _CONFIGS["standard"])


def confidence_for_n(cfg: AuditConfig, n_probes: int) -> str:
    """Honest confidence label for a control tested with n_probes."""
    if n_probes >= cfg.conf_high_min:   return "high"
    if n_probes >= cfg.conf_medium_min: return "medium"
    if n_probes >= cfg.conf_low_min:    return "low"
    return "none"


def fingerprint_probe_count(cfg: AuditConfig, n_dimensions: int = 8) -> int:
    """Total fingerprint probes this tier will fire (for progress bars)."""
    return (n_dimensions * cfg.fingerprint_phrasings_per_dimension
            + cfg.fingerprint_behavioral_probes)


def expected_probe_count(
    cfg: AuditConfig,
    n_probe_controls: int,
    build_risk_active: bool = False,
) -> int:
    """
    Estimate total probes for the progress endpoint and loader animation.
    Called at audit start so the DB row gets total_probes_expected written.
    """
    fp  = fingerprint_probe_count(cfg)
    cp  = n_probe_controls * cfg.probes_per_control
    af  = cfg.adaptive_followup_probes + cfg.adaptive_deepdive_probes
    br  = cfg.build_risk_budget if build_risk_active else 0
    return fp + cp + af + br