"""
app/services/blackbox/probe_logger.py
=======================================
Saves probe results to PostgreSQL. Two tables are written on every call:

  1. probe_logs        — legacy flat table, kept so existing reads
                          (fetch_logs_from_postgres, historical audits)
                          keep working unchanged.
  2. probe_run_logs    — new, typed table: scoped to ai_system_id + owner_id
                          instead of a free-text (ai_name, log_type) pair,
                          so "every probe ever run against this AI system"
                          is one indexed query instead of a table shared by
                          every AI system and log type at once. Every row
                          keeps latency_ms as a first-class field (the
                          round-trip time for that specific probe call).

The CSV-file approach these functions are named after is retired — nothing
here writes to disk. Function names (save_probe_csv, etc.) and signatures
are kept for backward compatibility; new callers should still just call
these same functions and pass `owner_id` when available so the new table
can be scoped correctly.

Standard probe schema:
    task_id    → probe_id  (e.g. "transparency_1", "safety_3")
    input      → the probe prompt sent to the AI
    output     → the full AI response text (no truncation)
    latency_ms → round-trip latency in milliseconds (float)

Phase 1 fingerprint columns stored in extra (JSONB):
    dimension, probe_question, registration_value, system_prompt_value,
    reconciliation_status, governance_finding, notes
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


def _strip_nulls(obj):
    """Strip PostgreSQL-illegal null bytes from any string in a nested structure."""
    if isinstance(obj, str):
        return obj.replace("\x00", "")
    if isinstance(obj, dict):
        return {k: _strip_nulls(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_strip_nulls(v) for v in obj]
    return obj


def _get_collection():
    """Lazy import to avoid circular imports at module load time."""
    from app.database import probe_logs_collection
    return probe_logs_collection


def _get_typed_collection():
    from app.database import probe_run_logs_collection
    return probe_run_logs_collection


_ai_system_id_cache: dict[tuple[str, str], Optional[str]] = {}


def _resolve_ai_system_id(ai_name: str, owner_id: Optional[str]) -> Optional[str]:
    """
    Looks up ai_systems.id for (ai_name, owner_id). Cached per-process for the
    lifetime of a single audit run (this gets called once per probe row, and
    the AI system obviously doesn't change mid-audit). Returns None rather
    than raising if owner_id is missing or no match is found — probe_run_logs
    keeps writing either way, just without the FK populated for that row.
    """
    if not owner_id:
        return None
    key = (ai_name, owner_id)
    if key in _ai_system_id_cache:
        return _ai_system_id_cache[key]
    try:
        from app.database import ai_collection
        doc = ai_collection.find_one({"name": ai_name, "owner_id": owner_id})
        result = str(doc["id"]) if doc and doc.get("id") else None
    except Exception:
        result = None
    _ai_system_id_cache[key] = result
    return result


def _write_typed_row(
    *, ai_name: str, owner_id: Optional[str], audit_id: str, log_type: str,
    mode: Optional[str], task_id: Optional[str], dimension: Optional[str],
    input_text: Optional[str], output_text: Optional[str], latency_ms: float,
    extra: Optional[dict], created_at,
) -> None:
    try:
        _get_typed_collection().insert_one(_strip_nulls({
            "ai_system_id": _resolve_ai_system_id(ai_name, owner_id),
            "ai_name":      ai_name,
            "owner_id":     owner_id,
            "audit_id":     audit_id,
            "log_type":     log_type,
            "mode":         mode,
            "task_id":      task_id,
            "dimension":    dimension,
            "input":        input_text,
            "output":       output_text,
            "latency_ms":   latency_ms,
            "extra":        extra,
            "created_at":   created_at,
        }))
    except Exception as exc:
        logger.error("[probe_logger] Failed to insert probe_run_logs row: %s", exc)


# ── Standard probe rows ────────────────────────────────────────────────────────

def save_probe_csv(
    audit_id:      str,
    ai_name:       str,
    mode:          str,
    probe_results: list[dict],
    started_at:    str = "",
    owner_id:      Optional[str] = None,
) -> str:
    """
    Persist probe results to Postgres (probe_logs + probe_run_logs).
    Returns "" (no CSV path — file writes are retired).
    """
    col = _get_collection()
    rows_written = 0

    for pr in probe_results:
        latency_ms = float(pr.get("latency_ms") or 0)
        created_at = datetime.now(timezone.utc)
        try:
            col.insert_one(_strip_nulls({
                "audit_id":   audit_id,
                "ai_name":    ai_name,
                "log_type":   "probe",
                "mode":       mode,
                "task_id":    pr.get("probe_id", ""),
                "input":      pr.get("prompt", ""),
                "output":     pr.get("response", ""),
                "latency_ms": latency_ms,
                "created_at": created_at,
            }))
            rows_written += 1
        except Exception as exc:
            logger.error("[probe_logger] Failed to insert probe row: %s", exc)

        _write_typed_row(
            ai_name=ai_name, owner_id=owner_id, audit_id=audit_id, log_type="probe",
            mode=mode, task_id=pr.get("probe_id", ""), dimension=None,
            input_text=pr.get("prompt", ""), output_text=pr.get("response", ""),
            latency_ms=latency_ms, extra=None, created_at=created_at,
        )

    logger.info(
        "[probe_logger] %d probe rows saved to Postgres (audit=%s, ai=%s)",
        rows_written, audit_id, ai_name,
    )
    return ""   # backward-compat: callers that stored the path get ""


# ── Phase 1 fingerprint rows ───────────────────────────────────────────────────

def save_fingerprint_csv(
    audit_id:               str,
    ai_name:                str,
    reconciliation_records: list[dict],
    probes:                 list[dict],
    started_at:             str = "",
    owner_id:               Optional[str] = None,
) -> str:
    """
    Persist Phase 1 three-source fingerprint records to Postgres.
    Returns "" (no CSV path).
    """
    col = _get_collection()

    prompt_by_field: dict[str, str] = {
        p.get("field", ""): p.get("prompt", "") for p in probes
    }

    rows_written = 0
    for rec in reconciliation_records:
        dim      = rec.get("dimension") or rec.get("field", "")
        question = rec.get("probe_question") or prompt_by_field.get(dim, "")
        latency_ms = float(rec.get("latency_ms") or 0)
        created_at = datetime.now(timezone.utc)
        extra = {
            "registration_value":    rec.get("registration_value") or rec.get("user_value", ""),
            "system_prompt_value":   rec.get("system_prompt_value", ""),
            "reconciliation_status": rec.get("status", ""),
            "governance_finding":    rec.get("governance_finding", ""),
            "notes":                 rec.get("notes") or rec.get("note", ""),
        }
        output_text = rec.get("model_response") or rec.get("ai_response", "")
        try:
            col.insert_one(_strip_nulls({
                "audit_id":   audit_id,
                "ai_name":    ai_name,
                "log_type":   "fingerprint",
                "mode":       "phase1",
                "task_id":    rec.get("probe_id") or f"sr_{dim}",
                "dimension":  dim,
                "input":      question,
                "output":     output_text,
                "latency_ms": latency_ms,
                "extra":      extra,
                "created_at": created_at,
            }))
            rows_written += 1
        except Exception as exc:
            logger.error("[probe_logger] Failed to insert fingerprint row: %s", exc)

        _write_typed_row(
            ai_name=ai_name, owner_id=owner_id, audit_id=audit_id, log_type="fingerprint",
            mode="phase1", task_id=rec.get("probe_id") or f"sr_{dim}", dimension=dim,
            input_text=question, output_text=output_text,
            latency_ms=latency_ms, extra=extra, created_at=created_at,
        )

    logger.info(
        "[probe_logger] %d fingerprint rows saved to Postgres (audit=%s, ai=%s)",
        rows_written, audit_id, ai_name,
    )
    return ""


# ── Re-run probe rows ──────────────────────────────────────────────────────────

def save_rerun_probe_csv(
    audit_id:       str,
    ai_name:        str,
    mode:           str,
    probe_results:  list[dict],
    started_at:     str = "",
    rerun_sequence: int = 2,
    owner_id:       Optional[str] = None,
) -> str:
    col = _get_collection()
    rows_written = 0
    log_type = f"rerun_{rerun_sequence}"

    for pr in probe_results:
        latency_ms = float(pr.get("latency_ms") or 0)
        created_at = datetime.now(timezone.utc)
        try:
            col.insert_one(_strip_nulls({
                "audit_id":   audit_id,
                "ai_name":    ai_name,
                "log_type":   log_type,
                "mode":       mode,
                "task_id":    pr.get("probe_id", ""),
                "input":      pr.get("prompt", ""),
                "output":     pr.get("response", ""),
                "latency_ms": latency_ms,
                "created_at": created_at,
            }))
            rows_written += 1
        except Exception as exc:
            logger.error("[probe_logger] Failed to insert rerun probe row: %s", exc)

        _write_typed_row(
            ai_name=ai_name, owner_id=owner_id, audit_id=audit_id, log_type=log_type,
            mode=mode, task_id=pr.get("probe_id", ""), dimension=None,
            input_text=pr.get("prompt", ""), output_text=pr.get("response", ""),
            latency_ms=latency_ms, extra=None, created_at=created_at,
        )

    logger.info(
        "[probe_logger] %d re-run probe rows (seq=%d) saved to Postgres (audit=%s)",
        rows_written, rerun_sequence, audit_id,
    )
    return ""


def save_rerun_fingerprint_csv(
    audit_id:                   str,
    ai_name:                    str,
    reconciliation_records:     list[dict],
    probes:                     list[dict],
    started_at:                 str = "",
    rerun_sequence:             int = 2,
    prior_fingerprint_statuses: dict[str, str] | None = None,
    owner_id:                   Optional[str] = None,
) -> str:
    prior_fingerprint_statuses = prior_fingerprint_statuses or {}
    col = _get_collection()

    prompt_by_field: dict[str, str] = {
        p.get("field", ""): p.get("prompt", "") for p in probes
    }

    rows_written = 0
    log_type = f"rerun_fingerprint_{rerun_sequence}"
    for rec in reconciliation_records:
        dim      = rec.get("dimension") or rec.get("field", "")
        question = rec.get("probe_question") or prompt_by_field.get(dim, "")
        latency_ms = float(rec.get("latency_ms") or 0)
        created_at = datetime.now(timezone.utc)
        extra = {
            "registration_value":    rec.get("registration_value") or rec.get("user_value", ""),
            "system_prompt_value":   rec.get("system_prompt_value", ""),
            "reconciliation_status": rec.get("status", ""),
            "governance_finding":    rec.get("governance_finding", ""),
            "notes":                 rec.get("notes") or rec.get("note", ""),
            "prior_status":          prior_fingerprint_statuses.get(dim, ""),
        }
        output_text = rec.get("model_response") or rec.get("ai_response", "")
        try:
            col.insert_one(_strip_nulls({
                "audit_id":   audit_id,
                "ai_name":    ai_name,
                "log_type":   log_type,
                "mode":       f"phase1_r{rerun_sequence}",
                "task_id":    rec.get("probe_id") or f"sr_{dim}",
                "dimension":  dim,
                "input":      question,
                "output":     output_text,
                "latency_ms": latency_ms,
                "extra":      extra,
                "created_at": created_at,
            }))
            rows_written += 1
        except Exception as exc:
            logger.error("[probe_logger] Failed to insert rerun fingerprint row: %s", exc)

        _write_typed_row(
            ai_name=ai_name, owner_id=owner_id, audit_id=audit_id, log_type=log_type,
            mode=f"phase1_r{rerun_sequence}", task_id=rec.get("probe_id") or f"sr_{dim}",
            dimension=dim, input_text=question, output_text=output_text,
            latency_ms=latency_ms, extra=extra, created_at=created_at,
        )

    logger.info(
        "[probe_logger] %d re-run fingerprint rows (seq=%d) saved to Postgres (audit=%s)",
        rows_written, rerun_sequence, audit_id,
    )
    return ""


# ── Backward-compat aliases ─────────────────────────────────────────────────────
save_phase1_csv = save_fingerprint_csv
save_phase2_csv = save_probe_csv