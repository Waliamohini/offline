"""
app/services/sdcc/log_normaliser.py
=====================================
Universal log ingestion layer.

Accepts any uploaded file format — CSV, JSON, Excel (.xlsx/.xls),
SQL dump (.sql), TSV, Parquet — and normalises it into a standard
DataFrame with columns:

    task_id   (str)   unique row identifier
    input     (str)   user prompt / query
    output    (str)   AI response
    latency   (float) response time ms  (0 if not present)
    extra     (dict)  any additional columns, preserved as-is

Then persists every row to the `probe_logs` Postgres table so all
downstream analysis reads from Postgres, not from in-memory blobs.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

logger = logging.getLogger(__name__)

# ── Column alias maps ─────────────────────────────────────────────────────────
_TASK_ID_ALIASES  = {"task_id", "taskid", "uid", "unique_id", "id", "row_id",
                      "record_id", "log_id", "session_id", "conversation_id"}
_INPUT_ALIASES    = {"input", "prompt", "query", "question", "instruction",
                      "user_message", "user_input", "human", "request",
                      "message", "utterance", "text"}
_OUTPUT_ALIASES   = {"output", "response", "answer", "completion", "result",
                      "assistant", "ai_response", "bot_response", "reply",
                      "generated", "prediction"}
_LATENCY_ALIASES  = {"latency", "latency_ms", "duration", "response_time",
                      "elapsed", "time_ms", "ms", "response_latency",
                      "inference_time", "rt"}


def _match_col(columns: List[str], aliases: set) -> Optional[str]:
    """Return first column name matching any alias (case-insensitive)."""
    for col in columns:
        if col.strip().lower().replace(" ", "_").replace("-", "_") in aliases:
            return col
    return None


def _normalise_df(df: pd.DataFrame) -> pd.DataFrame:
    """
    Remap whatever columns exist to our standard schema.
    Adds task_id if missing. Coerces types. Strips NUL bytes.
    """
    # Normalise column names
    df.columns = [
        c.strip().lower().replace(" ", "_").replace("-", "_")
        for c in df.columns
    ]
    cols = list(df.columns)

    task_col    = _match_col(cols, _TASK_ID_ALIASES)
    input_col   = _match_col(cols, _INPUT_ALIASES)
    output_col  = _match_col(cols, _OUTPUT_ALIASES)
    latency_col = _match_col(cols, _LATENCY_ALIASES)

    out = pd.DataFrame()

    # task_id
    if task_col:
        out["task_id"] = df[task_col].astype(str)
    else:
        out["task_id"] = [f"row_{i+1}" for i in range(len(df))]

    # input
    if input_col:
        out["input"] = df[input_col].fillna("").astype(str)
    else:
        out["input"] = ""

    # output
    if output_col:
        out["output"] = df[output_col].fillna("").astype(str)
    else:
        out["output"] = ""

    # latency
    if latency_col:
        out["latency"] = pd.to_numeric(df[latency_col], errors="coerce").fillna(0.0)
    else:
        out["latency"] = 0.0

    # extra columns — everything not mapped to core schema
    used_cols = {c for c in [task_col, input_col, output_col, latency_col] if c}
    extra_cols = [c for c in cols if c not in used_cols]
    for ec in extra_cols:
        out[ec] = df[ec]

    # Strip NUL bytes (PostgreSQL rejects them)
    for col in out.select_dtypes(include="object").columns:
        out[col] = out[col].apply(
            lambda v: v.replace("\x00", "") if isinstance(v, str) else v
        )

    return out


# ── Format parsers ────────────────────────────────────────────────────────────

def _parse_sql_dump(content: bytes) -> pd.DataFrame:
    """
    Extract INSERT statements from a SQL dump and return as DataFrame.
    Handles standard PostgreSQL / MySQL INSERT INTO ... VALUES (...) dumps.
    """
    text = content.decode("utf-8", errors="replace")

    # Find the first INSERT statement to detect table + columns
    insert_re = re.compile(
        r"INSERT\s+INTO\s+\S+\s*\(([^)]+)\)\s*VALUES\s*(.+?)(?:;|$)",
        re.IGNORECASE | re.DOTALL,
    )
    matches = insert_re.findall(text)
    if not matches:
        raise ValueError("No INSERT INTO … VALUES statements found in SQL file.")

    # Use first match to get column names
    col_str = matches[0][0]
    columns = [c.strip().strip('"').strip("`").strip("'") for c in col_str.split(",")]

    rows: List[List[Any]] = []
    value_re = re.compile(r"\(([^)]+)\)")
    for _, vals_block in matches:
        for val_match in value_re.finditer(vals_block):
            raw_vals = val_match.group(1)
            # Simple CSV-like split respecting single-quoted strings
            vals = []
            for token in re.split(r",(?=(?:[^']*'[^']*')*[^']*$)", raw_vals):
                token = token.strip()
                if token.upper() in ("NULL", "null"):
                    vals.append(None)
                elif token.startswith("'") and token.endswith("'"):
                    vals.append(token[1:-1].replace("''", "'"))
                else:
                    try:
                        vals.append(float(token) if "." in token else int(token))
                    except ValueError:
                        vals.append(token)
            if len(vals) == len(columns):
                rows.append(vals)

    if not rows:
        raise ValueError("Could not parse any rows from SQL INSERT statements.")

    return pd.DataFrame(rows, columns=columns)


def parse_any_format(filename: str, content: bytes) -> pd.DataFrame:
    """
    Parse any supported file format into a raw DataFrame.
    Supported: CSV, TSV, JSON (list/dict), XLSX, XLS, SQL dump, Parquet.
    """
    fname = filename.lower().strip()

    # ── Excel ─────────────────────────────────────────────────────────────────
    if fname.endswith((".xlsx", ".xls")):
        df = pd.read_excel(io.BytesIO(content), engine="openpyxl" if fname.endswith(".xlsx") else None)
        return df

    # ── Parquet ───────────────────────────────────────────────────────────────
    if fname.endswith(".parquet"):
        return pd.read_parquet(io.BytesIO(content))

    # ── SQL dump ──────────────────────────────────────────────────────────────
    if fname.endswith(".sql"):
        return _parse_sql_dump(content)

    # ── JSON ──────────────────────────────────────────────────────────────────
    if fname.endswith(".json") or fname.endswith(".jsonl") or fname.endswith(".ndjson"):
        text = content.decode("utf-8", errors="replace").strip()
        # JSONL / NDJSON
        if fname.endswith((".jsonl", ".ndjson")) or "\n" in text and text[0] != "[":
            lines = [l.strip() for l in text.splitlines() if l.strip()]
            try:
                records = [json.loads(l) for l in lines]
                return pd.DataFrame(records)
            except Exception:
                pass
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return pd.DataFrame(parsed)
        elif isinstance(parsed, dict):
            # Try records key
            for key in ("data", "records", "rows", "logs", "results", "items"):
                if key in parsed and isinstance(parsed[key], list):
                    return pd.DataFrame(parsed[key])
            return pd.json_normalize(parsed)
        raise ValueError("JSON must be a list of objects or a dict with a records key.")

    # ── TSV ───────────────────────────────────────────────────────────────────
    if fname.endswith(".tsv") or fname.endswith(".txt"):
        try:
            return pd.read_csv(io.BytesIO(content), sep="\t")
        except Exception:
            return pd.read_csv(io.BytesIO(content))

    # ── CSV (default) ─────────────────────────────────────────────────────────
    try:
        return pd.read_csv(io.BytesIO(content))
    except UnicodeDecodeError:
        return pd.read_csv(io.BytesIO(content), encoding="latin-1")


# ── Main entry point ──────────────────────────────────────────────────────────

def ingest_logs_to_postgres(
    filename:   str,
    content:    bytes,
    ai_name:    str,
    owner_id:   str,
    scan_id:    str,
    merge:      bool = False,
) -> Dict[str, Any]:
    """
    Parse + normalise + persist all log rows to probe_logs (Postgres).

    Returns a summary dict compatible with run_sdcc_pipeline output:
        logs_ingested, column_names, has_input_col, has_output_col,
        has_task_id_col, has_latency_col, schema_complete,
        column_warnings, sample_records (first 10 rows for UI preview only)
    """
    from app.database import probe_logs_collection, uploaded_logs_collection, ai_collection

    try:
        _ai_doc = ai_collection.find_one({"name": ai_name, "owner_id": owner_id})
        _ai_system_id = str(_ai_doc["id"]) if _ai_doc and _ai_doc.get("id") else None
    except Exception:
        _ai_system_id = None

    # 1. Parse raw file
    raw_df = parse_any_format(filename, content)
    logger.info("[ingest] Parsed %d rows from %s", len(raw_df), filename)

    # 2. Normalise to standard schema
    df = _normalise_df(raw_df)

    # 3. Detect which core columns were found
    raw_cols = [c.strip().lower().replace(" ", "_").replace("-", "_") for c in raw_df.columns]
    has_task_id  = bool(_match_col(raw_cols, _TASK_ID_ALIASES))
    has_input    = bool(_match_col(raw_cols, _INPUT_ALIASES))
    has_output   = bool(_match_col(raw_cols, _OUTPUT_ALIASES))
    has_latency  = bool(_match_col(raw_cols, _LATENCY_ALIASES))

    warnings: List[str] = []
    if not has_task_id:
        warnings.append("No task_id column found — auto-generated sequential IDs used.")
    if not has_input:
        warnings.append("No input/prompt column found — input field will be empty.")
    if not has_output:
        warnings.append("No output/response column found — output field will be empty.")
    if not has_latency:
        warnings.append("No latency column found — latency set to 0.")

    # 4. If merge mode, get existing task_ids to skip duplicates
    existing_task_ids: set = set()
    if merge:
        from app.database import probe_logs_collection
        existing_rows = probe_logs_collection.find(
            {"ai_name": ai_name, "owner_id": owner_id, "log_type": "uploaded_log"}
        )
        existing_task_ids = {r.get("task_id") for r in existing_rows}

    # 5. Persist each row to probe_logs
    extra_cols = [c for c in df.columns if c not in {"task_id", "input", "output", "latency"}]
    saved = 0
    skipped_dup = 0

    for _, row in df.iterrows():
        task_id = str(row["task_id"])
        if merge and task_id in existing_task_ids:
            skipped_dup += 1
            continue

        extra_payload = {}
        for ec in extra_cols:
            v = row.get(ec)
            if v is not None and not (isinstance(v, float) and pd.isna(v)):
                extra_payload[ec] = v if not isinstance(v, float) else float(v)

        try:
            probe_logs_collection.insert_one({
                "audit_id":   scan_id,
                "ai_name":    ai_name,
                "log_type":   "uploaded_log",
                "mode":       "ingested",
                "task_id":    task_id,
                "input":      str(row["input"]),
                "output":     str(row["output"]),
                "latency_ms": float(row["latency"]),
                "extra":      {"owner_id": owner_id, **extra_payload},
                "created_at": datetime.now(timezone.utc),
            })
            saved += 1
        except Exception as exc:
            logger.warning("[ingest] Row %s skipped: %s", task_id, exc)
            continue

        # New typed table: proper owner_id column + ai_system_id FK instead of
        # owner_id hidden inside the extra JSONB blob above. latency_ms stays
        # a first-class field here too (0 when the source file had none).
        try:
            uploaded_logs_collection.insert_one({
                "ai_system_id": _ai_system_id,
                "ai_name":      ai_name,
                "owner_id":     owner_id,
                "task_id":      task_id,
                "input":        str(row["input"]),
                "output":       str(row["output"]),
                "latency_ms":   float(row["latency"]),
                "extra":        extra_payload,
                "created_at":   datetime.now(timezone.utc),
            })
        except Exception as exc:
            logger.warning("[ingest] Row %s skipped in uploaded_logs: %s", task_id, exc)

    logger.info(
        "[ingest] %d/%d rows saved to probe_logs (ai=%s, dupes_skipped=%d)",
        saved, len(df), ai_name, skipped_dup,
    )

    # 6. Return summary (sample_records = first 10 for UI preview only)
    sample = df.head(10).where(pd.notnull(df.head(10)), None).to_dict(orient="records")

    return {
        "logs_ingested":   saved,
        "total_parsed":    len(df),
        "dupes_skipped":   skipped_dup,
        "has_task_id_col": has_task_id,
        "has_input_col":   has_input,
        "has_output_col":  has_output,
        "has_latency_col": has_latency,
        "schema_complete": has_input and has_output,
        "column_names":    list(raw_df.columns),
        "column_warnings": warnings,
        "sample_records":  sample,   # UI preview only — NOT the source of truth
        "source_file":     filename,
    }


def fetch_logs_from_postgres(
    ai_name:  str,
    owner_id: str,
    log_type: str = "uploaded_log",
    limit:    int = 5000,
) -> pd.DataFrame:
    """
    Read normalised log rows from probe_logs for a given AI system.
    This is what the evaluate pipeline uses instead of sample_records JSONB.
    """
    from app.database import probe_logs_collection

    query: dict = {"ai_name": ai_name, "owner_id": owner_id}
    if log_type:
        query["log_type"] = log_type

    rows = probe_logs_collection.find(query, sort=[("created_at", -1)], limit=limit)

    if not rows:
        return pd.DataFrame()

    records = []
    for r in rows:
        extra = r.get("extra") or {}
        if isinstance(extra, str):
            try:
                extra = json.loads(extra)
            except Exception:
                extra = {}
        rec = {
            "task_id":  r.get("task_id"),
            "input":    r.get("input")    or "",
            "output":   r.get("output")   or "",
            "latency":  r.get("latency_ms") or 0.0,
        }
        # Merge extra columns back in (e.g. knowledgebase, context, labels)
        for k, v in extra.items():
            if k != "owner_id":
                rec[k] = v
        records.append(rec)

    return pd.DataFrame(records)