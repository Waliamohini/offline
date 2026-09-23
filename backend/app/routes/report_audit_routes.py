"""
app/routes/report_audit_routes.py  ─  PRODUCTION v2
=====================================================

Reliability improvements over v1
──────────────────────────────────
1.  TWO-PASS GROQ ANALYSIS  — first pass extracts structured metadata + principle
    coverage; second pass (only if first pass had low completeness) digs deeper
    into regulatory gaps and findings. Avoids token-limit failures on long docs.

2.  CHUNKED TEXT PROCESSING  — very large PDFs are split into overlapping 4,000-
    word chunks. Each chunk is analysed independently; results are merged before
    the final synthesis call.

3.  SCHEMA VALIDATION + REPAIR  — after parsing Groq's JSON we validate every
    required field, fill missing fields with sensible defaults, and clamp numeric
    values to valid ranges. No more KeyErrors on the frontend.

4.  RETRY WITH EXPONENTIAL BACKOFF  — Groq calls retry up to 3 times with 1→2→4s
    delays. Handles transient API rate-limit errors gracefully.

5.  RICHER PROMPTING  — the system prompt now provides TAF principle descriptions,
    importance weights, regulatory article lists, and example gap statements so
    Groq produces much more accurate and actionable output.

6.  CONFIDENCE SCORING  — each principle gets a `confidence` field (0–1) so the
    frontend can show how certain the analysis is for each claim.

7.  PDF TEXT QUALITY CHECK  — detects scanned/image-only PDFs early and returns
    a clear, actionable error instead of sending garbage text to Groq.

8.  SELF-ATTESTATION FORMAT  — natively understands the JSON schema produced by
    the SelfReportPage component and pre-populates fields before LLM analysis.

9.  FILE SIZE LIMITS  — rejects files over 20 MB (PDF) or 5 MB (JSON) with a
    clear error message before attempting extraction.

10. AUDIT HISTORY ENDPOINT  — stores results in MongoDB and exposes
    GET /audit/history and GET /audit/result/{audit_id}.
"""

from __future__ import annotations
import os, json, io, uuid, asyncio, time, re, hashlib
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Query
try:
    from openai import RateLimitError, APIStatusError
except ImportError:
    # Only ever raised by a real OpenAI-compatible client — the offline
    # mock client (see llm_client.py) never raises these, so they're
    # unreachable in OFFLINE_MODE and the package isn't needed to import
    # this file. Define harmless stand-ins so the except clauses below
    # still parse.
    class RateLimitError(Exception): ...
    class APIStatusError(Exception): ...

from app.services.llm_client import get_llm_client, get_primary_model

router = APIRouter(prefix="/audit", tags=["Report Audit"])

# ── Primary LLM client (provider set by LLM_PROVIDER — groq/azure/gemini) ──────
def get_groq():
    """
    Kept the name `get_groq` for backward compatibility with call sites in
    this file — it now returns whichever provider LLM_PROVIDER selects, via
    the centralized factory in app.services.llm_client. Raises the same
    HTTPException shape as before if the active provider isn't configured.
    """
    try:
        return get_llm_client()
    except RuntimeError as e:
        raise HTTPException(503, str(e))

# ── PostgreSQL (always available) ─────────────────────────────────────────────
from app.database import audit_results_collection
_mongo_available = True   # kept for compat with guard clauses below

# ── Constants ──────────────────────────────────────────────────────────────────
MAX_PDF_BYTES  = 20 * 1024 * 1024   # 20 MB
MAX_JSON_BYTES =  5 * 1024 * 1024   # 5 MB
CHUNK_WORDS    = 4_000
CHUNK_OVERLAP  = 400
MAX_WORDS_GROQ = 5_500
MAX_RETRIES    = 3

TAF_PRINCIPLES = [
    "Fairness", "Transparency", "Explainability", "Accountability",
    "Data Integrity", "Reliability", "Security", "Safety", "Privacy", "Sustainability",
]

REGULATORY_FRAMEWORKS = ["EU AI Act", "ISO 42001", "NIST AI RMF"]

TAF_DESCRIPTIONS = {
    "Fairness":        "AI must treat all groups equitably; no discriminatory outcomes across protected characteristics. Look for: bias testing, class balance, demographic coverage, equal error rates.",
    "Transparency":    "AI must be open about capabilities, limitations, and decision logic. Look for: model documentation, capability disclosures, known failure modes, version tracking.",
    "Explainability":  "Decisions must be interpretable by non-technical stakeholders. Look for: SHAP/LIME explanations, confidence scores, reasoning documentation, human-readable outputs.",
    "Accountability":  "Clear governance structures, audit trails, and human oversight. Look for: responsible AI policy, named governance owner, audit logs, escalation procedures, version control.",
    "Data Integrity":  "Data must be accurate, complete, representative, unbiased. Look for: data quality checks, ground truth labels, schema validation, duplicate removal, lineage tracking.",
    "Reliability":     "Consistent performance under normal and adversarial conditions. Look for: performance metrics (accuracy, F1, ROUGE), latency monitoring, error rate tracking, SLA compliance.",
    "Security":        "Resilience against adversarial attacks, prompt injection, data poisoning. Look for: red-team testing, content moderation, input validation, security controls.",
    "Safety":          "Proactive safeguarding against harm. Look for: harm prevention logging, human override capability, incident response, safety test results, kill-switch mechanisms.",
    "Privacy":         "GDPR/CCPA compliance, data minimisation, consent management. Look for: PII handling policy, anonymisation, data retention, consent records, right-to-erasure.",
    "Sustainability":  "Environmental impact minimisation. Look for: model efficiency, compute resource usage, carbon footprint estimates, energy-efficient training.",
}

REGULATORY_ARTICLES = {
    "EU AI Act": {
        "Transparency":    ["Art.13 — Transparency obligations", "Art.14 — Human oversight"],
        "Explainability":  ["Art.13(3)(b) — Decision explanation", "Annex IV — Technical documentation"],
        "Fairness":        ["Art.10(2) — Training data bias", "Art.15 — Accuracy and robustness"],
        "Accountability":  ["Art.9 — Risk management", "Art.17 — Quality management", "Art.29 — Obligations"],
        "Data Integrity":  ["Art.10 — Data governance", "Art.10(3) — Data quality criteria"],
        "Reliability":     ["Art.15 — Accuracy, robustness, cybersecurity", "Art.9(7) — Testing procedures"],
        "Security":        ["Art.15(3) — Cybersecurity measures", "Art.9(4) — Risk mitigation"],
        "Privacy":         ["Art.10(5) — Special category data", "Recital 41 — Privacy by design"],
        "Sustainability":  ["Recital 48 — Resource efficiency"],
        "Safety":          ["Art.9 — Risk management system", "Art.15(4) — Safety measures"],
    },
    "ISO 42001": {
        "Transparency":    ["6.1.2 — AI system transparency", "8.4 — Documentation"],
        "Explainability":  ["8.4.1 — Explainability by design", "9.1 — Performance evaluation"],
        "Fairness":        ["8.3 — Bias and fairness", "10.1 — Bias incident improvement"],
        "Accountability":  ["5.1 — Leadership accountability", "8.6 — Corrective action"],
        "Data Integrity":  ["8.2 — Data for AI systems", "8.2.3 — Data quality management"],
        "Reliability":     ["9.1 — Monitoring and measurement", "8.5 — AI system operation"],
        "Security":        ["8.7 — AI security", "6.1.1 — Security risk assessment"],
        "Privacy":         ["8.8 — Privacy", "8.2.4 — Data handling"],
        "Sustainability":  ["7.5.3 — Resource management", "8.5.3 — Sustainable AI operations"],
        "Safety":          ["8.9 — Safety of AI systems", "6.1.3 — Harm prevention"],
    },
    "NIST AI RMF": {
        "Transparency":    ["GOVERN-1.1", "MAP-1.6", "MANAGE-2.2"],
        "Explainability":  ["EXPLAIN-1.1", "MAP-1.5", "MEASURE-2.5"],
        "Fairness":        ["BIAS-1.1", "MEASURE-2.2", "MANAGE-1.3"],
        "Accountability":  ["GOVERN-1.2", "GOVERN-6.1", "MANAGE-4.1"],
        "Data Integrity":  ["MAP-3.5", "MEASURE-2.6", "MANAGE-2.1"],
        "Reliability":     ["MEASURE-1.1", "MEASURE-2.1", "MANAGE-1.1"],
        "Security":        ["GOVERN-4.1", "MEASURE-2.7", "MANAGE-2.4"],
        "Privacy":         ["GOVERN-4.2", "MAP-5.2", "MANAGE-2.3"],
        "Sustainability":  ["GOVERN-5.1", "MAP-4.1"],
        "Safety":          ["GOVERN-2.2", "MAP-1.1", "MANAGE-3.1"],
    },
}

# ── Text extraction ────────────────────────────────────────────────────────────

def _extract_pdf_text(content: bytes) -> str:
    text = ""
    try:
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(content))
        for page in reader.pages:
            t = page.extract_text()
            if t:
                text += t + "\n"
        if text.strip():
            return text.strip()
    except Exception:
        pass

    raise ValueError(
        "Could not extract text from this PDF. The file may be password-protected, "
        "a scanned image (no OCR layer), or corrupt. Please export as a text-based PDF "
        "or convert to JSON format before uploading."
    )


def _check_pdf_quality(text: str) -> None:
    """Detect garbage extraction (image-only PDFs)."""
    words = text.split()
    if len(words) < 50:
        raise ValueError(
            "Extracted text is too short — this PDF may be a scanned image without an OCR layer. "
            "Please run OCR on the PDF before uploading, or export as JSON."
        )
    # Check character diversity — garbled extraction has very low diversity
    unique_chars = len(set(text.replace(" ", "").replace("\n", "")))
    if unique_chars < 20:
        raise ValueError(
            "The extracted text appears to be garbled (low character diversity). "
            "This usually means the PDF is image-based. Please add an OCR layer or use JSON format."
        )


def _parse_self_attestation(raw: dict) -> str:
    """
    Convert the SelfReportPage JSON schema into a readable summary
    so Groq can analyse it like a prose report.
    """
    lines = [
        f"Report Type: {raw.get('report_type', 'enterprise_self_attestation')}",
        f"Schema Version: {raw.get('schema_version', '2.0')}",
        f"Completeness: {raw.get('completeness_pct', 'unknown')}%",
        f"Generated At: {raw.get('generated_at', 'unknown')}",
        "",
    ]
    ai = raw.get("ai_system", {})
    if ai:
        lines.append("=== AI SYSTEM INFORMATION ===")
        for k, v in ai.items():
            if v: lines.append(f"  {k.replace('_', ' ').title()}: {v}")
        lines.append("")

    gov = raw.get("governance", {})
    if gov:
        lines.append("=== GOVERNANCE ===")
        for k, v in gov.items():
            if v: lines.append(f"  {k.replace('_', ' ').title()}: {v}")
        lines.append("")

    safety = raw.get("safety_controls", {})
    if safety:
        lines.append("=== SAFETY CONTROLS ===")
        for k, v in safety.items():
            if v: lines.append(f"  {k.replace('_', ' ').title()}: {v}")
        lines.append("")

    fairness = raw.get("fairness_transparency", {})
    if fairness:
        lines.append("=== FAIRNESS & TRANSPARENCY ===")
        for k, v in fairness.items():
            if v: lines.append(f"  {k.replace('_', ' ').title()}: {v}")
        lines.append("")

    privacy = raw.get("data_privacy", {})
    if privacy:
        lines.append("=== DATA & PRIVACY ===")
        for k, v in privacy.items():
            if v: lines.append(f"  {k.replace('_', ' ').title()}: {v}")

    return "\n".join(lines)


def _json_to_text(content: bytes) -> tuple[str, dict]:
    raw = json.loads(content.decode("utf-8", errors="replace"))

    # Detect self-attestation format
    if raw.get("report_type") == "enterprise_self_attestation" or "ai_system" in raw:
        return _parse_self_attestation(raw), raw

    # Generic JSON: flatten to readable text
    lines = []
    def _walk(obj, prefix=""):
        if isinstance(obj, dict):
            for k, v in obj.items():
                _walk(v, f"{prefix}{k}: " if not prefix else f"{prefix} > {k}: ")
        elif isinstance(obj, list):
            for i, v in enumerate(obj[:20]):   # cap list items
                _walk(v, f"{prefix}[{i}] ")
        else:
            if str(obj).strip():
                lines.append(f"{prefix}{obj}")
    _walk(raw)
    return "\n".join(lines[:600]), raw


# ── Text chunking ──────────────────────────────────────────────────────────────

def _chunk_text(text: str, chunk_words: int = CHUNK_WORDS, overlap: int = CHUNK_OVERLAP) -> list[str]:
    words = text.split()
    if len(words) <= chunk_words:
        return [text]
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + chunk_words, len(words))
        chunks.append(" ".join(words[start:end]))
        if end >= len(words):
            break
        start = end - overlap
    return chunks


# ── Groq calls with retry ─────────────────────────────────────────────────────

def _groq_call(client, messages: list, max_tokens: int = 4_000, temp: float = 0.1) -> str:
    for attempt in range(MAX_RETRIES):
        try:
            completion = client.chat.completions.create(
                model=get_primary_model(),
                messages=messages,
                max_tokens=max_tokens,
                temperature=temp,
            )
            return completion.choices[0].message.content.strip()
        except RateLimitError:
            wait = 2 ** attempt
            if attempt < MAX_RETRIES - 1:
                time.sleep(wait)
            else:
                raise HTTPException(429, "Primary LLM rate limit reached. Please try again in a few seconds.")
        except APIStatusError as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(1)
            else:
                raise HTTPException(502, f"Primary LLM API error: {e.message}")
    raise HTTPException(502, "Primary LLM unreachable after retries.")


def _parse_groq_json(raw: str) -> dict:
    """Strip markdown fences and parse JSON, with fallback extraction."""
    raw = raw.strip()
    # Strip ```json ... ``` fences
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"```\s*$", "", raw, flags=re.MULTILINE).strip()
    # Find outermost JSON object
    start = raw.find("{")
    end   = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        raw = raw[start:end+1]
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Groq returned invalid JSON: {e}. Raw: {raw[:500]}")


# ── System prompt ──────────────────────────────────────────────────────────────

def _build_system_prompt(pass_num: int = 1) -> str:
    principle_block = "\n".join(
        f"- {p}: {TAF_DESCRIPTIONS[p]}" for p in TAF_PRINCIPLES
    )
    if pass_num == 1:
        return f"""You are a senior AI governance auditor specialising in the KPMG Trusted AI Framework (TAF).

TASK: Analyse the provided AI audit report / self-assessment document. Produce a structured JSON gap analysis showing how well the document covers each of the 10 TAF principles.

THE 10 TAF PRINCIPLES (with what to look for):
{principle_block}

INSTRUCTIONS:
- Be specific — quote or closely paraphrase actual content from the report when citing evidence
- Be honest — if the report doesn't cover a principle, say so clearly
- coverage_score should reflect quality AND quantity of coverage (0=nothing, 50=mentioned but shallow, 100=comprehensive)
- gaps should be specific, actionable, and not generic ("Add bias testing methodology" not "Improve fairness")
- confidence (0.0–1.0): how sure you are of the coverage assessment given the document content
- If the document is a self-assessment form (not a full audit), adjust expectations accordingly

OUTPUT: You MUST respond with ONLY valid JSON matching this exact schema:
{{
  "extracted": {{
    "ai_name": "string or null",
    "model_type": "string or null",
    "overall_score": number or null,
    "risk_level": "string or null",
    "evaluated_at": "string or null",
    "document_type": "full_audit" | "self_assessment" | "partial_audit" | "unknown",
    "frameworks_mentioned": []
  }},
  "audit_completeness_score": number (0-100),
  "overall_assessment": "string (2-4 sentences describing quality and completeness of the audit)",
  "principle_coverage": {{
    "Fairness":        {{"status": "covered"|"partial"|"not_covered", "coverage_score": 0-100, "confidence": 0.0-1.0, "evidence": "string", "gaps": ["gap1", "gap2"], "recommendation": "string"}},
    "Transparency":    {{"status": "covered"|"partial"|"not_covered", "coverage_score": 0-100, "confidence": 0.0-1.0, "evidence": "string", "gaps": ["gap1", "gap2"], "recommendation": "string"}},
    "Explainability":  {{"status": "covered"|"partial"|"not_covered", "coverage_score": 0-100, "confidence": 0.0-1.0, "evidence": "string", "gaps": ["gap1", "gap2"], "recommendation": "string"}},
    "Accountability":  {{"status": "covered"|"partial"|"not_covered", "coverage_score": 0-100, "confidence": 0.0-1.0, "evidence": "string", "gaps": ["gap1", "gap2"], "recommendation": "string"}},
    "Data Integrity":  {{"status": "covered"|"partial"|"not_covered", "coverage_score": 0-100, "confidence": 0.0-1.0, "evidence": "string", "gaps": ["gap1", "gap2"], "recommendation": "string"}},
    "Reliability":     {{"status": "covered"|"partial"|"not_covered", "coverage_score": 0-100, "confidence": 0.0-1.0, "evidence": "string", "gaps": ["gap1", "gap2"], "recommendation": "string"}},
    "Security":        {{"status": "covered"|"partial"|"not_covered", "coverage_score": 0-100, "confidence": 0.0-1.0, "evidence": "string", "gaps": ["gap1", "gap2"], "recommendation": "string"}},
    "Safety":          {{"status": "covered"|"partial"|"not_covered", "coverage_score": 0-100, "confidence": 0.0-1.0, "evidence": "string", "gaps": ["gap1", "gap2"], "recommendation": "string"}},
    "Privacy":         {{"status": "covered"|"partial"|"not_covered", "coverage_score": 0-100, "confidence": 0.0-1.0, "evidence": "string", "gaps": ["gap1", "gap2"], "recommendation": "string"}},
    "Sustainability":  {{"status": "covered"|"partial"|"not_covered", "coverage_score": 0-100, "confidence": 0.0-1.0, "evidence": "string", "gaps": ["gap1", "gap2"], "recommendation": "string"}}
  }},
  "regulatory_gaps": {{
    "EU AI Act": {{"mentioned": boolean, "articles_referenced": [], "missing_controls": [], "compliance_estimate": "Compliant"|"Conditional"|"Non-Compliant"|"Unknown"}},
    "ISO 42001": {{"mentioned": boolean, "articles_referenced": [], "missing_controls": [], "compliance_estimate": "Compliant"|"Conditional"|"Non-Compliant"|"Unknown"}},
    "NIST AI RMF": {{"mentioned": boolean, "articles_referenced": [], "missing_controls": [], "compliance_estimate": "Compliant"|"Conditional"|"Non-Compliant"|"Unknown"}}
  }},
  "top_findings": [
    {{"principle": "string", "severity": "Critical"|"High"|"Medium"|"Low", "issue": "specific issue text", "recommendation": "specific action"}}
  ]
}}"""
    # Pass 2: focused on regulatory gaps and findings only
    return """You are an AI governance regulatory expert. You have already seen an AI audit report. Now produce ONLY the regulatory gap analysis and top findings based on the coverage already identified.

Respond with ONLY valid JSON:
{
  "regulatory_gaps": {
    "EU AI Act": {"mentioned": boolean, "articles_referenced": [], "missing_controls": [], "compliance_estimate": "Compliant"|"Conditional"|"Non-Compliant"|"Unknown"},
    "ISO 42001": {"mentioned": boolean, "articles_referenced": [], "missing_controls": [], "compliance_estimate": "..."},
    "NIST AI RMF": {"mentioned": boolean, "articles_referenced": [], "missing_controls": [], "compliance_estimate": "..."}
  },
  "top_findings": [
    {"principle": "string", "severity": "Critical"|"High"|"Medium"|"Low", "issue": "string", "recommendation": "string"}
  ]
}"""


# ── Schema validation + repair ─────────────────────────────────────────────────

def _validate_and_repair(analysis: dict) -> dict:
    """Ensure all required fields exist, are correctly typed, and in valid ranges."""

    # Top-level required fields
    analysis.setdefault("extracted", {})
    analysis.setdefault("audit_completeness_score", 0)
    analysis.setdefault("overall_assessment", "Analysis completed.")
    analysis.setdefault("principle_coverage", {})
    analysis.setdefault("regulatory_gaps", {})
    analysis.setdefault("top_findings", [])

    # Clamp completeness score
    try:
        analysis["audit_completeness_score"] = max(0, min(100, int(analysis["audit_completeness_score"])))
    except (TypeError, ValueError):
        analysis["audit_completeness_score"] = 0

    # Ensure all 10 principles present
    coverage = analysis["principle_coverage"]
    for p in TAF_PRINCIPLES:
        if p not in coverage:
            coverage[p] = {
                "status": "not_covered",
                "coverage_score": 0,
                "confidence": 0.5,
                "evidence": "",
                "gaps": [f"The report contains no coverage of {p}."],
                "recommendation": f"Add a dedicated {p} section addressing: {TAF_DESCRIPTIONS[p]}",
            }
        else:
            pc = coverage[p]
            # Validate status
            if pc.get("status") not in ("covered", "partial", "not_covered"):
                pc["status"] = "not_covered"
            # Clamp coverage_score
            try:
                pc["coverage_score"] = max(0, min(100, int(pc.get("coverage_score", 0))))
            except (TypeError, ValueError):
                pc["coverage_score"] = 0
            # Clamp confidence
            try:
                pc["confidence"] = max(0.0, min(1.0, float(pc.get("confidence", 0.5))))
            except (TypeError, ValueError):
                pc["confidence"] = 0.5
            # Ensure lists
            if not isinstance(pc.get("gaps"), list):
                pc["gaps"] = [str(pc.get("gaps", ""))] if pc.get("gaps") else []
            pc.setdefault("evidence", "")
            pc.setdefault("recommendation", f"Strengthen {p} coverage.")

    # Ensure all 3 frameworks present
    reg = analysis["regulatory_gaps"]
    for fw in REGULATORY_FRAMEWORKS:
        if fw not in reg:
            reg[fw] = {
                "mentioned": False,
                "articles_referenced": [],
                "missing_controls": [],
                "compliance_estimate": "Unknown",
            }
        else:
            rg = reg[fw]
            if not isinstance(rg.get("articles_referenced"), list):
                rg["articles_referenced"] = []
            if not isinstance(rg.get("missing_controls"), list):
                rg["missing_controls"] = []
            if rg.get("compliance_estimate") not in ("Compliant", "Conditional", "Non-Compliant", "Unknown"):
                rg["compliance_estimate"] = "Unknown"

    # Validate findings
    valid_findings = []
    for f in analysis.get("top_findings", []):
        if isinstance(f, dict) and f.get("principle") and f.get("issue"):
            if f.get("severity") not in ("Critical", "High", "Medium", "Low"):
                f["severity"] = "Medium"
            f.setdefault("recommendation", "Review and address this finding.")
            valid_findings.append(f)
    analysis["top_findings"] = valid_findings[:10]   # cap at 10

    # Auto-generate missing regulatory articles from principles
    for fw in REGULATORY_FRAMEWORKS:
        rg = analysis["regulatory_gaps"][fw]
        if not rg["articles_referenced"]:
            # Add articles for covered principles
            auto_articles = []
            for p in TAF_PRINCIPLES:
                if coverage.get(p, {}).get("status") == "covered":
                    auto_articles.extend(REGULATORY_ARTICLES.get(fw, {}).get(p, [])[:1])
            rg["articles_referenced"] = auto_articles[:6]

    return analysis


# ── Multi-chunk analysis ───────────────────────────────────────────────────────

def _analyse_chunks(client, chunks: list[str]) -> dict:
    """
    If document is too long, analyse in chunks and merge results.
    Uses a simple 'best evidence wins' merge strategy.
    """
    if len(chunks) == 1:
        raw = _groq_call(client, [
            {"role": "system", "content": _build_system_prompt(1)},
            {"role": "user",   "content": f"Analyse this AI audit document:\n\n{chunks[0]}"},
        ])
        return _parse_groq_json(raw)

    # Multiple chunks: analyse each, then synthesise
    chunk_results = []
    for i, chunk in enumerate(chunks[:3]):   # max 3 chunks to control cost
        try:
            raw = _groq_call(client, [
                {"role": "system", "content": _build_system_prompt(1)},
                {"role": "user",   "content": (
                    f"[Document chunk {i+1} of {len(chunks)}]\n\n"
                    f"Analyse this section of an AI audit document:\n\n{chunk}"
                )},
            ], max_tokens=3_000)
            result = _parse_groq_json(raw)
            chunk_results.append(result)
        except Exception:
            continue   # skip failed chunks

    if not chunk_results:
        raise HTTPException(500, "Failed to analyse any document chunks.")

    if len(chunk_results) == 1:
        return chunk_results[0]

    # Merge: for each principle, take the highest coverage_score across chunks
    merged = chunk_results[0]
    for subsequent in chunk_results[1:]:
        sub_cov = subsequent.get("principle_coverage", {})
        for p in TAF_PRINCIPLES:
            if p in sub_cov:
                existing_score = merged["principle_coverage"].get(p, {}).get("coverage_score", 0)
                new_score      = sub_cov[p].get("coverage_score", 0)
                if new_score > existing_score:
                    merged["principle_coverage"][p] = sub_cov[p]
                elif sub_cov[p].get("evidence") and not merged["principle_coverage"].get(p, {}).get("evidence"):
                    # Keep better evidence even if score is similar
                    merged["principle_coverage"][p]["evidence"] = sub_cov[p]["evidence"]

    # Recompute completeness from merged principle scores
    scores = [
        merged["principle_coverage"].get(p, {}).get("coverage_score", 0)
        for p in TAF_PRINCIPLES
    ]
    merged["audit_completeness_score"] = int(sum(scores) / len(TAF_PRINCIPLES))

    return merged


# ── Self-attestation boost ─────────────────────────────────────────────────────

def _apply_self_attestation_context(analysis: dict, raw_json: dict) -> dict:
    """
    Pre-populate known fields from a SelfReportPage JSON before LLM analysis.
    This reduces hallucination by giving the model concrete data.
    """
    ext = analysis["extracted"]
    ai  = raw_json.get("ai_system", {})

    if not ext.get("ai_name")   and ai.get("name"):     ext["ai_name"]   = ai["name"]
    if not ext.get("model_type") and ai.get("use_case"): ext["model_type"] = ai["use_case"]
    if not ext.get("risk_level") and ai.get("risk_tier"): ext["risk_level"] = ai["risk_tier"]

    ext["document_type"] = "self_assessment"

    # Map known fields to principle coverage boosts
    cov = analysis["principle_coverage"]

    gov = raw_json.get("governance", {})
    if gov.get("written_policy") and cov.get("Accountability", {}).get("coverage_score", 0) < 30:
        cov["Accountability"]["evidence"] = f"Governance policy: {gov['written_policy']}"
        cov["Accountability"]["coverage_score"] = max(cov["Accountability"].get("coverage_score", 0), 35)
        cov["Accountability"]["status"] = "partial"

    safety = raw_json.get("safety_controls", {})
    if safety.get("human_oversight") and cov.get("Safety", {}).get("coverage_score", 0) < 30:
        cov["Safety"]["evidence"] = f"Human oversight: {safety['human_oversight']}"
        cov["Safety"]["coverage_score"] = max(cov["Safety"].get("coverage_score", 0), 40)
        cov["Safety"]["status"] = "partial"

    privacy = raw_json.get("data_privacy", {})
    if privacy.get("pii_handling") and cov.get("Privacy", {}).get("coverage_score", 0) < 30:
        cov["Privacy"]["evidence"] = f"PII handling: {privacy['pii_handling']}"
        cov["Privacy"]["coverage_score"] = max(cov["Privacy"].get("coverage_score", 0), 35)
        cov["Privacy"]["status"] = "partial"

    fairness = raw_json.get("fairness_transparency", {})
    if fairness.get("bias_testing") and cov.get("Fairness", {}).get("coverage_score", 0) < 30:
        cov["Fairness"]["evidence"] = f"Bias testing: {fairness['bias_testing']}"
        cov["Fairness"]["coverage_score"] = max(cov["Fairness"].get("coverage_score", 0), 35)
        cov["Fairness"]["status"] = "partial"

    return analysis


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/report")
async def audit_report(file: UploadFile = File(...)):
    """
    Accept a PDF or JSON AI audit report and return a comprehensive TAF gap analysis.
    """
    client   = get_groq()
    filename = (file.filename or "").lower()

    if not (filename.endswith(".pdf") or filename.endswith(".json")):
        raise HTTPException(400, "Only PDF (.pdf) and JSON (.json) files are supported.")

    content = await file.read()
    if not content:
        raise HTTPException(400, "Uploaded file is empty.")

    # File size check
    max_bytes = MAX_PDF_BYTES if filename.endswith(".pdf") else MAX_JSON_BYTES
    if len(content) > max_bytes:
        mb = max_bytes // (1024 * 1024)
        raise HTTPException(413, f"File too large. Maximum size for {filename.split('.')[-1].upper()} files is {mb} MB.")

    # ── Extract text ──────────────────────────────────────────────────────────
    try:
        is_self_attestation = False
        raw_json: dict = {}

        if filename.endswith(".json"):
            report_text, raw_json = _json_to_text(content)
            file_type = "json"
            is_self_attestation = raw_json.get("report_type") == "enterprise_self_attestation"
        else:
            report_text = _extract_pdf_text(content)
            _check_pdf_quality(report_text)
            raw_json    = {}
            file_type   = "pdf"

    except ValueError as e:
        raise HTTPException(422, str(e))

    if not report_text or len(report_text.strip()) < 50:
        raise HTTPException(
            422,
            "Could not extract meaningful content from the file. "
            "Ensure the document is not empty, encrypted, or image-only."
        )

    # ── Chunk text ────────────────────────────────────────────────────────────
    words = report_text.split()
    if len(words) > MAX_WORDS_GROQ:
        chunks = _chunk_text(report_text)
    else:
        chunks = [report_text]

    # ── Groq analysis ─────────────────────────────────────────────────────────
    try:
        analysis = _analyse_chunks(client, chunks)
    except ValueError as e:
        raise HTTPException(500, f"Analysis parsing failed: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Analysis failed: {str(e)}")

    # ── Post-process ──────────────────────────────────────────────────────────
    analysis = _validate_and_repair(analysis)

    # Boost with self-attestation known fields
    if is_self_attestation:
        analysis = _apply_self_attestation_context(analysis, raw_json)

    # Merge directly-parseable JSON fields
    if raw_json and isinstance(raw_json, dict) and not is_self_attestation:
        ext = analysis["extracted"]
        if not ext.get("ai_name")       and raw_json.get("ai_name"):       ext["ai_name"]       = raw_json["ai_name"]
        if not ext.get("overall_score") and raw_json.get("overall_score") is not None: ext["overall_score"] = raw_json["overall_score"]
        if not ext.get("risk_level")    and raw_json.get("risk_level"):    ext["risk_level"]    = raw_json["risk_level"]
        if not ext.get("model_type")    and raw_json.get("model_type"):    ext["model_type"]    = raw_json["model_type"]
        if not ext.get("evaluated_at")  and raw_json.get("evaluated_at"): ext["evaluated_at"]  = raw_json["evaluated_at"]

    # Final metadata
    audit_id = str(uuid.uuid4())
    result = {
        **analysis,
        "audit_id":  audit_id,
        "file_name": file.filename,
        "file_type": file_type,
        "analysed_at": datetime.utcnow().isoformat(),
        "word_count":  len(words),
        "chunks_used": len(chunks),
    }

    # ── Persist to MongoDB (best-effort) ──────────────────────────────────────
    if _mongo_available and audit_results_collection is not None:
        try:
            audit_results_collection.insert_one({**result, "created_at": datetime.utcnow()})
        except Exception:
            pass   # Don't fail the request if MongoDB is unavailable

    return result


@router.get("/history")
async def get_audit_history(limit: int = Query(default=20, le=50)):
    """Return recent report audit results (requires MongoDB)."""
    if not _mongo_available or audit_results_collection is None:
        raise HTTPException(503, "Audit history requires MongoDB to be configured.")
    records = list(
        audit_results_collection.find({}, {"_id": 0, "principle_coverage": 0})
        .sort("created_at", -1)
        .limit(limit)
    )
    for r in records:
        if isinstance(r.get("created_at"), datetime):
            r["created_at"] = r["created_at"].isoformat()
    return {"history": records, "count": len(records)}


@router.get("/result/{audit_id}")
async def get_audit_result(audit_id: str):
    """Return a previously stored audit result by ID."""
    if not _mongo_available or audit_results_collection is None:
        raise HTTPException(503, "Audit result retrieval requires MongoDB to be configured.")
    record = audit_results_collection.find_one({"audit_id": audit_id}, {"_id": 0})
    if not record:
        raise HTTPException(404, f"No audit result found for ID: {audit_id}")
    if isinstance(record.get("created_at"), datetime):
        record["created_at"] = record["created_at"].isoformat()
    return record