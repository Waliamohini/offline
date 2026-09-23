"""
services/sdcc/models/summarization.py
==========================================
Summarization — Enterprise-grade evaluator.

KEY DESIGN DECISIONS
---------------------
1. Context extraction from input prompts
   Many production summarization prompts embed the source document inside the
   input column (e.g. "Summarize the following article:\n\n<document>").
   This evaluator detects that pattern and extracts the embedded context so
   that faithfulness, coverage, and density can be computed correctly even
   when there is no dedicated context/source column.

   Priority order for source document:
     a) Dedicated context/source/document column
     b) Context extracted from the input prompt via pattern matching
     c) Full input text as fallback (with lower confidence flag)

2. Reference-free vs supervised metrics
   ROUGE/BLEU/BERTScore require human reference summaries.
   When no references exist (the normal production case), the system uses:
     - faithfulness   (summary semantic similarity to source document)
     - coverage_score (key sentence coverage)
     - density_score  (abstractiveness balance)
     - compression_ratio
     - summary_redundancy
   All reference-supervised metrics show as Unavailable without references.

3. Sample-size warnings
   Results below 50 records carry explicit confidence warnings.
"""

from __future__ import annotations
import pandas as pd
import numpy as np
from typing import Optional
from app.services.sdcc.base_evaluator import BaseEvaluator


class SummarizationEvaluator(BaseEvaluator):

    MODEL_TYPE  = "summarization"
    LABEL       = "Summarization"
    DESCRIPTION = "Models that condense long documents into shorter summaries"

    THRESHOLDS = {
        # Reference-supervised (shown as Unavailable when no reference column)
        "rouge_l":            {"low": 0.38, "moderate": 0.22, "unit": "score"},
        "rouge_1":            {"low": 0.42, "moderate": 0.28, "unit": "score"},
        "rouge_2":            {"low": 0.16, "moderate": 0.08, "unit": "score"},
        "bleu":               {"low": 0.22, "moderate": 0.10, "unit": "score"},
        "bertscore":          {"low": 0.85, "moderate": 0.74, "unit": "score"},
        # Reference-free (always computed)
        "faithfulness":       {"low": 0.55, "moderate": 0.40, "unit": "score"},
        "coverage_score":     {"low": 0.55, "moderate": 0.38, "unit": "score"},
        "density_score":      {"low": 0.60, "moderate": 0.40, "unit": "score"},
        "compression_ratio":  {"low": 0.35, "moderate": 0.55, "unit": "ratio", "inverted": True},
        "summary_redundancy": {"low": 0.80, "moderate": 0.60, "unit": "score"},
        "reference_coverage": {"low": 0.85, "moderate": 0.60, "unit": "ratio"},
    }

    TAF_METRIC_WEIGHTS = {
        # rouge scores, bertscore, faithfulness = core reliability of summary quality
        "Reliability":     0.20,
        # faithfulness + coverage_score = whether source facts are preserved
        "Data Integrity":  0.18,
        # coverage_score = summary faithfully represents what the source says
        "Transparency":    0.15,
        # density_score + coherence = how understandable the summarization is
        "Explainability":  0.12,
        # equal compression quality across document types and topics
        "Fairness":        0.10,
        # reference_coverage = auditable, reproducible evaluation
        "Accountability":  0.08,
        # faithfulness as safety guard; hallucinated facts can mislead readers
        "Safety":          0.07,
        # summaries may inadvertently expose PII from source documents
        "Privacy":         0.05,
        # injection patterns inside source documents before summarisation
        "Security":        0.03,
        # compression_ratio + latency ↔ compute and energy per summary
        "Sustainability":  0.02,
    }  # sum = 1.00

    # ── Source document resolution ─────────────────────────────────────────────

    def _resolve_source(self, df: pd.DataFrame) -> tuple[list[str], str]:
        """
        Resolve the source document list with explicit provenance tracking.

        Returns:
            (source_texts, provenance) where provenance is one of:
            'dedicated_column' | 'extracted_from_input' | 'full_input_fallback'

        Priority:
          1. Dedicated context/source/document column
          2. Context extracted from input prompt via _extract_context_from_input
          3. Full input text (with provenance flag so downstream can weight appropriately)
        """
        # Priority 1: dedicated column
        ctx_col = self._col(df, "context", "source", "document", "source_doc",
                            "retrieved_chunks", "chunks", "passages", "article", "text")
        if ctx_col:
            texts = df[ctx_col].dropna().astype(str).tolist()
            if texts:
                return texts, "dedicated_column"

        # Priority 2: extract from input
        inp_col = self._col(df, "input", "prompt", "query", "instruction")
        if inp_col:
            inputs = df[inp_col].dropna().astype(str).tolist()
            extracted = [self._extract_context_from_input(t) for t in inputs]
            valid_count = sum(1 for e in extracted if e is not None)
            if valid_count >= max(1, len(inputs) * 0.30):
                # Use extracted where available, fall back to full input otherwise
                resolved = [e if e is not None else inputs[i]
                            for i, e in enumerate(extracted)]
                provenance = "extracted_from_input"
                return resolved, provenance

            # Priority 3: full input as fallback
            if inputs:
                return inputs, "full_input_fallback"

        return [], "none"

    # ── model_metrics ──────────────────────────────────────────────────────────

    def model_metrics(self, df: pd.DataFrame, computed: dict | None = None) -> dict:
        c = computed or {}
        sample_warn = self._validate_sample_size(len(df))

        return {
            # Reference-supervised
            "rouge_l": self._metric_result(
                c.get("rouge_l"),
                "ROUGE-L F1 vs human reference summary. "
                f"[{sample_warn['level']} confidence — {sample_warn['message']}]",
                "rouge_l"),
            "rouge_1": self._metric_result(
                c.get("rouge_1"),
                "ROUGE-1 unigram overlap with human reference summary.",
                "rouge_1"),
            "rouge_2": self._metric_result(
                c.get("rouge_2"),
                "ROUGE-2 bigram overlap with human reference summary.",
                "rouge_2"),
            "bleu": self._metric_result(
                c.get("bleu"),
                "BLEU n-gram precision vs human reference summary.",
                "bleu"),
            "bertscore": self._metric_result(
                c.get("bertscore"),
                "BERTScore F1: semantic similarity with human reference.",
                "bertscore"),
            # Reference-free
            "faithfulness": self._metric_result(
                c.get("faithfulness") or self._mean(df, "faithfulness", "factual_consistency"),
                "Semantic similarity of summary to source document. "
                "Measures whether summary is grounded in source content (not contradicting it).",
                "faithfulness"),
            "coverage_score": self._metric_result(
                c.get("coverage_score") or self._mean(df, "coverage_score"),
                "Proportion of source key sentences reflected in summary. "
                "Measures whether the important content was captured.",
                "coverage_score"),
            "density_score": self._metric_result(
                c.get("density_score") or self._mean(df, "density_score"),
                "Abstractiveness balance (0=too extractive/copy-paste, 1=ideal paraphrase). "
                "Ideal range: density 0.30-0.65 maps to score 1.0.",
                "density_score"),
            "compression_ratio": self._metric_result(
                c.get("compression_ratio") or self._mean(df, "compression_ratio"),
                "Output/input token ratio. Good summaries: 10-35% of source length.",
                "compression_ratio"),
            "summary_redundancy": self._metric_result(
                c.get("summary_redundancy") or self._mean(df, "summary_redundancy"),
                "1 minus intra-summary bigram repetition. Higher = less internal repetition.",
                "summary_redundancy"),
            "reference_coverage": self._metric_result(
                c.get("reference_coverage"),
                "Proportion of records with human reference summaries. "
                "Higher = more supervised evaluation possible.",
                "reference_coverage"),
        }

    # ── taf_principles ─────────────────────────────────────────────────────────

    def taf_principles(self, diagnostics: dict, logs_count: int, metrics: dict,
                       df: pd.DataFrame | None = None) -> dict:

        # ── Extract text with context resolution ──────────────────────────────
        source_provenance = "none"
        if df is not None and not df.empty:
            sources, source_provenance = self._resolve_source(df)
        else:
            sources = []

        # Compute sub-parameters with context-aware extraction
        sp = self._compute_sp(df, extract_context=True)

        s   = self._structural(diagnostics, logs_count)
        c   = self.clamp
        G   = lambda key, fb, inv=False: self._sp(sp, key, fb, inv)
        M   = lambda key, inverted=False: self._mv(metrics, key, inverted)

        # Reference-free metrics (always meaningful)
        faith    = M("faithfulness")
        coverage = M("coverage_score")
        density  = M("density_score")
        no_redun = M("summary_redundancy")
        compress = M("compression_ratio", inverted=True)  # lower ratio = better
        ref_cov  = M("reference_coverage")

        # Reference-supervised (neutral=40 if unavailable)
        rouge_l  = M("rouge_l")
        rouge_1  = M("rouge_1")
        bleu     = M("bleu")
        bert     = M("bertscore")

        has_rouge = metrics.get("rouge_l",   {}).get("value") is not None
        has_bert  = metrics.get("bertscore", {}).get("value") is not None

        vol    = s["volume_score"];  schema = s["schema_score"]
        compl  = s["completeness"]; dup    = s["dup_penalty"]
        B      = lambda f: 100 if f else 0
        has_ts  = B(s["has_timestamp"]); has_uid = B(s["has_user_id"])
        has_ver = B(s["has_version"]);   has_err = B(s["has_error"])
        has_ovr = B(s["has_override"])

        # Provenance penalty: if source came from full_input_fallback, reduce
        # faithfulness/coverage scores slightly (less reliable)
        prov_penalty = {
            "dedicated_column":    1.00,
            "extracted_from_input": 0.95,
            "full_input_fallback":  0.85,
            "none":                 0.70,
        }.get(source_provenance, 0.85)

        faith_adj    = c(faith    * prov_penalty)
        coverage_adj = c(coverage * prov_penalty)

        # Compression equity across documents
        ratio_equity = 50
        inp_col = self._col(df, "input","source","document","text","prompt") if df is not None else None
        out_col = self._col(df, "output","summary","generated_summary") if df is not None else None
        if df is not None and inp_col and out_col:
            inp_lens = df[inp_col].dropna().apply(lambda x: len(str(x).split()))
            out_lens = df[out_col].dropna().apply(lambda x: len(str(x).split()))
            n = min(len(inp_lens), len(out_lens))
            if n > 1:
                ratios = out_lens[:n].values / inp_lens[:n].values.clip(min=1)
                ratio_equity = c(max(0, 100 - float(np.std(ratios)) * 200))
            elif n == 1:
                ratio_equity = 80

        pp = {
            "Fairness": {
                "Compression Equity Across Topics": ratio_equity,
                "Output Length Equity":             G("output_equity_score",         60),
                "Source Representativeness":        G("data_representativeness",     compl),
                "Fairness Monitoring Signals":      G("fairness_monitoring_signals", 30),
            },
            "Transparency": {
                "Source Document Coverage":         coverage_adj,
                "Compression Ratio Transparency":   compress,
                "Reference Summary Logging":        ref_cov,
                "Model Versioning":                 c(0.6*has_ver + 0.4*has_ts),
            },
            "Explainability": {
                "Faithfulness to Source":           faith_adj,
                "Abstractiveness Balance":          density,
                "ROUGE-L Alignment":                rouge_l if has_rouge else coverage_adj,
                "Summary Readability":              G("human_readable_outputs", 55),
            },
            "Accountability": {
                "Reference Summary Coverage":       ref_cov,
                "Human Review Escalation":          G("human_oversight_signals",    has_ovr),
                "Error & Limitation Logging":       G("error_acknowledgment_rate",  has_err),
                "Audit Trail Coverage":             c(0.35*vol + 0.35*has_ts + 0.30*has_uid),
            },
            "Data Integrity": {
                "Summary Completeness":             G("data_completeness_text",  compl),
                "ROUGE-1 Quality":                  rouge_1 if has_rouge else coverage_adj,
                "BLEU Score Quality":               bleu    if has_rouge else density,
                "Format Consistency":               G("schema_quality_score",    schema),
            },
            "Reliability": {
                "Faithfulness Stability":           faith_adj,
                "Summary Output Consistency":       G("output_consistency_score", compl),
                "ROUGE-L Consistency":              rouge_l if has_rouge else coverage_adj,
                "BERTScore Semantic Consistency":   bert    if has_bert  else faith_adj,
            },
            "Security": {
                "Source Document Injection Rate":   G("injection_rate",         80, inv=True),
                "Harmful Content in Summaries":     G("harmful_content_rate",   80, inv=True),
                "PII in Summaries":                 G("pii_in_outputs",         80, inv=True),
                "Input Anomaly Rate":               G("input_anomaly_rate",     80, inv=True),
            },
            "Safety": {
                "Faithfulness as Safety Guard":     faith_adj,
                "Hallucinated Facts Prevention":    G("hallucination_indicators", faith_adj, inv=True),
                "Human Override Capability":        c(0.5*G("human_override_signals",has_ovr)+0.5*has_ovr),
                "Harmful Summary Rate":             G("harm_prevention_rate",   80, inv=True),
            },
            "Privacy": {
                "PII Leakage from Source Docs":     G("pii_leakage_rate",       80, inv=True),
                "Summary Data Minimisation":        compress,
                "Anonymisation in Summaries":       G("anonymisation_score",    60),
                "Sensitive Content Retention":      G("data_retention_signals", 30),
            },
            "Sustainability": {
                "Compression Efficiency":           compress,
                "Non-Redundancy Score":             no_redun,
                "Intra-Summary Redundancy":         G("output_redundancy",      80, inv=True),
                "Cross-Summary Deduplication":      G("lexical_redundancy",     80, inv=True),
            },
        }
        result = self._assemble_principles(pp, metrics)

        # Attach provenance metadata to every principle for audit transparency
        meta = {
            "source_provenance": source_provenance,
            "sample_size_warning": self._validate_sample_size(logs_count),
            "supervised_metrics_available": has_rouge,
        }
        for pdata in result.values():
            pdata["evaluation_metadata"] = meta

        return result

    # ── Document extraction helpers ────────────────────────────────────────────

    @staticmethod
    def extract_text_from_document(file_content: bytes, filename: str) -> str:
        """Extract plain text from PDF, TXT, DOCX, or MD files."""
        fname = filename.lower()
        if fname.endswith((".txt", ".md")):
            try:
                return file_content.decode("utf-8")
            except UnicodeDecodeError:
                return file_content.decode("latin-1", errors="replace")
        if fname.endswith(".pdf"):
            import io
            try:
                import pypdf
                reader = pypdf.PdfReader(io.BytesIO(file_content))
                pages  = [page.extract_text() or "" for page in reader.pages]
                text   = "\n\n".join(p for p in pages if p.strip())
                if text.strip():
                    return text
            except ImportError:
                pass
            try:
                import pdfminer.high_level as pdfminer
                import io as _io
                return pdfminer.extract_text(_io.BytesIO(file_content))
            except ImportError:
                pass
            raise ValueError("PDF extraction requires 'pypdf'. Install: pip install pypdf")
        if fname.endswith(".docx"):
            import io
            try:
                import docx as _docx
                doc = _docx.Document(io.BytesIO(file_content))
                return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
            except ImportError:
                raise ValueError("DOCX extraction requires 'python-docx'. Install: pip install python-docx")
        raise ValueError(f"Unsupported format '{filename}'. Supported: .csv .json .txt .md .pdf .docx")

    @staticmethod
    def build_document_dataframe(documents: list[str], summaries: list[str],
                                  references: list[str] | None = None) -> pd.DataFrame:
        """Build evaluation DataFrame from raw document + summary pairs."""
        data: dict = {"source": documents, "summary": summaries}
        if references and len(references) == len(documents):
            data["reference"] = references
        return pd.DataFrame(data)

    # ── Recommendations ────────────────────────────────────────────────────────

    _STRUCTURAL_RECS = {
        "Fairness": {
            "Compression Equity Across Topics": "Audit compression ratios per domain; ensure equal treatment across document types.",
            "Output Length Equity":             "Normalise summary length targets; avoid shorter summaries for certain topics.",
            "Source Representativeness":        "Include diverse document types, domains, and lengths in evaluation set.",
            "Fairness Monitoring Signals":      "Add document-type labels to enable fairness analysis across categories.",
        },
        "Transparency": {
            "Source Document Coverage":         "Ensure key source sentences are reflected in summaries. Measure coverage_score ≥ 0.55.",
            "Compression Ratio Transparency":   "Report compression ratio per summary in production logs.",
            "Reference Summary Logging":        "Log human reference summaries for ≥ 85% of records for supervised evaluation.",
            "Model Versioning":                 "Version-stamp all summarisation model checkpoints; log version per summary.",
        },
        "Explainability": {
            "Faithfulness to Source":           "Measure faithfulness per summary; flag any summary with faithfulness < 0.5.",
            "Abstractiveness Balance":          "Target density 0.30-0.65 (abstractive, not copy-paste, not hallucinated).",
            "ROUGE-L Alignment":                "Add reference summaries; fine-tune on domain data; adjust length penalty.",
            "Summary Readability":              "Target Flesch Reading Ease ≥ 60; simplify sentence structure.",
        },
        "Accountability": {
            "Reference Summary Coverage":       "Add human reference summaries for ≥ 85% of records.",
            "Human Review Escalation":          "Flag summaries with faithfulness < 0.45 for mandatory human review.",
            "Error & Limitation Logging":       "Log when summarisation fails or produces low-confidence output.",
            "Audit Trail Coverage":             "Log document ID, summary, faithfulness score, and timestamp per record.",
        },
        "Data Integrity": {
            "Summary Completeness":             "Ensure all summaries are substantive; eliminate empty or near-empty outputs.",
            "ROUGE-1 Quality":                  "Improve lexical overlap; reduce over-abstraction.",
            "BLEU Score Quality":               "Add domain reference summaries; fine-tune on domain-specific data.",
            "Format Consistency":               "Standardise summary format and length targets across all documents.",
        },
        "Reliability": {
            "Faithfulness Stability":           "Faithfulness variance across documents should be < 0.15; add self-consistency checks.",
            "Summary Output Consistency":       "Reduce summary length variance; standardise on a target length range.",
            "ROUGE-L Consistency":              "Fine-tune on domain summaries; adjust length penalty parameter.",
            "BERTScore Semantic Consistency":   "Reduce semantic drift with factual consistency training.",
        },
        "Security": {
            "Source Document Injection Rate":   "Sanitise source documents; detect and block injection patterns before summarisation.",
            "Harmful Content in Summaries":     "Filter generated summaries for harmful keywords; block and log violations.",
            "PII in Summaries":                 "Scan all summaries for PII using regex; implement automatic redaction.",
            "Input Anomaly Rate":               "Validate source documents before processing; reject empty or malformed inputs.",
        },
        "Safety": {
            "Faithfulness as Safety Guard":     "High-stakes domains (medical, legal) require faithfulness ≥ 0.75; enforce threshold.",
            "Hallucinated Facts Prevention":    "Add NLI-based fact-verification step before serving summaries.",
            "Human Override Capability":        "Route summaries with faithfulness < 0.5 to mandatory human review queue.",
            "Harmful Summary Rate":             "Implement content safety filtering on all generated summaries.",
        },
        "Privacy": {
            "PII Leakage from Source Docs":     "Scan source documents for PII before summarisation; redact before model input.",
            "Summary Data Minimisation":        "Target 10-30% compression; do not include unnecessary personal details.",
            "Anonymisation in Summaries":       "Remove or pseudonymise personal identifiers from all generated summaries.",
            "Sensitive Content Retention":      "Implement document expiry; do not retain source docs beyond stated purpose.",
        },
        "Sustainability": {
            "Compression Efficiency":           "Target 80-90% compression (ratio 0.10-0.20); verbose summaries waste compute.",
            "Non-Redundancy Score":             "Reduce intra-summary repetition; use diverse beam search or repetition penalties.",
            "Intra-Summary Redundancy":         "Reduce repeated phrases within summaries.",
            "Cross-Summary Deduplication":      "Deduplicate near-identical summaries in logs; cache results for repeat documents.",
        },
    }

    def _rec_for_metric(self, m: str) -> str:
        return {
            "faithfulness":       "Faithfulness below threshold. Check summary-source contradiction; use NLI if available.",
            "coverage_score":     "Coverage low. Key source sentences not in summaries. Check length targets and model config.",
            "density_score":      "Density out of ideal range. Either too extractive (copy-paste) or too disconnected from source.",
            "compression_ratio":  "Compression out of range. Either summaries too verbose (>35%) or too short (<10%).",
            "summary_redundancy": "High internal repetition in summaries. Use diverse beam search or no_repeat_ngram_size.",
            "rouge_l":            "ROUGE-L below threshold. Add references; fine-tune on domain summaries.",
            "rouge_1":            "ROUGE-1 below threshold. Improve lexical overlap; reduce over-abstraction.",
            "rouge_2":            "ROUGE-2 below threshold. Reduce paraphrasing; improve bigram overlap.",
            "bleu":               "BLEU below threshold. Add domain reference summaries.",
            "bertscore":          "BERTScore below threshold. Semantic drift detected; factual consistency training recommended.",
            "reference_coverage": "No reference summaries. Add human references for ≥ 85% of records.",
        }.get(m, f"Investigate elevated risk in '{m}'.")

    def _context_for_rec(self, principle: str, worst_param: str) -> str:
        """Model-type-specific context for the Groq recommendation prompt."""
        if principle == "Fairness":
            return "Summarization models can introduce bias by selectively omitting information about certain groups or perspectives present in the source."
        if principle == "Security":
            return "Summarization models can be manipulated via prompt injection embedded in the document being summarized."
        if principle == "Privacy":
            return "Summarization models may reproduce PII from source documents verbatim in the summary, amplifying exposure."
        if principle == "Transparency":
            return "Summarization models should indicate when they have omitted information — users may assume a summary is complete when it isn't."
        if principle == "Explainability":
            return "Summarization model outputs should be traceable to specific source passages — without this, factual errors are impossible to verify."
        if principle == "Accountability":
            return "Summarization models used in high-stakes decisions (medical notes, legal documents) require human review of the summary."
        if principle == "Reliability":
            return "Summarization models can produce different summaries for the same document on different runs — consistency matters for regulated workflows."
        if principle == "Data Integrity":
            return "Summarization models can hallucinate facts not present in the source document — this is especially dangerous for technical or factual documents."
        if principle == "Safety":
            return "Summarization models can amplify harmful content from source documents rather than neutralising it."
        if principle == "Sustainability":
            return "Summarization models processing long documents consume significant tokens — chunking strategy and context window management affect cost."
        return ""