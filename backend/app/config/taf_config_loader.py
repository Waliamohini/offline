"""
app/config/taf_config_loader.py
================================
Loads taf_config.yaml and exposes a validated singleton TAFConfig.

Usage:
    from app.config.taf_config_loader import cfg

    weights = cfg.fairness.demographic_tone_equity.weights
    terms   = cfg.fairness.demographic_tone_equity.demographic_terms

The loader:
  1. Reads taf_config.yaml from the same directory as this file.
  2. Validates required top-level sections exist.
  3. Exposes a dot-accessible config object (no dict["key"] syntax needed).
  4. Caches the result — loaded once at import time.

To override for a specific domain (e.g. medical), set the environment variable:
    TAF_CONFIG_PATH=/path/to/medical_taf_config.yaml
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import yaml


# ─────────────────────────────────────────────────────────────────────────────
# Dot-accessible config wrapper
# ─────────────────────────────────────────────────────────────────────────────

class _Cfg:
    """
    Wraps a dict so keys are accessible as attributes.
    Nested dicts are recursively wrapped.
    Lists are returned as-is.
    """
    def __init__(self, data: dict):
        for k, v in data.items():
            setattr(self, k, _Cfg(v) if isinstance(v, dict) else v)

    def get(self, key: str, default: Any = None) -> Any:
        return getattr(self, key, default)

    def __repr__(self) -> str:
        return f"_Cfg({vars(self)})"


# ─────────────────────────────────────────────────────────────────────────────
# Compiled regex cache
# ─────────────────────────────────────────────────────────────────────────────

_COMPILED_PATTERNS: dict[str, list] = {}


def compile_patterns(patterns: list[str], flags: int = re.I) -> list:
    """
    Compile a list of regex pattern strings into compiled pattern objects.
    Results are cached by the tuple of pattern strings.
    """
    key = str(patterns)
    if key not in _COMPILED_PATTERNS:
        compiled = []
        for p in patterns:
            try:
                compiled.append(re.compile(p, flags))
            except re.error:
                pass  # skip malformed patterns — never crash the pipeline
        _COMPILED_PATTERNS[key] = compiled
    return _COMPILED_PATTERNS[key]


# ─────────────────────────────────────────────────────────────────────────────
# Loader
# ─────────────────────────────────────────────────────────────────────────────

_REQUIRED_SECTIONS = [
    "scoring", "fairness", "transparency", "explainability",
    "accountability", "data_integrity", "reliability",
    "security", "safety", "privacy", "sustainability",
]


def _load() -> _Cfg:
    config_path = os.environ.get(
        "TAF_CONFIG_PATH",
        str(Path(__file__).parent / "taf_config.yaml"),
    )
    with open(config_path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    missing = [s for s in _REQUIRED_SECTIONS if s not in raw]
    if missing:
        raise ValueError(
            f"taf_config.yaml is missing required sections: {missing}. "
            f"Check {config_path}"
        )
    return _Cfg(raw)


# Singleton — loaded once at import time
cfg: _Cfg = _load()


# ─────────────────────────────────────────────────────────────────────────────
# Convenience accessors
# ─────────────────────────────────────────────────────────────────────────────

def get_fallback(sub_param_key: str) -> int:
    """Return the configured fallback score for a sub-parameter."""
    return getattr(cfg.scoring.fallbacks, sub_param_key, 50)


def get_pii_patterns() -> list:
    """Return compiled PII regex patterns from config."""
    return compile_patterns(cfg.security.pii_leakage_in_outputs.pii_patterns)


def get_injection_patterns() -> list:
    """Return compiled injection regex patterns from config."""
    return compile_patterns(cfg.security.prompt_injection_resistance.injection_patterns)


def get_identifier_patterns() -> list:
    """Return compiled personal identifier patterns (privacy) from config."""
    return compile_patterns(cfg.privacy.output_anonymisation.identifier_patterns)


def get_citation_patterns() -> list:
    """Return compiled structured citation patterns from config."""
    return compile_patterns(cfg.explainability.source_citation_rate.structured_patterns)


def get_hallucination_patterns() -> list[tuple]:
    """
    Return list of (compiled_pattern, weight) tuples for hallucination heuristics.
    """
    signals = cfg.safety.hallucination_containment.heuristic_signals
    result = []
    for name in ("overspecific_numbers", "absolute_claims", "impossible_temporal"):
        sig = getattr(signals, name)
        try:
            result.append((re.compile(sig.pattern, re.I), sig.weight))
        except re.error:
            pass
    return result


def get_negation_pattern() -> tuple:
    """Return (compiled_pattern, threshold, weight) for negation density signal."""
    sig = cfg.safety.hallucination_containment.heuristic_signals.high_negation_density
    return (
        re.compile(sig.pattern, re.I),
        sig.threshold,
        sig.weight,
    )
