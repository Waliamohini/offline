"""
storage_client.py — File storage factory for TrustShield-AI.

Switch provider by setting STORAGE_PROVIDER in .env — zero code changes.

  STORAGE_PROVIDER=local       → files land under LOCAL_STORAGE_PATH on disk
  STORAGE_PROVIDER=azure_blob  → files land in Azure Blob Storage

Currently used for knowledge-base document uploads, which are TRANSIENT —
see app/services/kb_lifecycle.py for the 24h auto-expiry that deletes what
this module writes. This client itself has no opinion on lifecycle; it just
moves bytes in and out of whichever backend is configured.

Mirrors the shape of app/services/llm_client.py: one factory function, a
thin common interface, lazy-imported provider-specific SDK so a
`local`-only deployment never needs azure-storage-blob installed at all.
"""
from __future__ import annotations

import logging
import re
import uuid
from functools import lru_cache
from pathlib import Path

from app.config.settings import settings

logger = logging.getLogger(__name__)


def _safe_blob_name(original_filename: str) -> str:
    """
    UUID-prefixed, sanitized blob name — prevents filename collisions
    between different users' uploads (two people can both upload
    "notes.pdf") and strips path-separator characters so a crafted
    filename can never escape the intended container/folder.
    """
    cleaned = re.sub(r"[^\w.\-]", "_", original_filename.strip())[-150:] or "file"
    return f"{uuid.uuid4().hex}_{cleaned}"


class LocalStorageClient:
    """STORAGE_PROVIDER=local — files under LOCAL_STORAGE_PATH/<container>/."""

    def __init__(self, base_path: str):
        self.base_path = Path(base_path)

    def _path(self, container: str, blob_name: str) -> Path:
        return self.base_path / container / blob_name

    def upload(self, container: str, content: bytes, original_filename: str) -> str:
        blob_name = _safe_blob_name(original_filename)
        p = self._path(container, blob_name)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(content)
        return blob_name

    def download(self, container: str, blob_name: str) -> bytes:
        return self._path(container, blob_name).read_bytes()

    def delete(self, container: str, blob_name: str) -> None:
        p = self._path(container, blob_name)
        try:
            p.unlink(missing_ok=True)
        except Exception as e:
            logger.warning("[storage_client] local delete failed for %s/%s: %s", container, blob_name, e)


class AzureBlobStorageClient:
    """STORAGE_PROVIDER=azure_blob — files in an Azure Storage Account."""

    def __init__(self, connection_string: str):
        from azure.storage.blob import BlobServiceClient  # lazy import
        self._service = BlobServiceClient.from_connection_string(connection_string)
        self._ensured_containers: set[str] = set()

    def _container(self, container: str):
        if container not in self._ensured_containers:
            client = self._service.get_container_client(container)
            try:
                client.create_container()
            except Exception:
                pass  # already exists — fine, this is just idempotent setup
            self._ensured_containers.add(container)
        return self._service.get_container_client(container)

    def upload(self, container: str, content: bytes, original_filename: str) -> str:
        blob_name = _safe_blob_name(original_filename)
        self._container(container).upload_blob(name=blob_name, data=content, overwrite=True)
        return blob_name

    def download(self, container: str, blob_name: str) -> bytes:
        return self._container(container).download_blob(blob_name).readall()

    def delete(self, container: str, blob_name: str) -> None:
        try:
            self._container(container).delete_blob(blob_name)
        except Exception as e:
            logger.warning("[storage_client] azure delete failed for %s/%s: %s", container, blob_name, e)


@lru_cache(maxsize=1)
def get_storage_client():
    """
    Return a cached storage client for the active STORAGE_PROVIDER.
    Raises RuntimeError with a clear message if azure_blob is selected but
    not actually configured — callers should catch this and degrade
    gracefully (see kb_lifecycle.py) rather than let uploads hard-fail.
    """
    if settings.STORAGE_PROVIDER == "azure_blob":
        if not settings.AZURE_STORAGE_CONNECTION_STRING:
            raise RuntimeError(
                "STORAGE_PROVIDER=azure_blob but AZURE_STORAGE_CONNECTION_STRING "
                "is not set. Add it to backend/.env"
            )
        return AzureBlobStorageClient(settings.AZURE_STORAGE_CONNECTION_STRING)
    return LocalStorageClient(settings.LOCAL_STORAGE_PATH)


def is_storage_configured() -> bool:
    """True if the active STORAGE_PROVIDER has what it needs to actually work."""
    if settings.STORAGE_PROVIDER == "azure_blob":
        return bool(settings.AZURE_STORAGE_CONNECTION_STRING)
    return True  # local disk is always available
