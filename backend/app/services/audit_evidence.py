"""
app/services/audit_evidence.py
===============================
Writer + reader for the unified per-control evidence store.

Every audit channel produces evidence in ONE shape and writes it here:

    { control_id, pillar, category, channel, evidence_type,
      value (0-100), confidence, source, detail, probes }

The taxonomy mapper then reads one place per control instead of stitching
three different result dicts together. When two channels produce evidence for
the same control (e.g. a blackbox probe AND a corroborating sub-parameter
metric), the reader picks the higher-confidence one as primary and keeps the
other as corroboration.

This module owns NO scoring logic — channels compute their own scores and hand
them over. It only stores, dedups, and ranks by confidence.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

_CONF_RANK = {"high": 4, "medium": 3, "proxy": 2, "low": 1, "none": 0, None: 0}


def write_evidence(
    audit_id: str,
    ai_name: str,
    owner_id: str,
    records: list[dict],
) -> int:
    """
    Bulk-write evidence records. Each record must carry at minimum:
        control_id, channel, evidence_type, value, confidence, source, detail
    Optional: pillar, category, probes (snapshot list).

    Non-fatal: a DB failure logs and returns 0 rather than aborting the audit.
    Returns number of rows written.
    """
    from app.database import audit_evidence_collection

    written = 0
    for r in records:
        cid = (r.get("control_id") or "").strip()
        if not cid:
            continue
        try:
            audit_evidence_collection.insert_one({
                "audit_id":      audit_id,
                "ai_name":       ai_name,
                "owner_id":      owner_id,
                "control_id":    cid,
                "pillar":        r.get("pillar"),
                "category":      r.get("category"),
                "channel":       r.get("channel"),
                "evidence_type": r.get("evidence_type"),
                "value":         _as_float(r.get("value")),
                "confidence":    r.get("confidence"),
                "source":        r.get("source"),
                "detail":        r.get("detail"),
                "probes":        r.get("probes"),
            })
            written += 1
        except Exception as exc:
            logger.warning("[evidence] write failed for %s: %s", cid, exc)
    logger.info("[evidence] wrote %d/%d evidence rows for audit %s", written, len(records), audit_id[:8])
    return written


def read_evidence_for_audit(audit_id: str) -> dict[str, dict]:
    """
    Return {control_id: primary_evidence_record} for one audit.

    When multiple records exist for a control, the highest-confidence one is
    primary; the rest are attached under primary["corroboration"].
    """
    from app.database import audit_evidence_collection

    try:
        rows = audit_evidence_collection.find({"audit_id": audit_id})
    except Exception as exc:
        logger.warning("[evidence] read failed for audit %s: %s", audit_id, exc)
        return {}

    return _rank_by_control(rows)


def read_latest_evidence(ai_name: str, owner_id: str) -> dict[str, dict]:
    """Return primary evidence per control for the most recent audit of this AI."""
    from app.database import audit_evidence_collection

    try:
        latest = audit_evidence_collection.find_one(
            {"ai_name": ai_name, "owner_id": owner_id}, sort=[("created_at", -1)]
        )
        if not latest:
            return {}
        rows = audit_evidence_collection.find({"audit_id": latest.get("audit_id")})
    except Exception as exc:
        logger.warning("[evidence] read_latest failed for %s: %s", ai_name, exc)
        return {}

    return _rank_by_control(rows)


def _rank_by_control(rows: list[dict]) -> dict[str, dict]:
    by_control: dict[str, list[dict]] = {}
    for r in rows:
        by_control.setdefault(r["control_id"], []).append(r)

    out: dict[str, dict] = {}
    for cid, recs in by_control.items():
        recs.sort(key=lambda x: _CONF_RANK.get(x.get("confidence"), 0), reverse=True)
        primary = dict(recs[0])
        if len(recs) > 1:
            primary["corroboration"] = [
                {"source": r.get("source"), "value": r.get("value"),
                 "confidence": r.get("confidence"), "channel": r.get("channel")}
                for r in recs[1:]
            ]
        out[cid] = primary
    return out


def _as_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None