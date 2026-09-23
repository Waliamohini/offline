"""
app/services/report_definitions.py
=====================================
Shared static text used to describe TAF principles and sub-parameters.
Extracted out of app/routes/reports.py (the PDF-generation route) so this
data can be reused by app/services/report_persistence.py without pulling
reportlab (a heavy import) into every report-generation call.
"""

PRINCIPLE_DESCRIPTIONS = {
    "Fairness": (
        "AI solutions should be designed to reduce or eliminate bias against individuals, "
        "communities, and groups. Ongoing bias monitoring and equal error rates across groups "
        "must be maintained across the full AI model lifecycle."
    ),
    "Transparency": (
        "AI solutions should include responsible disclosure to provide stakeholders with a "
        "clear understanding of what is happening in each solution across the AI lifecycle, "
        "including training data, model architecture, known failure modes, and uncertainty levels."
    ),
    "Explainability": (
        "AI solutions should be developed and delivered in a way that answers the questions of how "
        "and why a conclusion was drawn from the solution. This includes local explanations, global "
        "model behaviour, and confidence quantification for all relevant stakeholders."
    ),
    "Accountability": (
        "Human oversight and responsibility should be embedded across the AI lifecycle to manage "
        "risk and comply with applicable laws and regulations. Clear governance structures, "
        "comprehensive audit trails, and escalation procedures must assign and enforce accountability."
    ),
    "Data Integrity": (
        "Data used in AI solutions should be acquired in compliance with applicable laws and "
        "assessed for accuracy, completeness, appropriateness, and quality to drive trusted "
        "decisions. Data provenance, deduplication, and schema enforcement must be maintained."
    ),
    "Reliability": (
        "AI solutions should consistently operate in accordance with their intended purpose and "
        "scope and at the desired level of precision. Performance degradation, failures, and "
        "edge cases must be actively monitored and SLA compliance maintained."
    ),
    "Security": (
        "Robust and resilient practices should be implemented to safeguard AI solutions against "
        "bad actors, misinformation, or adverse events. A defence-in-depth approach covering "
        "input validation, output filtering, adversarial robustness, and continuous red-teaming."
    ),
    "Safety": (
        "AI solutions should be designed and implemented to safeguard against harm to people, "
        "businesses, and property. Safety must be embedded across the full AI lifecycle through "
        "proactive risk assessment, harm prevention controls, and human override mechanisms."
    ),
    "Privacy": (
        "AI solutions should be designed to comply with applicable privacy and data protection "
        "laws and regulations. Data minimisation, purpose limitation, consent management, "
        "anonymisation, and right-to-erasure must be embedded by design."
    ),
    "Sustainability": (
        "AI solutions should be designed to be energy efficient, reduce carbon emissions, and "
        "support a cleaner environment. Efficient model architectures, optimised training and "
        "inference pipelines, and responsible resource allocation reduce climate impact."
    ),
}

# ─── Extended sub-parameter definitions ──────────────────────────────────────
SUB_PARAMETER_DEFINITIONS = {
    # Fairness
    "Compression Equity Across Topics": (
        "Measures whether the AI model applies consistent summarisation depth and quality across "
        "different subject domains and topic categories. A high score confirms that no topic area "
        "receives preferential treatment or is systematically under-served in the model's outputs."
    ),
    "Output Length Equity": (
        "Evaluates whether responses are proportionally sized relative to input complexity, "
        "regardless of which user group or query type initiated the request. Disparate output "
        "lengths may signal that certain inputs are deprioritised or under-resourced."
    ),
    "Source Representativeness": (
        "Assesses the diversity and breadth of training or reference data sources. A high score "
        "indicates that the AI draws from a wide range of representative corpora, reducing the "
        "risk of encoded historical bias or skewed world-views in generated content."
    ),
    "Fairness Monitoring Signals": (
        "Checks for the presence of active runtime mechanisms that detect and flag unfair outcomes "
        "during live inference. This includes bias dashboards, disparity alerts, periodic sampling "
        "audits, and automated equalised-odds checks across demographic dimensions."
    ),
    # Transparency
    "Source Document Coverage": (
        "Quantifies what percentage of input documents or data sources are explicitly acknowledged "
        "and cited in the AI's outputs. High coverage ensures stakeholders can trace claims back "
        "to their origin, supporting audit trails and reducing the risk of unverifiable assertions."
    ),
    "Compression Ratio Transparency": (
        "Evaluates whether the system discloses how much information reduction occurs between "
        "source material and generated output. This is critical for users to understand the risk "
        "of information loss and to calibrate their reliance on AI-generated summaries."
    ),
    "Reference Summary Logging": (
        "Checks whether human-authored reference summaries are stored alongside model outputs for "
        "supervised quality evaluation. Without reference logs, it is impossible to quantify "
        "abstraction quality or validate that the model meets accuracy benchmarks over time."
    ),
    "Model Versioning": (
        "Verifies that every inference output is tagged with the specific model version that "
        "produced it. Version tracking is essential for reproducing results, conducting root-cause "
        "analysis on regressions, and ensuring compliance with audit obligations."
    ),
    # Explainability
    "Faithfulness to Source": (
        "Measures the semantic alignment between model outputs and the factual content of source "
        "documents. Faithful outputs do not introduce hallucinated facts, unsupported inferences, "
        "or misleading paraphrases. This is calculated using entailment scoring and ROUGE overlap."
    ),
    "Abstractiveness Balance": (
        "Evaluates the optimal trade-off between extractive quotation (copying verbatim) and "
        "abstractive paraphrasing. A well-balanced model produces outputs that are readable and "
        "novel while remaining factually grounded in the source material."
    ),
    "ROUGE-L Alignment": (
        "Recall-Oriented Understudy for Gisting Evaluation — Longest Common Subsequence (ROUGE-L) "
        "measures the longest matching token sequence between generated and reference text. "
        "Higher scores correlate with better information preservation and structural similarity."
    ),
    "Summary Readability": (
        "Assesses the linguistic accessibility of AI-generated outputs using readability metrics "
        "such as Flesch Reading Ease, Gunning Fog Index, and sentence length distribution. "
        "Outputs should be comprehensible to the intended audience without specialist knowledge."
    ),
    # Accountability
    "Reference Summary Coverage": (
        "Measures the proportion of model outputs that have a paired human-authored reference "
        "for quality benchmarking. Without reference coverage, there is no mechanism for "
        "systematically identifying errors, establishing performance baselines, or running "
        "comparative evaluations across model versions."
    ),
    "Human Review Escalation": (
        "Verifies that formal pathways exist for escalating AI outputs to human reviewers when "
        "confidence falls below a threshold, when sensitive topics are detected, or when outputs "
        "have high-stakes downstream consequences. Clear escalation procedures are a governance "
        "requirement under EU AI Act Article 14."
    ),
    "Error & Limitation Logging": (
        "Checks whether system errors, model limitations, and known failure modes are systematically "
        "recorded in a structured log accessible to governance teams. Comprehensive error logging "
        "is fundamental to incident management, continuous improvement, and regulatory audit readiness."
    ),
    "Audit Trail Coverage": (
        "Evaluates the completeness of the end-to-end audit trail, from data ingestion through "
        "inference to output delivery. A complete audit trail records who initiated each request, "
        "what data was used, which model version responded, and what output was delivered — "
        "enabling full accountability reconstruction."
    ),
    # Data Integrity
    "Summary Completeness": (
        "Measures whether AI-generated outputs capture all key information points from the source "
        "material without critical omissions. Evaluated against ROUGE-1 recall scores and "
        "information coverage metrics. Incomplete summaries risk misleading downstream decisions."
    ),
    "ROUGE-1 Quality": (
        "ROUGE-1 measures unigram (single-word) overlap between generated and reference text. "
        "It is a proxy for information recall at the lexical level. Low ROUGE-1 scores indicate "
        "that key terms and concepts from the source are being systematically omitted."
    ),
    "BLEU Score Quality": (
        "Bilingual Evaluation Understudy (BLEU) measures n-gram precision between model outputs "
        "and human references. Originally designed for machine translation, BLEU in summarisation "
        "contexts rewards outputs that closely match reference phrasing and vocabulary patterns."
    ),
    "Format Consistency": (
        "Assesses whether model outputs consistently adhere to expected structural formats — "
        "including length constraints, section headings, bullet structures, and schema compliance. "
        "Inconsistent formatting impairs downstream automation and user trust."
    ),
    # Reliability
    "Faithfulness Stability": (
        "Evaluates whether the model produces consistently faithful outputs across repeated runs "
        "on identical inputs. High variance in faithfulness indicates non-deterministic behaviour "
        "that undermines reliability guarantees and makes SLA commitments difficult to enforce."
    ),
    "Summary Output Consistency": (
        "Measures the degree to which the model produces structurally and semantically similar "
        "outputs when presented with equivalent inputs across different sessions, time periods, "
        "or deployment environments. Consistency is foundational for production reliability."
    ),
    "ROUGE-L Consistency": (
        "Tracks the variance in ROUGE-L scores across inference runs on a fixed test set. "
        "Low variance indicates that the model's token-sequence alignment with references is "
        "stable and predictable, supporting performance SLA management."
    ),
    "BERTScore Semantic Consistency": (
        "Uses BERT contextual embeddings to measure semantic similarity between generated and "
        "reference outputs. BERTScore captures meaning-level alignment beyond surface lexical "
        "overlap, providing a more robust reliability signal for paraphrastic or abstractive models."
    ),
    # Security
    "Source Document Injection Rate": (
        "Measures the frequency of successful prompt injection attempts via maliciously crafted "
        "input documents. A low injection rate confirms that the model and its surrounding "
        "infrastructure apply robust input sanitisation and output filtering."
    ),
    "Harmful Content in Summaries": (
        "Evaluates the rate at which model outputs contain harmful, offensive, defamatory, or "
        "policy-violating content. Assessed using content moderation classifiers, keyword blocklists, "
        "and human spot-checking protocols. High scores require zero-tolerance guardrails."
    ),
    "PII in Summaries": (
        "Checks whether personally identifiable information (PII) from source documents is "
        "inadvertently reproduced in model outputs. PII leakage represents a privacy and security "
        "breach with direct regulatory consequences under GDPR, CCPA, and DPDP Act 2023."
    ),
    "Input Anomaly Rate": (
        "Monitors the proportion of incoming requests that exhibit anomalous patterns — such as "
        "unusually long inputs, repeated adversarial sequences, encoding exploits, or statistical "
        "outliers. High anomaly rates may indicate active attacks or systematic misuse."
    ),
    # Safety
    "Faithfulness as Safety Guard": (
        "Treats high faithfulness scores as a safety proxy: a model that stays close to source "
        "material is less likely to generate dangerous hallucinations, fabricated medical advice, "
        "or misleading factual claims. Faithfulness monitoring therefore serves a dual governance role."
    ),
    "Hallucinated Facts Prevention": (
        "Measures the rate at which the model generates factual claims not supported by source "
        "documents. Hallucination detection employs NLI (Natural Language Inference) models, "
        "entity verification, and knowledge-base cross-referencing. Zero-tolerance is required "
        "in high-stakes domains such as healthcare, legal, and financial services."
    ),
    "Human Override Capability": (
        "Verifies that human operators can intervene to halt, modify, or reverse AI decisions "
        "at any point in the inference pipeline. Override mechanisms must be accessible without "
        "specialist knowledge and must take effect within operationally acceptable timeframes."
    ),
    "Harmful Summary Rate": (
        "Tracks the proportion of outputs that could cause direct or indirect harm if acted upon "
        "by end users. Harm categories include: medical misinformation, legal misrepresentation, "
        "financial fraud facilitation, and content that could endanger vulnerable individuals."
    ),
    # Privacy
    "PII Leakage from Source Docs": (
        "Quantifies how frequently source document PII (names, addresses, identification numbers, "
        "biometric references) appears in generated outputs. Even partial PII reproduction can "
        "constitute a data breach. Requires differential privacy techniques or pre-processing "
        "anonymisation pipelines before documents enter the inference system."
    ),
    "Summary Data Minimisation": (
        "Evaluates whether AI outputs contain only the minimum personal data necessary to fulfil "
        "the stated purpose. Data minimisation is a foundational GDPR principle (Article 5(1)(c)) "
        "and must be actively enforced through output filtering, not assumed by default."
    ),
    "Anonymisation in Summaries": (
        "Checks the effectiveness of anonymisation techniques applied to personal data before "
        "or during summarisation. Evaluates k-anonymity, l-diversity, and pseudonymisation "
        "mechanisms. Ineffective anonymisation may be re-identifiable and remains subject to "
        "data protection obligations."
    ),
    "Sensitive Content Retention": (
        "Measures how long sensitive or personal content is retained within the AI system's "
        "processing pipeline, caches, and logs after a request is completed. Retention beyond "
        "the stated purpose violates data minimisation principles and creates unnecessary breach risk."
    ),
    # Sustainability
    "Compression Efficiency": (
        "Evaluates the ratio of meaningful information preserved relative to computational "
        "resources expended during inference. High compression efficiency means the model "
        "delivers high information density per GPU cycle, reducing both cost and carbon footprint."
    ),
    "Non-Redundancy Score": (
        "Measures the degree to which generated outputs avoid unnecessary repetition of "
        "information already stated. Redundant outputs consume storage, bandwidth, and reader "
        "attention — all of which have environmental and economic costs at scale."
    ),
    "Intra-Summary Redundancy": (
        "Evaluates whether individual outputs contain self-referential repetition within a single "
        "document. High intra-summary redundancy degrades user experience and inflates token "
        "consumption, increasing inference costs and emissions."
    ),
    "Cross-Summary Deduplication": (
        "Checks whether the system eliminates duplicate content across multiple outputs generated "
        "from overlapping source documents. Effective deduplication reduces storage requirements "
        "and prevents the same information being processed multiple times unnecessarily."
    ),
}