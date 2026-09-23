"""
app/services/blackbox/audit_plan.py
====================================
Turns (tier config + selected categories + taxonomy + router) into a concrete,
inspectable plan for a single audit.

ALL applicable controls are always included — the tier controls probe DEPTH
(probes_per_control), never which controls get evaluated. This guarantees the
TAF taxonomy page shows a complete picture at every tier.

Returns:
    probe_controls   — get synthesized adversarial probes fired at the endpoint
    metric_controls  — computed from uploaded logs (statistical/ML metrics)
    profile_controls — scored from registration completeness alone
    na_controls      — honest N/A (out of reach or category not selected)
    expected_probe_count — total probes that will be fired (for progress bar)
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from app.services.blackbox.audit_config import AuditConfig, expected_probe_count
from app.services.blackbox.control_router import route_control

logger = logging.getLogger(__name__)

_TAXONOMY_PATH = Path(__file__).parent.parent.parent / "config" / "taf_taxonomy.json"


def _load_taxonomy() -> list[dict]:
    with open(_TAXONOMY_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


TAXONOMY: list[dict] = _load_taxonomy()


def build_audit_plan(
    cfg: AuditConfig,
    applicable_categories: set[str],
    build_risk_active: bool = False,
) -> dict:
    """
    Build the complete audit plan for one run.

    applicable_categories — categories selected at registration (e.g. {"DM","PD"}).
    GAI is always added automatically.
    build_risk_active — whether build-risk probes will run (ai_generated flag).

    All applicable controls are routed to their evidence channel.
    No truncation — the tier controls depth, not breadth.
    """
    applicable = {"GAI"} | set(applicable_categories or set())

    probe_controls:   list[dict] = []
    metric_controls:  list[dict] = []
    profile_controls: list[dict] = []
    na_controls:      list[dict] = []

    for row in TAXONOMY:
        cat = row.get("category")

        if cat not in applicable:
            na_controls.append(row)
            continue

        channel = route_control(row)
        if channel == "probe":
            probe_controls.append(row)
        elif channel == "metric":
            metric_controls.append(row)
        elif channel == "profile":
            profile_controls.append(row)
        else:
            na_controls.append(row)

    n_probe   = len(probe_controls)
    exp_count = expected_probe_count(cfg, n_probe, build_risk_active)

    logger.info(
        "[plan] tier=%s cats=%s | probe=%d metric=%d profile=%d na=%d | ~%d probes expected",
        cfg.tier, sorted(applicable),
        n_probe, len(metric_controls), len(profile_controls), len(na_controls),
        exp_count,
    )

    return {
        "probe_controls":        probe_controls,
        "metric_controls":       metric_controls,
        "profile_controls":      profile_controls,
        "na_controls":           na_controls,
        "probes_per_control":    cfg.probes_per_control,
        "expected_probe_count":  exp_count,
        "applicable_categories": sorted(applicable),
    }