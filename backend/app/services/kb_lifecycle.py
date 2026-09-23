"""
app/services/kb_lifecycle.py
=============================
Auto-expiry for uploaded knowledge-base documents.

Knowledge-base files are deliberately TRANSIENT: they exist to ground SDCC
judge evaluations for as long as you're actively working an audit (ingest →
upload KB → evaluate → ingest more logs → evaluate again — all of that keeps
the KB alive), but they are not meant to be permanent storage. If nothing
touches an AI system's knowledge base — no upload, no evaluate call — for
KB_TTL_HOURS, it's treated as expired and deleted the next time anything
looks for it.

This is checked lazily, at the point of access, rather than via a background
scheduler — same style as the rest of this codebase (e.g. lru_cache'd
clients that just get recreated on next call, no cron jobs). There is
exactly one consumption point for the KB today (POST /evaluate/{ai_name}),
plus the GET /sdcc/kb-chunks/{ai_name} preview endpoint — both should call
get_active_kb_chunks() below instead of reading sdcc_doc["kb_chunks"]
directly, so an expired KB is invisible (and gets cleaned up) everywhere
consistently.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from app.config.settings import settings

logger = logging.getLogger(__name__)


def _parse_updated_at(raw) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw) if isinstance(raw, str) else raw
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _is_expired(kb_updated_at) -> bool:
    dt = _parse_updated_at(kb_updated_at)
    if dt is None:
        return False  # no timestamp on record — nothing to expire
    return datetime.now(timezone.utc) - dt > timedelta(hours=settings.KB_TTL_HOURS)


def purge_kb(ai_name: str, owner_id: str, sdcc_doc: dict) -> None:
    """
    Delete everything for this AI system's knowledge base: uploaded blobs,
    normalized chunk rows, and the kb_* fields on the sdcc document itself.
    Best-effort on the blob side — a storage hiccup here shouldn't block
    the caller (an evaluate response, or the expiry check itself) from
    completing; it just means an orphaned blob gets cleaned up later.
    """
    from app.database import sdcc_collection, knowledge_base_chunks_collection

    blob_refs = sdcc_doc.get("kb_blob_refs") or []
    if blob_refs:
        try:
            from app.services.storage_client import get_storage_client
            client = get_storage_client()
            for ref in blob_refs:
                client.delete(ref.get("container", settings.AZURE_STORAGE_CONTAINER_KB), ref["blob_name"])
        except Exception as e:
            logger.warning("[kb_lifecycle] blob cleanup failed for %s (non-fatal): %s", ai_name, e)

    try:
        knowledge_base_chunks_collection.delete_many({"ai_name": ai_name, "owner_id": owner_id})
    except ValueError:
        pass  # nothing to delete

    sdcc_collection.update_one(
        {"ai_name": ai_name, "owner_id": owner_id},
        {"$set": {
            "kb_chunks":     [],
            "kb_files":      [],
            "kb_blob_refs":  [],
            "kb_updated_at": None,
        }},
    )
    logger.info("[kb_lifecycle] purged knowledge base for %s (owner %s)", ai_name, owner_id)


def get_active_kb_chunks(ai_name: str, owner_id: str, sdcc_doc: dict, *, refresh: bool = False) -> list[str]:
    """
    Returns sdcc_doc's kb_chunks if the KB is still within its TTL window,
    or an empty list (after purging it) if it's expired. Call sites should
    use this instead of reading sdcc_doc["kb_chunks"] directly.

    refresh=True marks this access as "activity" and resets the TTL clock —
    pass this from /evaluate (using the KB is genuine workflow progress),
    but NOT from the GET /sdcc/kb-chunks preview endpoint (merely looking
    at what's in the KB isn't activity — a frontend that polls that
    endpoint shouldn't be able to keep a stale KB alive forever).
    """
    kb_chunks = sdcc_doc.get("kb_chunks") or []
    if not kb_chunks:
        return []
    if _is_expired(sdcc_doc.get("kb_updated_at")):
        logger.info("[kb_lifecycle] KB for %s expired (>%dh inactive) — purging", ai_name, settings.KB_TTL_HOURS)
        purge_kb(ai_name, owner_id, sdcc_doc)
        return []

    if refresh:
        from app.database import sdcc_collection
        sdcc_collection.update_one(
            {"ai_name": ai_name, "owner_id": owner_id},
            {"$set": {"kb_updated_at": datetime.now(timezone.utc).isoformat()}},
        )
    return kb_chunks
