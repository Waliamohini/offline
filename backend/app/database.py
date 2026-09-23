"""
app/database.py
================
JSON-file storage layer (replaces PostgreSQL/SQLAlchemy).

Each "collection" is a single JSON file under DATA_DIR (backend/data/ by
default), holding a JSON array of plain dicts — no schema, no server, no
Postgres install required. This keeps the exact same public API the rest
of the app already depends on, so no route or service code needed to
change (except a handful of spots that used raw SQL directly instead of
going through the collection shim — see the "Not table-shaped" note below
for which files those were and how they were rewritten).

Exposes the same names as before:
  users_collection, ai_collection, sdcc_collection, reports_collection,
  audit_results_collection, blackbox_collection, probe_logs_collection,
  taf_assessments_collection, audit_evidence_collection,
  training_uploads_collection, uploaded_logs_collection,
  probe_run_logs_collection, chat_logs_collection,
  report_principle_scores_collection, report_sub_parameters_collection,
  report_findings_collection, report_framework_compliance_collection,
  report_framework_principle_scores_collection,
  report_model_metrics_collection, report_taxonomy_controls_collection,
  llm_judge_row_verdicts_collection, llm_judge_votes_collection,
  knowledge_base_chunks_collection, db (dict-style access by name),
  init_db()

JsonCollection supports exactly the subset of the MongoDB Collection API
this app actually uses — find, find_one, insert_one, update_one ($set /
$inc, with upsert), delete_many, count_documents — with plain equality
filtering (the previous Postgres-backed shim never supported $gt/$in/etc.
either, so this is not a regression). find/find_one accept `sort`
([(field, direction), ...], -1 = descending) and `limit`; find also
accepts `skip` for pagination (a couple of call sites need real OFFSET
support that the old shim never had — see ai_routes.py's log-viewer route).

Not table-shaped: a few files bypassed the collection shim and ran raw SQL
directly against Postgres for things like COUNT/OFFSET pagination and
multi-column SELECTs (ai_routes.py, blackbox_routes.py, taf_routes.py,
services/sdcc/log_normaliser.py, services/audit_evidence.py). Those were
rewritten to use the JsonCollection API with plain Python filtering
instead — there's no SQL layer left to drop down to.
"""
from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.config.settings import settings

# ── Null-byte sanitiser ──────────────────────────────────────────────────
# Kept from the Postgres version — harmless here, but some upstream LLM
# responses embed literal \x00 bytes that are best stripped regardless of
# storage backend.
def _strip_nulls(obj):
    if isinstance(obj, str):
        return obj.replace("\x00", "")
    if isinstance(obj, dict):
        return {k: _strip_nulls(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_strip_nulls(v) for v in obj]
    return obj


# ── Storage location ──────────────────────────────────────────────────────
# backend/data/ by default (one level up from this file, which lives in
# backend/app/). Override with JSON_DATA_DIR in .env if you want the data
# elsewhere (e.g. outside the repo so it doesn't get swept into git).
DATA_DIR = Path(getattr(settings, "JSON_DATA_DIR", "") or (Path(__file__).resolve().parents[1] / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Kept as a module-level name for anything that still imports it (nothing
# does anymore, but this matches the old file's habit of exposing
# DATABASE_URL at module scope) — now just informational.
DATABASE_URL: str = f"json-files://{DATA_DIR}"

# Field names that get parsed back into real datetime objects when a
# collection is loaded from disk after a process restart, so existing code
# calling `.isoformat()` on them keeps working exactly like it did with
# Postgres's real DateTime columns. Anything created fresh during the
# current process life is already a real datetime and never round-trips
# through this — see _JSONEncoder below for the write side.
_DATETIME_KEYS = {
    "created_at", "updated_at", "started_at", "completed_at", "evaluated_at",
    "last_login", "timestamp", "kb_updated_at",
}


class _JSONEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, datetime):
            return o.isoformat()
        if isinstance(o, uuid.UUID):
            return str(o)
        return super().default(o)


def _maybe_parse_dt(key: str, val: Any) -> Any:
    if isinstance(val, str) and (key in _DATETIME_KEYS or key.endswith("_at")):
        try:
            return datetime.fromisoformat(val)
        except ValueError:
            return val
    return val


_LOCKS: Dict[str, threading.Lock] = {}
_CACHE: Dict[str, List[Dict[str, Any]]] = {}


def _lock_for(name: str) -> threading.Lock:
    if name not in _LOCKS:
        _LOCKS[name] = threading.Lock()
    return _LOCKS[name]


def _file_for(name: str) -> Path:
    return DATA_DIR / f"{name}.json"


def _load(name: str) -> List[Dict[str, Any]]:
    """Load a collection into the in-process cache (once per process)."""
    if name in _CACHE:
        return _CACHE[name]
    path = _file_for(name)
    docs: List[Dict[str, Any]] = []
    if path.exists():
        try:
            raw = json.loads(path.read_text(encoding="utf-8") or "[]")
            docs = [{k: _maybe_parse_dt(k, v) for k, v in d.items()} for d in raw]
        except (json.JSONDecodeError, OSError):
            docs = []
    _CACHE[name] = docs
    return docs


def _save(name: str) -> None:
    """Atomically persist a collection's current in-memory state to disk."""
    path = _file_for(name)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(_CACHE.get(name, []), cls=_JSONEncoder, indent=2), encoding="utf-8")
    os.replace(tmp, path)  # atomic on POSIX and Windows alike


class JsonCollection:
    """File-backed stand-in for a PyMongo Collection. See module docstring."""

    def __init__(self, name: str):
        self.name = name

    # ── internal helpers ───────────────────────────────────────────────
    @staticmethod
    def _get_id(doc: Dict[str, Any]) -> Optional[str]:
        return doc.get("id") or doc.get("_id")

    @staticmethod
    def _match(doc: Dict[str, Any], filter_dict: Dict[str, Any]) -> bool:
        for k, v in filter_dict.items():
            if k == "_id":
                if JsonCollection._get_id(doc) != v:
                    return False
                continue
            if k in doc:
                if doc.get(k) != v:
                    return False
                continue
            # Some callers store a field nested inside an "extra" dict rather
            # than flat (a holdover from the Postgres JSONB-overflow design —
            # see e.g. ai_routes.py's probe_logs inserts, which nest owner_id
            # under extra). _present() flattens these on read, but filtering
            # happens on the raw stored doc, so check extra here too or a
            # filter on such a field would silently match nothing.
            extra = doc.get("extra")
            if isinstance(extra, dict) and k in extra:
                if extra.get(k) != v:
                    return False
                continue
            # Key absent from both the doc and any extra dict — no match.
            return False
        return True

    @staticmethod
    def _present(doc: Dict[str, Any]) -> Dict[str, Any]:
        """Mirror _id/id both ways, matching the old Postgres shim's contract."""
        d = dict(doc)
        _id = JsonCollection._get_id(d)
        if _id is not None:
            d.setdefault("id", _id)
            d.setdefault("_id", _id)
        # Some older callers read a nested "extra" dict directly (a leftover
        # from the Postgres JSONB-overflow design) — every field is already
        # flat here, but keep any explicitly-set "extra" dict's keys
        # available at the top level too, for exact behavioral parity.
        extra = d.get("extra")
        if isinstance(extra, dict):
            for k, v in extra.items():
                d.setdefault(k, v)
        return d

    def _sorted(self, docs: List[Dict[str, Any]], sort: Optional[List[Tuple[str, int]]]) -> List[Dict[str, Any]]:
        if not sort:
            return docs
        out = list(docs)
        for col, direction in reversed(sort):
            out.sort(key=lambda d: (d.get(col) is None, d.get(col) if d.get(col) is not None else 0),
                      reverse=(direction == -1))
        return out

    # Internal loader — lock-free, since callers already hold _lock_for(self.name)
    def _docs(self) -> List[Dict[str, Any]]:
        return _load(self.name)

    # ── public API ───────────────────────────────────────────────────────
    def find_one(
        self,
        filter_dict: Dict[str, Any] = None,
        projection: Dict[str, Any] = None,   # accepted for API parity; unused (matches old shim)
        sort: List[Tuple[str, int]] = None,
    ) -> Optional[Dict[str, Any]]:
        filter_dict = filter_dict or {}
        with _lock_for(self.name):
            matches = [d for d in self._docs() if self._match(d, filter_dict)]
            matches = self._sorted(matches, sort)
        return self._present(matches[0]) if matches else None

    def find(
        self,
        filter_dict: Dict[str, Any] = None,
        projection: Dict[str, Any] = None,   # accepted for API parity; unused
        sort: List[Tuple[str, int]] = None,
        limit: int = 0,
        skip: int = 0,
    ) -> List[Dict[str, Any]]:
        filter_dict = filter_dict or {}
        with _lock_for(self.name):
            matches = [d for d in self._docs() if self._match(d, filter_dict)]
            matches = self._sorted(matches, sort)
        if skip:
            matches = matches[skip:]
        if limit:
            matches = matches[:limit]
        return [self._present(d) for d in matches]

    def insert_one(self, doc: Dict[str, Any]) -> Any:
        row = _strip_nulls(dict(doc))
        if "_id" in row:
            row_id = row.pop("_id")
            row.setdefault("id", row_id)
        if not row.get("id"):
            row["id"] = str(uuid.uuid4())
        row["id"] = str(row["id"])

        with _lock_for(self.name):
            docs = self._docs()
            docs.append(row)
            _save(self.name)

        class _Result:
            inserted_id = row["id"]
        return _Result()

    def update_one(
        self,
        filter_dict: Dict[str, Any],
        update_doc: Dict[str, Any],
        upsert: bool = False,
    ) -> Any:
        set_vals = _strip_nulls(update_doc.get("$set", {}) or {})
        inc_vals = update_doc.get("$inc", {}) or {}

        with _lock_for(self.name):
            docs = self._docs()
            target = next((d for d in docs if self._match(d, filter_dict)), None)

            if target is None:
                if not upsert:
                    class _R:
                        matched_count = 0
                        modified_count = 0
                    return _R()
                new_doc = {k: v for k, v in filter_dict.items() if k != "_id"}
                new_doc.update(set_vals)
                for k, v in inc_vals.items():
                    new_doc[k] = new_doc.get(k, 0) + v
                if not new_doc.get("id"):
                    new_doc["id"] = str(uuid.uuid4())
                docs.append(new_doc)
                _save(self.name)
                class _R:
                    matched_count = 1
                    modified_count = 1
                return _R()

            target.update(set_vals)
            for k, v in inc_vals.items():
                target[k] = target.get(k, 0) + v
            _save(self.name)

        class _R:
            matched_count = 1
            modified_count = 1
        return _R()

    def delete_many(self, filter_dict: Dict[str, Any]) -> Any:
        if not filter_dict:
            raise ValueError("delete_many requires a non-empty filter_dict (refusing to wipe the whole collection).")
        with _lock_for(self.name):
            docs = self._docs()
            keep = [d for d in docs if not self._match(d, filter_dict)]
            deleted = len(docs) - len(keep)
            _CACHE[self.name] = keep
            _save(self.name)

        class _R:
            deleted_count = deleted
        return _R()

    def count_documents(self, filter_dict: Dict[str, Any] = None) -> int:
        filter_dict = filter_dict or {}
        with _lock_for(self.name):
            return sum(1 for d in self._docs() if self._match(d, filter_dict))


# ── Collections (same names every route/service already imports) ─────────
users_collection              = JsonCollection("users")
ai_collection                 = JsonCollection("ai_systems")
sdcc_collection                = JsonCollection("sdcc_results")
reports_collection             = JsonCollection("reports")
audit_results_collection       = JsonCollection("report_audit_results")
blackbox_collection            = JsonCollection("blackbox_audits")
probe_logs_collection          = JsonCollection("probe_logs")
taf_assessments_collection     = JsonCollection("taf_assessments")
audit_evidence_collection      = JsonCollection("audit_evidence")
training_uploads_collection    = JsonCollection("training_uploads")
uploaded_logs_collection       = JsonCollection("uploaded_logs")
probe_run_logs_collection      = JsonCollection("probe_run_logs")
chat_logs_collection           = JsonCollection("chat_logs")

report_principle_scores_collection           = JsonCollection("report_principle_scores")
report_sub_parameters_collection             = JsonCollection("report_sub_parameters")
report_findings_collection                   = JsonCollection("report_findings")
report_framework_compliance_collection       = JsonCollection("report_framework_compliance")
report_framework_principle_scores_collection = JsonCollection("report_framework_principle_scores")
report_model_metrics_collection              = JsonCollection("report_model_metrics")
report_taxonomy_controls_collection          = JsonCollection("report_taxonomy_controls")
llm_judge_row_verdicts_collection            = JsonCollection("llm_judge_row_verdicts")
llm_judge_votes_collection                   = JsonCollection("llm_judge_votes")
knowledge_base_chunks_collection             = JsonCollection("knowledge_base_chunks")


# Alias used by blackbox_routes.py: `from app.database import db`
class _DbShim:
    """Shim so `db["collection_name"]` still works."""
    _MAP = {
        "users":                users_collection,
        "ai_systems":           ai_collection,
        "sdcc_results":         sdcc_collection,
        "reports":              reports_collection,
        "report_audit_results": audit_results_collection,
        "blackbox_audits":      blackbox_collection,
        "probe_logs":           probe_logs_collection,
        "taf_assessments":      taf_assessments_collection,
        "training_uploads":     training_uploads_collection,
        "uploaded_logs":        uploaded_logs_collection,
        "probe_run_logs":       probe_run_logs_collection,
        "chat_logs":            chat_logs_collection,
        "report_principle_scores":           report_principle_scores_collection,
        "report_sub_parameters":             report_sub_parameters_collection,
        "report_findings":                   report_findings_collection,
        "report_framework_compliance":       report_framework_compliance_collection,
        "report_framework_principle_scores": report_framework_principle_scores_collection,
        "report_model_metrics":              report_model_metrics_collection,
        "report_taxonomy_controls":          report_taxonomy_controls_collection,
        "llm_judge_row_verdicts":            llm_judge_row_verdicts_collection,
        "llm_judge_votes":                   llm_judge_votes_collection,
        "knowledge_base_chunks":             knowledge_base_chunks_collection,
    }

    def __getitem__(self, name: str) -> JsonCollection:
        if name not in self._MAP:
            raise KeyError(
                f"Collection '{name}' not mapped in JsonCollection shim. "
                f"Add it to database.py _DbShim._MAP."
            )
        return self._MAP[name]


db = _DbShim()


def init_db() -> None:
    """
    No schema to create — just make sure every collection's JSON file
    exists on disk so a fresh checkout has something to look at under
    DATA_DIR even before the first insert.
    """
    for name in _DbShim._MAP:
        _load(name)
        if not _file_for(name).exists():
            _save(name)


# Initialise on import (mirrors the old Postgres file's behavior)
init_db()
