"""
app/services/taf/excel_export.py
==================================
Builds the downloadable TAF workbook used by GET /taf/export/{ai_name}.

Sheet 1 "Reference Taxonomy" — the static KPMG TAF control mapping.
Sheet 2 "Model Assessment"   — this AI system's live, per-control status.

Uses openpyxl only (pure Python, no compiled deps) — safe for an offline,
tools-light environment.
"""
from __future__ import annotations

import io
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

from app.services.taf.taxonomy_mapper import TAXONOMY

_HEADER_FILL = PatternFill(start_color="00338D", end_color="00338D", fill_type="solid")
_HEADER_FONT = Font(color="FFFFFF", bold=True)


def _write_header(ws, headers: list[str]) -> None:
    for col, title in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col, value=title)
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = Alignment(vertical="center", wrap_text=True)
    ws.freeze_panes = "A2"


def _autosize(ws, widths: list[int]) -> None:
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def build_taf_workbook(ai_name: str, mapping: dict[str, Any], audit_run: bool = False) -> Workbook:
    wb = Workbook()

    # ── Sheet 1: Reference Taxonomy (static) ────────────────────────────
    ref = wb.active
    ref.title = "Reference Taxonomy"
    headers = ["ID", "Category", "Category (full)", "Pillar", "Risk", "Mapped", "Test / Control"]
    _write_header(ref, headers)
    for r, row in enumerate(TAXONOMY, start=2):
        ref.cell(row=r, column=1, value=row.get("numbered_id"))
        ref.cell(row=r, column=2, value=row.get("category"))
        ref.cell(row=r, column=3, value=row.get("category_full"))
        ref.cell(row=r, column=4, value=row.get("pillar"))
        ref.cell(row=r, column=5, value=row.get("risk"))
        ref.cell(row=r, column=6, value=row.get("mapped"))
        ref.cell(row=r, column=7, value=row.get("test") or row.get("description") or "")
    _autosize(ref, [10, 12, 24, 16, 10, 12, 60])

    # ── Sheet 2: Model Assessment (live / this AI system) ───────────────
    ma = wb.create_sheet("Model Assessment")
    headers2 = ["ID", "Category", "Pillar", "Risk", "Status", "Score", "Evidence / Reason"]
    _write_header(ma, headers2)

    rows = mapping.get("rows") or []
    for r, row in enumerate(rows, start=2):
        status = row.get("computed_status") or row.get("status") or "Not Covered"
        score = row.get("score")
        evidence = row.get("evidence") or (
            "Audit not yet run for this AI system." if not audit_run else "No evidence recorded."
        )
        ma.cell(row=r, column=1, value=row.get("numbered_id"))
        ma.cell(row=r, column=2, value=row.get("category"))
        ma.cell(row=r, column=3, value=row.get("pillar"))
        ma.cell(row=r, column=4, value=row.get("risk"))
        ma.cell(row=r, column=5, value=status)
        ma.cell(row=r, column=6, value=score if score is not None else "")
        ma.cell(row=r, column=7, value=str(evidence)[:500])
    _autosize(ma, [10, 12, 16, 10, 14, 8, 70])

    # ── Sheet 3: Summary ─────────────────────────────────────────────────
    summary = mapping.get("summary") or {}
    sm = wb.create_sheet("Summary")
    sm.cell(row=1, column=1, value="AI System").font = Font(bold=True)
    sm.cell(row=1, column=2, value=ai_name)
    sm.cell(row=2, column=1, value="Audit run").font = Font(bold=True)
    sm.cell(row=2, column=2, value="Yes" if audit_run else "No")
    r = 4
    for k, v in summary.items():
        sm.cell(row=r, column=1, value=str(k).replace("_", " ").title()).font = Font(bold=True)
        sm.cell(row=r, column=2, value=v)
        r += 1
    _autosize(sm, [22, 20])

    return wb


def workbook_to_bytes(wb: Workbook) -> bytes:
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
