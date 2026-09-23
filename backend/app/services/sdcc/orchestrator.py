"""
services/sdcc/orchestrator.py
==============================
SDCC (Structural Data Completeness Check) pipeline entry point.

UPDATED SCHEMA (v2)
--------------------
Required columns (minimal input):
  task_id   — unique identifier for each inference row
  input     — the user prompt / question sent to the AI
  output    — the AI system's response
  latency   — response time in milliseconds (numeric)

Optional:
  knowledgebase / context / chunks — KB text for judge-grounded evaluation

Duplicate detection: rows are duplicates only if task_id is non-unique.
"""

from __future__ import annotations
import json
import uuid
from datetime import datetime

import pandas as pd
from fastapi import UploadFile

from app.services.sdcc.detector import detect_model_type


# ── Supported document formats for direct document upload ────────────────────
_DOCUMENT_EXTENSIONS = {".txt", ".md", ".pdf", ".docx"}
_LOG_EXTENSIONS      = {".csv", ".json", ".jsonl", ".ndjson", ".xlsx", ".xls", ".tsv", ".txt", ".sql", ".parquet"}


def is_document_upload(filename: str) -> bool:
    """Return True if this is a raw document upload (not a CSV/JSON log)."""
    lower = (filename or "").lower()
    return any(lower.endswith(ext) for ext in _DOCUMENT_EXTENSIONS)


def parse_upload(file: UploadFile) -> pd.DataFrame:
    """
    Parse an uploaded file into a normalised DataFrame.

    Supported formats:
      CSV / JSON  → log format: each row = one inference record
                    Required columns: task_id, input, output, latency
      TXT / MD / PDF / DOCX → treated as knowledge-base documents;
                    produces a single-row DataFrame with _document_mode=True
    """
    filename = (file.filename or "").lower()
    content  = file.file.read()

    # ── Raw document / KB upload ──────────────────────────────────────────────
    if is_document_upload(filename):
        from app.services.sdcc.models.summarization import SummarizationEvaluator
        try:
            text = SummarizationEvaluator.extract_text_from_document(content, filename)
        except ValueError as e:
            raise ValueError(str(e))

        if not text or not text.strip():
            raise ValueError(
                f"Could not extract any text from '{filename}'. "
                "Ensure the document is not empty or password-protected."
            )

        words      = text.split()
        chunk_size = 500
        chunks     = [" ".join(words[i:i+chunk_size])
                      for i in range(0, len(words), chunk_size)
                      if " ".join(words[i:i+chunk_size]).strip()]
        if not chunks:
            chunks = [text]

        df = pd.DataFrame({"source": chunks})
        df["_document_mode"] = True
        return df

    # ── CSV / JSON log upload ─────────────────────────────────────────────────
    import io
    if filename.endswith(".json"):
        content_str = content.decode("utf-8", errors="replace")
        import json as _json
        parsed = _json.loads(content_str)
        if isinstance(parsed, list):
            df = pd.DataFrame(parsed)
        elif isinstance(parsed, dict):
            df = pd.json_normalize(parsed)
        else:
            raise ValueError("JSON must be a list of objects or a dict.")
    else:
        df = pd.read_csv(io.BytesIO(content))

    # Normalise column names: lowercase, strip, underscores
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    return df


# ── Data quality ──────────────────────────────────────────────────────────────

def compute_data_quality(df: pd.DataFrame) -> dict:
    total = df.size
    missing = df.isna().sum().sum()
    missing_ratio = float(missing / total) if total > 0 else 0.0

    # ── Duplicate detection ────────────────────────────────────────────────────
    task_id_col = _find_task_id_col(df)
    if task_id_col:
        duplicates = int(df[task_id_col].duplicated().sum())
    else:
        duplicates = int(df.duplicated().sum())

    # ── Column coverage penalty ────────────────────────────────────────────────
    # Check for the 4 key columns: task_id, input, output, latency
    # Each missing column deducts from the score so auto-generated CSVs
    # with all columns present still score well, but real-world logs with
    # missing columns are penalised accurately.
    schema_result = validate_schema(df)
    key_cols_present = sum([
        schema_result["has_task_id"],
        schema_result["has_input"],
        schema_result["has_output"],
        schema_result["has_latency"],
    ])
    column_coverage = key_cols_present / 4.0  # 0.25 per column

    # ── Duplicate penalty ──────────────────────────────────────────────────────
    dup_ratio = duplicates / max(len(df), 1)
    dup_penalty = min(dup_ratio * 20, 15)  # max 15 point deduction

    # ── Final score ────────────────────────────────────────────────────────────
    # Completeness (no missing values): 50 pts
    # Column coverage (right columns present): 35 pts
    # Duplicate cleanliness: 15 pts
    completeness_score  = (1 - missing_ratio) * 50
    coverage_score      = column_coverage * 35
    duplicate_score     = 15 - dup_penalty
    dq_score = min(int(completeness_score + coverage_score + duplicate_score), 100)

    schema_conf = 1.0 - (missing_ratio * 0.5)

    text_cols = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    num_cols  = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]

    return {
        "missing_ratio":      round(missing_ratio, 4),
        "duplicates":         duplicates,
        "duplicate_basis":    "task_id" if task_id_col else "row",
        "schema_confidence":  round(schema_conf, 3),
        "data_quality_score": dq_score,
        "column_coverage":    round(column_coverage, 2),
        "key_cols_present":   key_cols_present,
        "total_columns":      len(df.columns),
        "text_columns":       len(text_cols),
        "numeric_columns":    len(num_cols),
        "column_names":       list(df.columns),
    }


def _find_task_id_col(df: pd.DataFrame):
    """Find task_id / uid / id column (case-insensitive)."""
    for col in df.columns:
        cl = col.lower()
        if any(k in cl for k in ("task_id", "taskid", "uid", "unique_id", "id")):
            return col
    return None


def _structural_risk(dq_score: int) -> str:
    if dq_score >= 85: return "Low"
    if dq_score >= 65: return "Moderate"
    return "High"


def _recommendation(dq_score: int, logs_count: int, model_type: str) -> str:
    if logs_count < 30:
        return (
            f"Dataset too small ({logs_count} records) for reliable {model_type} evaluation. "
            "Aim for ≥ 100 records; 500+ recommended."
        )
    if dq_score < 60:
        return (
            "Significant data quality issues detected. Resolve missing values and duplicates "
            "before running a governance audit."
        )
    if dq_score < 80:
        return (
            f"Dataset is usable for {model_type} evaluation but has moderate quality issues. "
            "Ensure task_id, input, output, and latency columns are present for full coverage."
        )
    return f"Dataset structurally suitable for a comprehensive {model_type} Trusted AI evaluation."


# ── Column validation ─────────────────────────────────────────────────────────

def validate_schema(df: pd.DataFrame) -> dict:
    """
    Validate the new minimal required schema:
      task_id, input, output, latency
    Returns presence flags and warnings.
    """
    cols_lower = {c.lower(): c for c in df.columns}

    def _has(*candidates):
        return any(any(cand in cl for cand in candidates) for cl in cols_lower)

    has_task_id = _has("task_id", "taskid", "uid", "unique_id")
    has_input   = _has("input", "prompt", "query", "question", "instruction")
    has_output  = _has("output", "response", "answer", "completion", "result")
    has_latency = _has("latency", "duration", "response_time", "elapsed", "ms")
    has_kb      = _has("knowledgebase", "knowledge_base", "context", "chunks",
                       "retrieved", "passages", "source_doc", "kb")

    warnings = []
    if not has_task_id:
        warnings.append(
            "No 'task_id' column found. Add a unique identifier column (task_id/uid) "
            "to enable accurate duplicate detection."
        )
    if not has_input:
        warnings.append(
            "No 'input' column found. Rename your prompt/query column to 'input' "
            "for accurate metric computation."
        )
    if not has_output:
        warnings.append(
            "No 'output' column found. Rename your response/answer column to 'output' "
            "for accurate metric computation."
        )
    if not has_latency:
        warnings.append(
            "No 'latency' column found. Add a latency/response_time column (in ms) "
            "to enable latency-based metrics."
        )

    return {
        "has_task_id": has_task_id,
        "has_input":   has_input,
        "has_output":  has_output,
        "has_latency": has_latency,
        "has_kb":      has_kb,
        "warnings":    warnings,
        "schema_complete": has_task_id and has_input and has_output and has_latency,
    }


# ── Main entry point ──────────────────────────────────────────────────────────

def run_sdcc_pipeline(
      ai_name: str,
      file: UploadFile,
      current_user: dict,
      ai_description: str = "",
      ai_domain: str = "",
  ) -> dict:
    df = parse_upload(file)

    # ── Detect document_mode ─────────────────────────────────────────────────
    document_mode = bool(
        df.get("_document_mode", pd.Series([False])).any()
        if "_document_mode" in df.columns else False
    )
    if document_mode:
        df_clean             = df.drop(columns=["_document_mode"])
        model_type           = "summarization"
        detection_confidence = 0.95
    else:
        df_clean = df
        model_type, detection_confidence = detect_model_type(
                   df_clean,
                   ai_description=ai_description,
                   ai_domain=ai_domain,
               )

    quality      = compute_data_quality(df_clean)
    schema_check = validate_schema(df_clean)

    result = {
        "scan_id":              str(uuid.uuid4()),
        "timestamp":            datetime.utcnow().isoformat(),
        "model_type":           model_type,
        "detection_confidence": detection_confidence,
        "document_mode":        document_mode,
        "logs_ingested":        len(df_clean),
        "data_quality_score":   quality["data_quality_score"],
        "structural_risk":      _structural_risk(quality["data_quality_score"]),
        "diagnostics": {
            "missing_ratio":      quality["missing_ratio"],
            "duplicates":         quality["duplicates"],
            "duplicate_basis":    quality["duplicate_basis"],
            "schema_confidence":  quality["schema_confidence"],
            "total_columns":      quality["total_columns"],
            "text_columns":       quality["text_columns"],
            "numeric_columns":    quality["numeric_columns"],
            "column_names":       quality["column_names"],
        },
        # Schema validation
        "has_task_id_col": schema_check["has_task_id"],
        "has_input_col":   schema_check["has_input"],
        "has_output_col":  schema_check["has_output"],
        "has_latency_col": schema_check["has_latency"],
        "has_kb_col":      schema_check["has_kb"],
        "schema_complete": schema_check["schema_complete"],
        "column_warnings": schema_check["warnings"],
        "recommendation": (
            f"Document uploaded and split into {len(df_clean)} chunk(s) for summarization evaluation."
            if document_mode
            else _recommendation(quality["data_quality_score"], len(df_clean), model_type)
        ),
        # Store up to 1 000 rows so /evaluate can reuse them
        "sample_records": df_clean.head(1_000).to_dict(orient="records"),
    }

    if document_mode:
        result["document_mode_note"] = (
            f"Raw document uploaded and split into {len(df_clean)} chunk(s). "
            "To evaluate generated summaries, provide them via the evaluate endpoint."
        )

    return result