"""
Finding Classifier — pure functions for classifying individual audit findings
across runs using stable, probe-ID-independent Finding_IDs.

Requirements: 6.1, 6.2, 6.3, 6.4
"""

from __future__ import annotations

import hashlib


def compute_finding_id(principle: str, failure_type: str, category_tag: str) -> str:
    """Compute a stable, deterministic Finding_ID for a finding.

    The ID is computed as the first 16 hex characters of the SHA-256 hash of
    the concatenated string ``principle + failure_type + category_tag``.  The
    ``probe_id`` is intentionally excluded so that the same governance gap
    (same principle + severity + note text) always produces the same ID across
    runs, regardless of which probe triggered it.

    Args:
        principle: The KPMG principle (maps to finding ``category`` field).
        failure_type: The severity/failure type (maps to finding ``severity``).
        category_tag: A short descriptor for the finding (first 80 chars of
                      finding ``note`` or ``issue`` field).

    Returns:
        A 16-character lowercase hex string derived from SHA-256.
    """
    raw = principle + failure_type + category_tag
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return digest[:16]


def classify_findings(
    prior_findings: list[dict],
    current_findings: list[dict],
) -> tuple[list[dict], list[dict], list[dict]]:
    """Classify current and prior findings as resolved, persisting, or new.

    For each finding the Finding_ID is derived using:
    - ``category``  → principle
    - ``severity``  → failure_type
    - first 80 chars of ``note`` (or ``issue`` if ``note`` is absent) → category_tag

    Each finding dict is tagged in-place with ``finding_id`` and ``status``
    fields before being placed in the appropriate output list.

    Edge cases:
    - Empty ``prior_findings``: all current findings are ``new``; resolved and
      persisting lists are empty.
    - Empty ``current_findings``: all prior findings are ``resolved``; new and
      persisting lists are empty.

    Args:
        prior_findings: List of finding dicts from the prior audit.
        current_findings: List of finding dicts from the current audit run.

    Returns:
        A three-tuple ``(resolved_findings, persisting_findings, new_findings)``
        where each element is a list of finding dicts (with ``finding_id`` and
        ``status`` fields added).
    """

    def _finding_id(finding: dict) -> str:
        principle = finding.get("category", "")
        failure_type = finding.get("severity", "")
        note_text = finding.get("note") or finding.get("issue") or ""
        category_tag = note_text[:80]
        return compute_finding_id(principle, failure_type, category_tag)

    # Build a set of Finding_IDs from the prior run for O(1) lookup
    prior_id_set: set[str] = set()
    tagged_prior: list[dict] = []
    for finding in prior_findings:
        fid = _finding_id(finding)
        tagged = dict(finding)
        tagged["finding_id"] = fid
        tagged["status"] = "resolved"  # default; may be overridden below
        prior_id_set.add(fid)
        tagged_prior.append(tagged)

    # Classify each current finding
    persisting_findings: list[dict] = []
    new_findings: list[dict] = []

    current_id_set: set[str] = set()
    for finding in current_findings:
        fid = _finding_id(finding)
        tagged = dict(finding)
        tagged["finding_id"] = fid
        current_id_set.add(fid)

        if fid in prior_id_set:
            tagged["status"] = "persisting"
            persisting_findings.append(tagged)
        else:
            tagged["status"] = "new"
            new_findings.append(tagged)

    # Resolved = prior findings whose ID does not appear in the current run
    resolved_findings: list[dict] = [
        f for f in tagged_prior if f["finding_id"] not in current_id_set
    ]

    return resolved_findings, persisting_findings, new_findings
