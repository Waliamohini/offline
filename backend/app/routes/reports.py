from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from reportlab.lib.pagesizes import A4
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether, Image as RLImage
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm, inch
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Circle, Wedge
from reportlab.graphics import renderPDF, renderPM


def _drawing_to_image(drawing, width, height, scale=2):
    """Render a Drawing to a PNG BytesIO at 2x scale for crispness."""
    buf = BytesIO()
    renderPM.drawToFile(drawing, buf, fmt='PNG', dpi=144)
    buf.seek(0)
    return RLImage(buf, width=width, height=height)
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.piecharts import Pie
from io import BytesIO
import datetime
import math

from app.database import reports_collection
from app.dependencies import get_current_user

router = APIRouter(tags=["reports"])


@router.get("/{report_id}/judge-panel")
def get_judge_panel(report_id: str, current_user=Depends(get_current_user)):
    """
    Returns the full LLM judge panel deliberation for one report: one entry
    per row judged, each with the input/output text, the majority verdict,
    and every individual judge's vote + reason + latency_ms — the data that
    run_llm_judge() computes but that reports.llm_judge (the aggregate JSONB
    blob) never persisted before report_persistence.py started writing
    llm_judge_row_verdicts / llm_judge_votes.
    """
    from app.database import reports_collection, llm_judge_row_verdicts_collection, llm_judge_votes_collection

    owner_id = str(current_user["_id"])
    report = reports_collection.find_one({"report_id": report_id, "owner_id": owner_id})
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")

    verdicts = llm_judge_row_verdicts_collection.find(
        {"report_id": report["id"], "owner_id": owner_id},
        sort=[("row_index", 1)],
    )

    rows_out = []
    for v in verdicts:
        votes = llm_judge_votes_collection.find({"row_verdict_id": v["id"]})
        rows_out.append({
            "row_index":     v.get("row_index"),
            "task_id":       v.get("task_id"),
            "input":         v.get("input"),
            "output":        v.get("output"),
            "final_correct": v.get("final_correct"),
            "confidence":    v.get("confidence"),
            "disputed":      v.get("disputed"),
            "kb_used":       v.get("kb_used"),
            "judges": [
                {
                    "judge_name": vt.get("judge_name"),
                    "vote":       vt.get("vote"),
                    "reason":     vt.get("reason"),
                    "latency_ms": vt.get("latency_ms"),
                }
                for vt in votes
            ],
        })

    return {"report_id": report_id, "rows": rows_out, "total": len(rows_out)}


@router.get("/{report_id}/sub-parameters")
def get_sub_parameters(report_id: str, current_user=Depends(get_current_user)):
    """
    Returns the 40 KPMG TAF sub-parameters computed for this report as real
    rows (score, definition, engine tier) instead of the flat
    {name: score} dict buried inside reports.trusted_ai_principles.
    """
    from app.database import reports_collection, report_sub_parameters_collection

    owner_id = str(current_user["_id"])
    report = reports_collection.find_one({"report_id": report_id, "owner_id": owner_id})
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")

    rows = report_sub_parameters_collection.find(
        {"report_id": report["id"], "owner_id": owner_id},
        sort=[("principle", 1)],
    )
    return {
        "report_id": report_id,
        "rows": [
            {
                "principle":     r.get("principle"),
                "sub_parameter": r.get("sub_parameter"),
                "score":         r.get("score"),
                "definition":    r.get("definition"),
                "engine":        r.get("engine"),
            }
            for r in rows
        ],
        "total": len(rows),
    }


@router.get("/{report_id}/taxonomy-controls")
def get_taxonomy_controls(report_id: str, current_user=Depends(get_current_user)):
    """
    Returns one row per Control Matrix ID (GAI.FAIR.01, PD.SEC.01, etc.) for
    this report/audit — the normalized replacement for the single JSONB
    `rows` array previously stored on taf_assessments.
    """
    from app.database import reports_collection, report_taxonomy_controls_collection

    owner_id = str(current_user["_id"])
    report = reports_collection.find_one({"report_id": report_id, "owner_id": owner_id})
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")

    rows = report_taxonomy_controls_collection.find(
        {"report_id": report["id"], "owner_id": owner_id},
        sort=[("numbered_id", 1)],
    )
    return {
        "report_id": report_id,
        "rows": [
            {
                "numbered_id":      r.get("numbered_id"),
                "category":         r.get("category"),
                "category_full":    r.get("category_full"),
                "pillar":           r.get("pillar"),
                "risk_description": r.get("risk_description"),
                "test_description": r.get("test_description"),
                "base_mapped":      r.get("base_mapped"),
                "computed_status":  r.get("computed_status"),
                "evidence":         r.get("evidence"),
                "score":            r.get("score"),
                "score_source":     r.get("score_source"),
                "training_gated":   r.get("training_gated"),
                "evidence_chain":   r.get("evidence_chain"),
                "data_required":    r.get("data_required"),
            }
            for r in rows
        ],
        "total": len(rows),
    }


@router.get("/{report_id}/framework-compliance")
def get_framework_compliance(report_id: str, current_user=Depends(get_current_user)):
    """
    Returns regulatory/framework alignment (EU AI Act, ISO 42001, NIST AI
    RMF, KPMG TAF) as normalized rows, each with its own principle-level
    score breakdown — the replacement for the framework_compliance dict
    embedded in the report JSONB.
    """
    from app.database import (
        reports_collection,
        report_framework_compliance_collection,
        report_framework_principle_scores_collection,
    )

    owner_id = str(current_user["_id"])
    report = reports_collection.find_one({"report_id": report_id, "owner_id": owner_id})
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")

    fw_rows = report_framework_compliance_collection.find({"report_id": report["id"], "owner_id": owner_id})

    rows_out = []
    for fw in fw_rows:
        pscores = report_framework_principle_scores_collection.find({"framework_compliance_id": fw["id"]})
        rows_out.append({
            "framework":      fw.get("framework"),
            "status":         fw.get("status"),
            "overall_score":  fw.get("overall_score"),
            "threshold":      fw.get("threshold"),
            "principle_scores": [
                {"principle": p.get("principle"), "score": p.get("score")}
                for p in pscores
            ],
        })

    return {"report_id": report_id, "frameworks": rows_out, "total": len(rows_out)}

# ─── KPMG Brand Colours ──────────────────────────────────────────────────────
KPMG_BLUE       = colors.HexColor("#00338D")
KPMG_TEAL       = colors.HexColor("#00C896")
KPMG_LIGHT_BLUE = colors.HexColor("#0091DA")
KPMG_DARK       = colors.HexColor("#050d1a")
KPMG_GREY       = colors.HexColor("#6B7280")
KPMG_LIGHT_GREY = colors.HexColor("#F3F4F6")
KPMG_MID_GREY   = colors.HexColor("#E5E7EB")
KPMG_WHITE      = colors.white
KPMG_RED        = colors.HexColor("#DC2626")
KPMG_AMBER      = colors.HexColor("#D97706")
KPMG_GREEN      = colors.HexColor("#059669")
# Standardized band colors — matches the frontend scheme: grey for low/critical,
# blue for watch/partial, green for strong/good. KPMG_RED/KPMG_AMBER above are
# kept only for any genuine warning/alert callouts that aren't score bands.
KPMG_SLATE      = colors.HexColor("#64748B")
KPMG_DARK_SLATE = colors.HexColor("#475569")
KPMG_WATCH_BLUE = colors.HexColor("#2563EB")

PRINCIPLE_COLORS = {
    "Fairness":       "#00338D",
    "Transparency":   "#005EB8",
    "Explainability": "#0091DA",
    "Accountability": "#00338D",
    "Data Integrity": "#005EB8",
    "Reliability":    "#0091DA",
    "Security":       "#00338D",
    "Safety":         "#005EB8",
    "Privacy":        "#0091DA",
    "Sustainability":  "#00338D",
}

PRINCIPLE_ICONS = {
    "Fairness":       "F",
    "Transparency":   "T",
    "Explainability": "E",
    "Accountability": "A",
    "Data Integrity": "D",
    "Reliability":    "R",
    "Security":       "Se",
    "Safety":         "Sa",
    "Privacy":        "P",
    "Sustainability":  "Su",
}

from app.services.report_definitions import PRINCIPLE_DESCRIPTIONS, SUB_PARAMETER_DEFINITIONS


def score_to_color(score: int) -> colors.Color:
    if score >= 75:
        return KPMG_GREEN          # #059669 — matches frontend "Strong"
    elif score >= 50:
        return KPMG_WATCH_BLUE     # #2563EB — matches frontend "Watch"
    else:
        return KPMG_SLATE          # #64748B — matches frontend "Weak"


def score_to_label(score: int) -> str:
    if score >= 75:
        return "Strong"
    elif score >= 50:
        return "Watch"
    else:
        return "Weak"


def risk_color(level: str) -> colors.Color:
    return {
        "Low": KPMG_GREEN,
        "Moderate": KPMG_WATCH_BLUE,
        "High": KPMG_SLATE,
        "Critical": KPMG_DARK_SLATE,
    }.get(level, KPMG_GREY)


def _pct(value: float) -> str:
    return f"{round(value * 100)}%"


def _derive_parameter_context(report: dict) -> dict:
    diagnostics = report.get("diagnostics", {}) or {}
    logs_count = report.get("logs_evaluated", 0) or 0
    total_cols = diagnostics.get("total_columns", 1) or 1
    text_cols = diagnostics.get("text_columns", 0) or 0
    numeric_cols = diagnostics.get("numeric_columns", 0) or 0
    schema_conf = diagnostics.get("schema_confidence", 0) or 0
    missing_ratio = diagnostics.get("missing_ratio", 0) or 0
    duplicates = diagnostics.get("duplicates", 0) or 0
    column_names = [str(c).lower() for c in diagnostics.get("column_names", [])]

    def has_any(keys):
        return any(k in column_names for k in keys)

    def clamp(v: float) -> int:
        return max(0, min(100, int(round(v))))

    return {
        "diagnostics": diagnostics,
        "logs_count": logs_count,
        "total_cols": total_cols,
        "text_cols": text_cols,
        "numeric_cols": numeric_cols,
        "schema_score": clamp(schema_conf * 100),
        "completeness": clamp((1 - missing_ratio) * 100),
        "duplicate_penalty": clamp(max(0, 100 - (duplicates / max(logs_count, 1)) * 500)),
        "volume_score": clamp(min(logs_count / 100 * 100, 100)),
        "column_diversity": clamp(min(total_cols / 10 * 100, 100)),
        "has_input": has_any(["input", "prompt", "query", "text", "question"]),
        "has_output": has_any(["output", "response", "answer", "prediction", "result"]),
        "has_label": has_any(["label", "class", "target", "ground_truth"]),
        "has_timestamp": has_any(["timestamp", "date", "time", "created_at"]),
        "has_user_id": has_any(["user_id", "user", "session_id", "session"]),
        "has_score": has_any(["score", "confidence", "probability", "prob"]),
        "has_feedback": has_any(["feedback", "rating", "review", "human_eval"]),
        "has_safety": has_any(["is_safe", "safety", "flagged", "moderated"]),
        "has_pii": has_any(["contains_pii", "pii", "personal"]),
        "has_version": has_any(["model_version", "version", "model_id"]),
        "has_latency": has_any(["latency", "response_time", "duration"]),
        "has_error": has_any(["error", "exception", "failed"]),
        "has_halluc": has_any(["hallucination", "faithfulness", "groundedness"]),
        "has_rouge": has_any(["rouge", "bleu", "meteor", "bertscore"]),
        "model_type": report.get("model_type", "N/A"),
    }


def _parameter_explanation(param: str, report: dict) -> tuple[str, str]:
    """
    Returns (definition, calculation) for each sub-parameter.
    Definition: a rich governance explanation for a CEO-level reader.
    Calculation: the formula used to derive the score from the dataset.
    """
    c = _derive_parameter_context(report)
    io_bonus = 20 if (c["has_input"] and c["has_output"]) else (10 if (c["has_input"] or c["has_output"]) else 0)
    model_bonus = 80 if c["model_type"] == "classification" else 60
    missing_pct = _pct(c['diagnostics'].get('missing_ratio', 0) or 0)
    details = {
        # ── FAIRNESS ─────────────────────────────────────────────────────────────
        "Class Balance in Detections": (
            "Measures whether the AI system produces outputs that are proportionally distributed across all target classes "
            "or categories. Imbalanced class detections can indicate systemic bias, where the model disproportionately "
            "favours or penalises certain groups. Sustained imbalance in production can lead to regulatory scrutiny under "
            "the EU AI Act and discriminatory outcomes in high-stakes decisions.",
            "Derived from class distribution analysis across detection outputs in the ingested dataset."
        ),
        "Detection Equity Across Groups": (
            "Evaluates whether the AI system's detection accuracy, precision, and recall are statistically consistent "
            "across identifiable demographic or categorical groups. Unequal error rates across groups constitute "
            "algorithmic discrimination. This parameter is directly referenced in the EU AI Act Article 10 and ISO/IEC "
            "42001 Clause 6.1.2 as a mandatory governance check before deployment.",
            "Derived from error-rate and detection-rate stratification across available group signals in the dataset."
        ),
        "Label Class Representativeness": (
            "Assesses whether the training or evaluation labels adequately represent the real-world distribution of "
            "outcomes the AI system is intended to address. Under-representation of minority classes leads to systematic "
            "underperformance on those groups, often invisible in aggregate accuracy metrics. Organisations must ensure "
            "training data diversity is documented and verifiable for audit purposes.",
            "Computed from label class distribution entropy and comparison against expected population-level baselines."
        ),
        "Fairness Monitoring Signals": (
            "Determines whether the deployed system has active mechanisms for continuous bias monitoring post-deployment. "
            "Point-in-time fairness assessments are insufficient — regulatory frameworks now require ongoing monitoring "
            "with automated alerting when fairness drift exceeds defined thresholds. Absence of monitoring signals is "
            "flagged as a priority improvement area by KPMG Trusted AI auditors.",
            "100 if fairness monitoring fields (feedback, demographic_group, protected_attribute) are present; else 0."
        ),
        "Bias Indicator Fields": (
            "Checks for the presence of structured fields that enable bias tracking over time — including demographic "
            "identifiers, group labels, protected attributes, or human evaluation feedback. Without these fields, it is "
            "impossible to retrospectively investigate discriminatory outcomes or respond to regulatory enquiries. Their "
            "presence demonstrates proactive governance rather than reactive compliance.",
            "100 with feedback/demographic fields; 60 with labels only; 30 with no identifiable bias-tracking fields."
        ),
        "Missing Data Equity": (
            "Examines whether missing data is distributed uniformly across the dataset or whether it is concentrated "
            "in specific groups or categories. Non-random missingness (MNAR — Missing Not At Random) disproportionately "
            "impacts underrepresented groups and can introduce silent bias into model outputs. This parameter penalises "
            "datasets where high overall missingness compromises fairness confidence.",
            f"clamp((1 - missing_ratio {missing_pct} x 2) x 100) — heavy missing data reduces fairness assurance."
        ),
        "Label Balance": (
            "Measures whether ground truth labels are available and balanced across the dataset. Datasets without "
            "labels cannot be audited for bias, accuracy, or fairness. Labelled data with extreme class imbalance "
            "(e.g., 95%/5% splits) requires resampling, class weighting, or stratified evaluation to prevent "
            "misleading aggregate metrics from masking poor performance on minority classes.",
            "80 if label/target field is present; 50 otherwise. Penalised for extreme imbalance if detected."
        ),
        "Demographic Coverage": (
            "Estimates the breadth of demographic or categorical coverage in the dataset, using the ratio of "
            "text-type columns as a structural proxy for group-level metadata. Rich text fields often encode "
            "demographic context that supports fairness analysis. Low coverage signals that the dataset may "
            "be insufficiently diverse for equitable governance assessment.",
            f"clamp(60 + (text_columns {c['text_cols']} / total_columns {c['total_cols']}) x 40)"
        ),
        # ── TRANSPARENCY ─────────────────────────────────────────────────────────
        "Schema Confidence": (
            "Quantifies how reliably the dataset's structure could be inferred — including field types, naming "
            "conventions, and column consistency. High schema confidence indicates a well-governed data pipeline "
            "with enforced contracts. Low schema confidence suggests ad-hoc or undocumented data flows, making "
            "it difficult to trace model inputs and provide meaningful stakeholder disclosure.",
            f"schema_confidence ({_pct(c['diagnostics'].get('schema_confidence', 0) or 0)}) x 100 = {c['schema_score']}"
        ),
        "Field Documentation": (
            "Assesses whether the dataset includes clearly defined input, output, and contextual fields — the "
            "minimum documentation required to explain AI behaviour to stakeholders. Undocumented fields impede "
            "the creation of model cards, data sheets, and regulatory disclosures. Well-documented schemas "
            "directly support EU AI Act Article 13 transparency obligations.",
            f"clamp(io_bonus {io_bonus} x 4 + schema_score {c['schema_score']} x 0.2)"
        ),
        "Confidence Score Disclosure": (
            "Determines whether the AI system exposes its output confidence or probability scores to downstream "
            "stakeholders. Confidence disclosure is foundational to transparent AI — it allows users to calibrate "
            "their trust in individual predictions and enables human-in-the-loop review for borderline decisions. "
            "Concealing confidence scores from users is considered a transparency violation under NIST AI RMF.",
            "100 if confidence/probability score field is present in the dataset; 40 otherwise."
        ),
        "Bounding Box / Label Visibility": (
            "For object detection and image classification systems, this parameter verifies that spatial detection "
            "results (bounding boxes, segmentation masks, class labels) are explicitly included in the output record. "
            "Without visible, structured output representations, it is impossible for users or auditors to validate "
            "what the model detected, where, and with what degree of confidence.",
            "100 if bounding box / label output fields are present in the evaluation records; else 0."
        ),
        "Detection Result Logging": (
            "Verifies that each inference event is systematically logged with sufficient detail to support post-hoc "
            "auditing. Logging must capture input identifiers, output predictions, confidence levels, model version, "
            "and timestamp at minimum. Incomplete logs prevent incident investigation, regulatory response, and "
            "continuous improvement. EU AI Act Article 12 mandates automatic logging for high-risk AI systems.",
            "100 if a comprehensive result log structure is detected in the dataset; 0 if logging is absent."
        ),
        "Model Version Tracking": (
            "Checks whether model predictions can be traced back to a specific, versioned model deployment. "
            "Version tracking is essential for reproducibility — if a model is updated, historical predictions "
            "must remain linkable to the version that produced them. Without this linkage, post-deployment "
            "incident investigation and regulatory accountability become impossible.",
            "100 if version/model_id field is present in the dataset; 30 otherwise."
        ),
        "Input/Output Coverage": (
            "Measures whether both the request (input) and response (output) of each AI interaction are captured "
            "in the logs. Complete input-output pairs are the minimum evidential standard for AI auditability. "
            "Systems that log only outputs cannot verify whether observed failures originated from input quality "
            "issues or model behaviour, complicating root-cause analysis and regulatory disclosure.",
            f"clamp(io_bonus {io_bonus} x 4.5) — based on presence of both input and output fields."
        ),
        "Column Completeness": (
            "Evaluates the breadth of documented fields relative to the full population of fields required for "
            "governance-grade logging. A narrow dataset with few columns may omit critical governance signals "
            "such as timestamps, user identifiers, or model metadata. This parameter blends field breadth with "
            "schema quality to reward well-structured, comprehensive logging designs.",
            f"clamp(column_diversity {c['column_diversity']} x 0.8 + schema_score {c['schema_score']} x 0.2)"
        ),
        # ── EXPLAINABILITY ────────────────────────────────────────────────────────
        "Model Interpretability": (
            "Uses the model family and architecture type as a structural proxy for inherent interpretability. "
            "Linear models, decision trees, and rule-based systems provide native explainability; deep learning "
            "and ensemble methods require additional explainability tooling (SHAP, LIME, attention maps) to "
            "satisfy governance requirements. Model type is a critical disclosure item for all stakeholder levels.",
            f"{model_bonus} based on detected model type — higher for interpretable architectures."
        ),
        "Prediction Confidence": (
            "Verifies that each AI prediction is accompanied by a machine-readable confidence or probability score "
            "that quantifies the model's certainty. Confidence scores enable human reviewers to identify borderline "
            "predictions warranting closer inspection and allow downstream systems to implement dynamic thresholds "
            "for human escalation. Their absence forces binary pass/fail decisions without nuance.",
            "100 if confidence/probability field exists in the dataset; 40 otherwise."
        ),
        "Reasoning Documentation": (
            "Assesses whether the AI system produces or logs structured reasoning artefacts — such as attention "
            "weights, feature importance scores, chain-of-thought outputs, hallucination scores, or faithfulness "
            "metrics. These artefacts allow technical and non-technical stakeholders to understand why a specific "
            "prediction was made, meeting explainability obligations under ISO/IEC 42001 Clause 9.1.",
            "100 with hallucination/faithfulness fields; 60 with ROUGE/BLEU metrics; 35 otherwise."
        ),
        "Feedback Integration": (
            "Checks whether structured human feedback (ratings, corrections, binary approval signals) is captured "
            "alongside model predictions. Human feedback loops are the primary mechanism for continuous explainability "
            "improvement — they surface cases where model outputs are plausible but incorrect, enabling targeted "
            "retraining and governance-level evidence of quality assurance.",
            "100 if feedback/rating field is present; 30 otherwise."
        ),
        "Output Traceability": (
            "Measures whether each AI output can be traced end-to-end from input through prediction to the "
            "downstream action taken. Full traceability creates an evidential chain that regulators, auditors, "
            "and affected parties can follow. Without it, organisations cannot demonstrate that AI-influenced "
            "decisions were made transparently, undermining both compliance and public trust.",
            f"clamp(io_bonus {io_bonus} x 4 + {'20' if c['has_score'] else '0'} confidence bonus)"
        ),
        "Confidence Calibration": (
            "Evaluates whether the AI system's stated confidence scores accurately reflect its empirical accuracy — "
            "a property known as calibration. A well-calibrated model that reports 80% confidence should be correct "
            "approximately 80% of the time across a large sample. Poorly calibrated systems produce overconfident "
            "or underconfident predictions, misguiding human reviewers and causing systematic decision errors.",
            "Derived from comparison of confidence score distribution against observed accuracy in the dataset."
        ),
        "mAP-IoU Alignment": (
            "For object detection systems, Mean Average Precision (mAP) and Intersection over Union (IoU) must be "
            "aligned — high mAP with low IoU indicates the model detects correct categories but localises them "
            "imprecisely. Misalignment between these metrics signals a calibration issue that can undermine "
            "safety-critical applications such as medical imaging, surveillance, and autonomous systems.",
            "Computed from structural alignment between mAP and IoU score fields in the evaluation records."
        ),
        "Label Coverage for Validation": (
            "Measures the percentage of dataset records that carry a ground truth label usable for validation. "
            "Unlabelled records cannot contribute to accuracy, fairness, or safety assessments — they represent "
            "a governance blind spot. High label coverage provides confidence that evaluation metrics are "
            "computed on a representative, complete sample rather than a biased subset.",
            "Proportion of records with non-null label/ground_truth fields relative to total records evaluated."
        ),
        "Detection Output Readability": (
            "Assesses whether detection outputs are structured in a human-readable format that non-technical "
            "stakeholders can interpret without specialist tooling. Outputs must include plain-language labels, "
            "bounding box coordinates (where applicable), and confidence scores in standard units. Cryptic "
            "or numeric-only outputs block effective human oversight and violate EU AI Act Article 13.",
            "Derived from output field structure — penalised for numeric-only or unstructured output formats."
        ),
        # ── ACCOUNTABILITY ────────────────────────────────────────────────────────
        "Ground Truth Annotation Coverage": (
            "Measures whether the dataset contains verified ground truth annotations for a sufficient proportion "
            "of records. Ground truth is the foundational evidence required to demonstrate model accuracy, detect "
            "errors, and assign accountability for incorrect outputs. Without it, no meaningful performance claim "
            "can be substantiated — and no regulatory audit can be completed with confidence.",
            "100 if ground_truth/annotation field is present and >80% populated; proportional score otherwise."
        ),
        "Human Review on Low Confidence": (
            "Checks whether the system has a defined, enforced pathway for routing low-confidence predictions to "
            "human reviewers before any consequential action is taken. This is one of the most critical accountability "
            "controls — automated systems must know their limits and escalate appropriately. Its absence means "
            "the model operates autonomously even when its own outputs are uncertain.",
            "100 if human_review/escalation field is present alongside confidence threshold fields; 0 otherwise."
        ),
        "Error & Misdetection Logging": (
            "Verifies that system errors, false positives, false negatives, and misdetections are explicitly "
            "captured in a dedicated, structured log. Error logging is the primary mechanism for accountability "
            "— it creates an immutable record of system failures that can be reviewed by auditors, regulators, "
            "and affected parties. It also supports root-cause analysis and continuous improvement cycles.",
            "100 if error/exception/misdetection field is present and populated; 0 if absent."
        ),
        "Audit Trail Coverage": (
            "Assesses the completeness of the system's end-to-end audit trail — the chronological record of all "
            "AI-driven decisions, including timestamps, user identifiers, model versions, inputs, and outputs. "
            "A complete audit trail is mandated by the EU AI Act for high-risk systems and is the primary "
            "mechanism by which organisations demonstrate accountability to external regulators.",
            "Derived from timestamp, user_id, and model_version field coverage across the dataset records."
        ),
        "Audit Log Volume": (
            "Uses the volume of logged records as a proxy for the operational maturity of the audit function. "
            "Organisations that log comprehensively generate large, structured datasets that can support robust "
            "statistical analysis, trend detection, and anomaly identification. Small log volumes may indicate "
            "selective logging — a red flag for governance auditors.",
            f"min(logs_evaluated {c['logs_count']} / 100 x 100, 100) = {c['volume_score']}"
        ),
        "Timestamp Coverage": (
            "Verifies that each AI event in the dataset is timestamped with sufficient precision to reconstruct "
            "the sequence of decisions over time. Timestamps are a prerequisite for chronological audit trails, "
            "regulatory incident reporting, and root-cause analysis. Missing timestamps make it impossible to "
            "determine when a specific AI decision was made — a fundamental accountability failure.",
            "100 if timestamp/date/created_at field is present; 20 otherwise."
        ),
        "User Attribution": (
            "Checks whether each AI event can be attributed to an identifiable user session, user ID, or "
            "organisational entity. Attribution is essential for accountability — it allows organisations to "
            "determine who initiated an AI-influenced decision, which system processed it, and which model "
            "version produced the output. Without attribution, accountability chains cannot be established.",
            "High score if user_id/session_id fields exist; graduated penalty for partial or absent attribution."
        ),
        "Model Version Control": (
            "Verifies that the model version or deployment identifier is recorded alongside each prediction. "
            "As models are updated, version control ensures that historical predictions remain traceable to the "
            "specific model that produced them. This is essential for post-deployment incident investigation, "
            "regulatory evidence submission, and comparing performance across model generations.",
            "100 if version/model_id field exists in the dataset; 30 otherwise."
        ),
        "Error/Exception Logging": (
            "Checks whether system exceptions, runtime errors, and processing failures are systematically "
            "captured in a structured format. Exception logging is not merely a technical best practice — "
            "it is a governance requirement. Unlogged failures create invisible accountability gaps and "
            "prevent organisations from demonstrating that error handling was in place at the time of an incident.",
            "100 if error/exception field is present and populated in the dataset; 35 otherwise."
        ),
        # ── DATA INTEGRITY ────────────────────────────────────────────────────────
        "Data Completeness": (
            "Measures the proportion of dataset records that are fully populated — with no missing values in "
            "critical fields. Incomplete records degrade model performance, introduce hidden biases, and "
            "undermine the reliability of any governance assessment performed on the data. High data "
            "completeness is a prerequisite for credible audit evidence and defensible regulatory submissions.",
            f"(1 - missing_ratio {missing_pct}) x 100 = {c['completeness']}"
        ),
        "Completeness Score": (
            "Measures the proportion of dataset records that are fully populated across all schema fields. "
            "Completeness is the most fundamental dimension of data quality — incomplete records cannot "
            "be reliably used for training, evaluation, or governance assessment. Organisations must "
            "implement automated completeness checks as part of their data pipeline governance.",
            f"(1 - missing_ratio {missing_pct}) x 100 = {c['completeness']}"
        ),
        "Duplicate-Free Rate": (
            "Quantifies the proportion of unique records in the dataset — penalising datasets with high "
            "rates of exact or near-exact duplicates. Duplicate records skew frequency-based metrics, "
            "inflate apparent data volume, and can introduce systematic bias if duplicates are concentrated "
            "in specific classes or groups. Deduplication is a mandatory step in governance-grade data pipelines.",
            f"clamp(100 - (duplicates {c['diagnostics'].get('duplicates', 0) or 0} / logs {max(c['logs_count'], 1)}) x 500) = {c['duplicate_penalty']}"
        ),
        "Schema Consistency": (
            "Evaluates whether the dataset adheres to a consistent, enforced schema across all records — "
            "including consistent field naming, data types, and value formats. Inconsistent schemas indicate "
            "weak data governance and can cause silent failures during model inference. Schema enforcement "
            "is a foundational requirement for defensible AI governance under ISO/IEC 42001.",
            f"schema_confidence ({_pct(c['diagnostics'].get('schema_confidence', 0) or 0)}) x 100 = {c['schema_score']}"
        ),
        "Data Type Diversity": (
            "Assesses whether the dataset contains a balanced mix of numeric and text-type fields — indicating "
            "a rich, multi-dimensional data structure capable of capturing the full complexity of the AI system's "
            "inputs and outputs. Datasets dominated by a single data type may lack the contextual richness "
            "required for comprehensive governance assessment.",
            f"balanced mix of numeric ({c['numeric_cols']}) and text ({c['text_cols']}) across {c['total_cols']} total columns"
        ),
        "Label Coverage Rate": (
            "Determines what proportion of records in the dataset carry a ground truth label or annotation. "
            "Label coverage directly constrains the scope of any evaluation — unlabelled records cannot "
            "contribute to accuracy, fairness, or bias assessments. A high label coverage rate signals "
            "a mature, well-governed annotation pipeline with rigorous quality assurance.",
            "Proportion of records with non-null label/class/ground_truth fields."
        ),
        "Annotation Quality Score": (
            "Evaluates the structural quality and consistency of annotations in the dataset, using field "
            "completeness, value distribution, and annotation schema adherence as proxies for quality. "
            "Poor annotation quality — including inconsistent labelling, ambiguous categories, or "
            "annotator disagreement — directly degrades model quality and governance defensibility.",
            "Derived from annotation field completeness, consistency, and schema adherence metrics."
        ),
        "Ground Truth Accuracy": (
            "Assesses how accurately the ground truth labels in the dataset reflect real-world reality — "
            "using statistical proxies such as label confidence distributions and cross-validation consistency. "
            "Ground truth errors propagate directly into model training and evaluation, creating invisible "
            "performance ceilings that cannot be overcome through model architecture improvements alone.",
            "Derived from label confidence distribution and cross-validation consistency signals."
        ),
        "Dataset Schema Consistency": (
            "Evaluates whether the dataset schema is uniformly applied across all records, time periods, "
            "and data sources contributing to the evaluation set. Schema drift — where field definitions "
            "or formats change across dataset versions — is a major source of silent data quality failures "
            "and a common root cause of model degradation in production environments.",
            "Derived from schema confidence score and field-level consistency analysis."
        ),
        # ── RELIABILITY ───────────────────────────────────────────────────────────
        "Consistency Score": (
            "Measures the overall consistency of the AI system's outputs — evaluating whether identical or "
            "near-identical inputs produce stable, predictable predictions over time. Inconsistency in "
            "production is a reliability failure that erodes user trust, complicates accountability, and "
            "may indicate underlying model instability, infrastructure issues, or data drift.",
            f"(1 - missing_ratio {missing_pct}) x 90 — completeness as a structural consistency proxy."
        ),
        "Performance Metrics": (
            "Verifies whether explicit performance metrics — such as accuracy, F1 score, precision, recall, "
            "or AUC — are recorded in the dataset. Performance metrics are the primary evidence used to "
            "demonstrate that the AI system meets its intended specifications. Their absence makes it "
            "impossible to objectively assess whether the system is operating within acceptable parameters.",
            "100 if performance/quality metrics fields exist in the dataset; 40 otherwise."
        ),
        "Latency Monitoring": (
            "Checks whether AI system response time (latency) is systematically measured and logged for "
            "each inference event. Latency is a critical reliability indicator — degraded response times "
            "can indicate infrastructure strain, model complexity issues, or approaching capacity limits. "
            "SLA compliance for AI systems typically requires latency monitoring at the inference level.",
            "100 if latency/response_time/duration field is present; 30 otherwise."
        ),
        "Error Rate Tracking": (
            "Measures whether the AI system maintains a structured record of error rates — including "
            "inference failures, timeout events, and output quality degradation events. Continuous error "
            "rate tracking enables proactive reliability management and provides the evidential basis "
            "for SLA compliance reporting and incident root-cause analysis.",
            "100 if error/failure rate tracking fields are present; derived from dataset structure otherwise."
        ),
        "Ground Truth Availability": (
            "Assesses whether sufficient ground truth data is available to evaluate the AI system's "
            "reliability against objective benchmarks. Without ground truth, reliability assessments "
            "are limited to proxy metrics — and cannot definitively establish whether the system "
            "is meeting its intended accuracy or recall targets in production.",
            "100 if labels or text-evaluation metrics exist; 40 otherwise."
        ),
        "Mean Average Precision (mAP)": (
            "Mean Average Precision is the primary accuracy metric for object detection systems, "
            "measuring the model's ability to correctly identify and localise objects across all "
            "categories and confidence thresholds. mAP integrates both precision and recall into "
            "a single score, making it the industry standard for comparing detection models. "
            "Low mAP in production indicates unacceptable detection quality for deployment.",
            "Computed from precision-recall curves across all detection classes at standard IoU thresholds."
        ),
        "Mean IoU Score": (
            "Mean Intersection over Union quantifies the spatial accuracy of object detection — "
            "measuring the overlap between predicted bounding boxes and ground truth annotations. "
            "An IoU of 1.0 represents a perfect match; values below 0.5 indicate imprecise "
            "localisation that may be unsafe for applications requiring precise spatial awareness, "
            "such as autonomous systems, medical image analysis, or document processing.",
            "Average IoU computed across all matched detection pairs in the evaluation dataset."
        ),
        "Top-K Accuracy": (
            "Top-K Accuracy measures whether the correct class appears among the model's top K "
            "predictions — a more lenient metric than top-1 accuracy appropriate for complex "
            "multi-class scenarios. High Top-K Accuracy with low Top-1 Accuracy may indicate "
            "that the model is directionally correct but insufficiently decisive, which can be "
            "problematic in automated decision pipelines that rely on single-best predictions.",
            "Proportion of records where the ground truth label appears in the top-K predicted classes."
        ),
        "Inference Consistency": (
            "Measures whether the AI system produces stable, reproducible outputs when presented "
            "with equivalent inputs under consistent conditions. Inconsistent inference — where "
            "the same input produces different outputs across calls — indicates non-determinism "
            "in the inference pipeline, which undermines auditability, reproducibility, and "
            "regulatory compliance for high-risk AI deployments.",
            "Derived from variance analysis of repeated inference outputs across the dataset."
        ),
        # ── SECURITY ──────────────────────────────────────────────────────────────
        "Adversarial Input Resistance": (
            "Evaluates the AI system's robustness against adversarial inputs — carefully crafted "
            "perturbations designed to cause the model to produce incorrect, harmful, or unintended "
            "outputs. Adversarial attacks are a primary threat vector for deployed AI systems, "
            "particularly in high-stakes domains such as financial fraud detection, medical diagnosis, "
            "and content moderation. Resistance must be validated through structured red-team testing.",
            "Derived from presence of adversarial input validation fields and input sanitisation controls."
        ),
        "PII/Biometric in Images": (
            "Checks whether the dataset or model outputs contain personally identifiable information "
            "or biometric data (faces, fingerprints, gait patterns) that could expose individuals "
            "to privacy violations or enable surveillance. AI systems processing biometric data are "
            "classified as high-risk under the EU AI Act and subject to mandatory DPIA requirements "
            "and heightened data protection obligations under GDPR Article 9.",
            "100 if no PII/biometric indicators detected in the dataset; scaled penalty if detected."
        ),
        "Harmful Image Content Rate": (
            "Measures whether the AI system's inputs or outputs contain harmful, illegal, or policy-"
            "violating image content — including CSAM, graphic violence, or content that could "
            "facilitate harm. AI systems must implement content filtering at both the input and "
            "output layers, with automated detection, human review queues, and mandatory reporting "
            "protocols for identified harmful content.",
            "100 if harmful content rate is 0%; scaled penalty applied for any detected harmful content."
        ),
        "Input Validation Rate": (
            "Assesses whether the AI system performs structured validation on all inputs before "
            "processing — including format checks, schema validation, range constraints, and "
            "injection attack detection. Unvalidated inputs are a critical security vulnerability "
            "that can enable prompt injection, data poisoning, and model extraction attacks. "
            "100% input validation is the minimum acceptable standard for production AI systems.",
            "100 if input validation/sanitisation controls are evidenced in the dataset; 0 otherwise."
        ),
        # ── SAFETY ────────────────────────────────────────────────────────────────
        "Misidentification Risk Control": (
            "Evaluates the degree to which the AI system has implemented controls to prevent "
            "or mitigate the consequences of misidentification — incorrectly identifying a person, "
            "object, or situation. Misidentification in high-stakes contexts (medical, legal, "
            "security) can cause direct harm. Controls include confidence thresholds, human review "
            "queues, uncertainty quantification, and fallback to human decision-making.",
            "Derived from presence of confidence threshold, review queue, and fallback mechanism fields."
        ),
        "Human Override on Low Confidence": (
            "Verifies whether the system enforces a mandatory human review pathway for predictions "
            "below a defined confidence threshold. This is a fundamental safety control for high-"
            "risk AI — it prevents the system from acting autonomously when its own certainty is "
            "insufficient. Absence of this control means the AI operates without a safety net, "
            "directly contradicting human-centric AI governance principles.",
            "100 if human_review/override field is present alongside confidence threshold; 0 otherwise."
        ),
        "Safety-Critical Recall": (
            "For AI systems in safety-critical applications, recall (the ability to detect all "
            "relevant positive instances) is often more important than precision. Missing a genuine "
            "positive (false negative) in medical, safety, or security contexts can have severe "
            "consequences. This parameter ensures the system's recall in safety-critical categories "
            "meets the elevated thresholds required for high-risk deployments.",
            "Derived from recall analysis on safety-critical class labels in the evaluation dataset."
        ),
        "Incident Response Signals": (
            "Checks whether the AI system is integrated with an incident response workflow — "
            "including automated alerting, structured incident logging, escalation pathways, "
            "and post-incident review processes. EU AI Act Article 62 mandates serious incident "
            "reporting for high-risk AI systems. Without incident response infrastructure, "
            "organisations cannot demonstrate compliance with mandatory notification obligations.",
            "100 if incident_response/alert/escalation fields are present in the dataset; 0 otherwise."
        ),
        # ── PRIVACY ───────────────────────────────────────────────────────────────
        "Biometric PII Leakage Rate": (
            "Measures the rate at which biometric personal data (facial embeddings, fingerprint "
            "data, voiceprints, gait data) appears in AI system outputs or logs in a form that "
            "could identify individuals. Biometric data receives the highest level of protection "
            "under GDPR Article 9 as a special category. Any leakage constitutes a serious data "
            "breach with mandatory regulatory notification within 72 hours.",
            "100 if biometric data leakage rate is 0%; penalty scaled by detected leakage rate."
        ),
        "Image Data Minimisation": (
            "Assesses whether the AI system collects, processes, and retains only the minimum "
            "image data necessary for its stated purpose — a core principle of Privacy by Design "
            "under GDPR Article 25. Systems that capture and store high-resolution images, "
            "facial data, or scene content beyond operational necessity create disproportionate "
            "privacy risks and are exposed to regulatory sanctions.",
            "100 if data minimisation controls are evidenced; penalty for excessive data collection signals."
        ),
        "Biometric Anonymisation": (
            "Verifies whether biometric data captured or processed by the AI system is subject "
            "to appropriate anonymisation or pseudonymisation techniques before storage or "
            "transmission. Techniques include facial blurring, embedding encryption, and k-"
            "anonymity. Effective anonymisation reduces re-identification risk and may exempt "
            "the organisation from certain GDPR Article 9 obligations.",
            "100 if anonymisation controls are evidenced in the dataset processing pipeline; 0 otherwise."
        ),
        "Image Retention Compliance": (
            "Checks whether the AI system enforces defined retention periods for image data — "
            "ensuring that images are automatically deleted after their legitimate purpose has "
            "been fulfilled, in accordance with GDPR Article 5(1)(e) (storage limitation). "
            "Indefinite image retention is a common compliance failure and a significant "
            "regulatory risk, particularly for systems processing public-space imagery.",
            "100 if retention_period/deletion_schedule fields are present; 0 if absent."
        ),
        # ── SUSTAINABILITY ────────────────────────────────────────────────────────
        "Inference Latency Efficiency": (
            "Measures the energy and compute efficiency of the AI system's inference pipeline — "
            "using latency as a proxy for computational intensity. High-latency inference indicates "
            "an inefficient model architecture or infrastructure configuration that consumes "
            "disproportionate energy. Organisations are increasingly required to report AI system "
            "carbon footprints under ESG disclosure frameworks and the EU Corporate Sustainability Reporting Directive.",
            "100 if latency meets efficiency benchmarks; 0 if latency field is absent or exceeds threshold."
        ),
        "Detection Compute Efficiency": (
            "Evaluates whether the AI system's detection pipeline is optimised for compute "
            "efficiency — using techniques such as model pruning, quantisation, knowledge "
            "distillation, or hardware-accelerated inference. Inefficient detection pipelines "
            "scale poorly, incur high operational costs, and generate significant carbon emissions "
            "at scale. Compute efficiency is increasingly a board-level ESG concern.",
            "Derived from compute utilisation signals and model architecture complexity indicators."
        ),
        "Dataset Redundancy Rate": (
            "Measures the proportion of redundant or duplicate records in the training and "
            "evaluation dataset — a direct proxy for computational waste. Processing redundant "
            "data consumes compute, energy, and storage without contributing to model quality. "
            "Deduplication and dataset distillation are sustainability best practices that also "
            "improve training efficiency and governance auditability.",
            "Derived from duplicate detection analysis — penalised for high redundancy rates."
        ),
        "Carbon Footprint Proxy": (
            "Provides an estimated proxy measure of the AI system's operational carbon footprint "
            "— derived from model complexity, inference volume, hardware type, and geographic "
            "data centre location. While exact carbon measurement requires infrastructure-level "
            "instrumentation, this proxy supports initial ESG reporting and identifies high-"
            "impact optimisation targets for sustainability governance programmes.",
            "Composite score from model complexity, inference volume, and infrastructure efficiency signals."
        ),
        "Volume Sufficiency": (
            "Measures whether the dataset contains a sufficient volume of records to produce "
            "statistically reliable governance assessments. Small datasets produce high-variance "
            "metric estimates that cannot be generalised to production behaviour. Volume sufficiency "
            "thresholds vary by model type and application domain — this parameter provides a "
            "structural baseline assessment.",
            f"min(logs_evaluated {c['logs_count']} / 100 x 100, 100) = {c['volume_score']}"
        ),
        "Dataset Efficiency": (
            "Evaluates whether the dataset size is proportionate to the complexity of the AI "
            "task — penalising unnecessarily large datasets that could be reduced through "
            "intelligent sampling, active learning, or dataset distillation. Right-sizing "
            "datasets reduces compute, storage, and energy consumption while maintaining "
            "governance-grade evaluation quality.",
            f"clamp(100 - (logs_evaluated {c['logs_count']} / 10000) x 30)"
        ),
    }
    default = (
        "This sub-parameter is evaluated from structural signals present in the ingested dataset, "
        "including field presence, completeness, volume, value distributions, and schema consistency. "
        "Scores reflect the governance readiness of the dataset relative to KPMG Trusted AI Framework "
        "requirements and applicable regulatory standards.",
        "Derived from structural analysis of the uploaded dataset."
    )
    return details.get(param, default)


# ─── Chart Generators ─────────────────────────────────────────────────────────

def _build_radar_chart(principles: dict, width: float, height: float) -> Drawing:
    """Build a spider/radar chart of the 10 principle scores."""
    d = Drawing(width, height)
    cx, cy = width / 2, height / 2
    r = min(width, height) * 0.38

    names = list(principles.keys())
    scores = [principles[n].get("score", 0) for n in names]
    n = len(names)

    if n == 0:
        return d

    angles = [2 * math.pi * i / n - math.pi / 2 for i in range(n)]

    # Grid circles
    for level in [0.25, 0.5, 0.75, 1.0]:
        pts = []
        for a in angles:
            pts.append(cx + r * level * math.cos(a))
            pts.append(cy + r * level * math.sin(a))
        pts.append(pts[0])
        pts.append(pts[1])
        from reportlab.graphics.shapes import PolyLine
        grid_line = PolyLine(pts, strokeColor=colors.HexColor("#E5E7EB"), strokeWidth=0.5, fillColor=None)
        d.add(grid_line)
        # Level label
        label_str = str(int(level * 100))
        lbl = String(cx + 3, cy + r * level + 2, label_str,
                     fontSize=5, fillColor=colors.HexColor("#9CA3AF"), fontName="Helvetica")
        d.add(lbl)

    # Spokes
    for a in angles:
        spoke = Line(cx, cy, cx + r * math.cos(a), cy + r * math.sin(a),
                     strokeColor=colors.HexColor("#D1D5DB"), strokeWidth=0.5)
        d.add(spoke)

    # Data polygon
    pts = []
    for i, (score, a) in enumerate(zip(scores, angles)):
        ratio = score / 100.0
        pts.append(cx + r * ratio * math.cos(a))
        pts.append(cy + r * ratio * math.sin(a))
    pts.append(pts[0])
    pts.append(pts[1])

    from reportlab.graphics.shapes import Polygon
    poly = Polygon(pts[:-2],
                   fillColor=colors.HexColor("#00338D"),
                   fillOpacity=0.25,
                   strokeColor=KPMG_BLUE,
                   strokeWidth=1.5)
    d.add(poly)

    # Data points
    for i, (score, a) in enumerate(zip(scores, angles)):
        ratio = score / 100.0
        px = cx + r * ratio * math.cos(a)
        py = cy + r * ratio * math.sin(a)
        dot_color = score_to_color(score)
        dot = Circle(px, py, 3, fillColor=dot_color, strokeColor=KPMG_WHITE, strokeWidth=0.5)
        d.add(dot)

    # Labels
    for i, (name, a) in enumerate(zip(names, angles)):
        lx = cx + (r + 14) * math.cos(a)
        ly = cy + (r + 14) * math.sin(a)
        short = name.split()[0] if " " in name else name
        score_val = scores[i]
        sc = score_to_color(score_val)
        lbl = String(lx, ly - 3, f"{short}: {score_val}",
                     fontSize=5.5, fillColor=sc, fontName="Helvetica-Bold", textAnchor="middle")
        d.add(lbl)

    return d


def _build_bar_chart(principles: dict, width: float, height: float) -> Drawing:
    """Build a horizontal bar chart for principle scores."""
    d = Drawing(width, height)
    names = list(principles.keys())
    scores = [principles[n].get("score", 0) for n in names]
    n = len(names)

    bar_h = (height - 10) / n
    label_w = 72
    bar_area_w = width - label_w - 30

    for i, (name, score) in enumerate(zip(names, scores)):
        y = height - (i + 1) * bar_h + 2
        # Background bar
        bg = Rect(label_w, y, bar_area_w, bar_h - 4,
                  fillColor=colors.HexColor("#F3F4F6"), strokeColor=None)
        d.add(bg)
        # Filled bar
        fill_w = max(4, (score / 100) * bar_area_w)
        col = score_to_color(score)
        fill = Rect(label_w, y, fill_w, bar_h - 4,
                    fillColor=col, strokeColor=None)
        d.add(fill)
        # Principle name
        lbl = String(label_w - 3, y + (bar_h - 4) / 2 - 3, name,
                     fontSize=5.5, fillColor=colors.HexColor("#111827"),
                     fontName="Helvetica", textAnchor="end")
        d.add(lbl)
        # Score label
        score_lbl = String(label_w + fill_w + 3, y + (bar_h - 4) / 2 - 3,
                           str(score),
                           fontSize=5.5, fillColor=col, fontName="Helvetica-Bold")
        d.add(score_lbl)

    return d


def _build_compliance_donut(score: int, width: float, height: float) -> Drawing:
    """Build a donut chart showing overall compliance score."""
    d = Drawing(width, height)
    cx, cy = width / 2, height / 2
    outer_r = min(width, height) * 0.42
    inner_r = outer_r * 0.62

    # Background circle
    bg = Circle(cx, cy, outer_r, fillColor=colors.HexColor("#F3F4F6"), strokeColor=None)
    d.add(bg)

    # Score arc (using multiple thin wedges)
    col = score_to_color(score)
    num_segs = 60
    filled_segs = int(score / 100 * num_segs)

    for i in range(num_segs):
        start_angle = 90 - (i * 360 / num_segs)
        end_angle = start_angle - (360 / num_segs) + 0.5
        fill = col if i < filled_segs else colors.HexColor("#E5E7EB")
        w = Wedge(cx, cy, outer_r, start_angle, start_angle - 360 / num_segs + 0.5,
                  fillColor=fill, strokeColor=None)
        d.add(w)

    # Inner white circle (donut hole)
    hole = Circle(cx, cy, inner_r, fillColor=KPMG_WHITE, strokeColor=None)
    d.add(hole)

    # Score text
    score_text = String(cx, cy + 4, str(score),
                        fontSize=22, fillColor=col, fontName="Helvetica-Bold",
                        textAnchor="middle")
    d.add(score_text)
    label_text = String(cx, cy - 10, "/100",
                        fontSize=8, fillColor=KPMG_GREY, fontName="Helvetica",
                        textAnchor="middle")
    d.add(label_text)

    return d


def _build_subparam_minibar(score: int, width: float, height: float) -> Drawing:
    """Build a tiny horizontal progress bar for sub-parameters."""
    d = Drawing(width, height)
    col = score_to_color(score)
    # Background
    bg = Rect(0, 1, width, height - 2, fillColor=colors.HexColor("#E5E7EB"), strokeColor=None)
    d.add(bg)
    # Fill
    fill_w = max(2, score / 100 * width)
    fill = Rect(0, 1, fill_w, height - 2, fillColor=col, strokeColor=None)
    d.add(fill)
    return d


# ─── Page Template ───────────────────────────────────────────────────────────
class KPMGPageTemplate:
    def __init__(self, report_id: str, ai_name: str, home_url: str = "/dashboard"):
        self.report_id = report_id
        self.ai_name = ai_name
        self.home_url = home_url

    def on_page(self, canvas_obj, doc):
        canvas_obj.saveState()
        W, H = A4

        # ── Header bar ──────────────────────────────────────────────────────
        canvas_obj.setFillColor(KPMG_BLUE)
        canvas_obj.rect(0, H - 20 * mm, W, 20 * mm, fill=1, stroke=0)

        # Teal accent stripe
        canvas_obj.setFillColor(KPMG_TEAL)
        canvas_obj.rect(0, H - 21.5 * mm, W, 1.5 * mm, fill=1, stroke=0)

        # Light blue secondary stripe
        canvas_obj.setFillColor(KPMG_LIGHT_BLUE)
        canvas_obj.rect(0, H - 22.5 * mm, W, 1 * mm, fill=1, stroke=0)

        # Left: "TrustShield AI" brand
        canvas_obj.setFillColor(KPMG_TEAL)
        canvas_obj.setFont("Helvetica-Bold", 13)
        canvas_obj.drawString(14 * mm, H - 10 * mm, "TrustShield AI\u2122")
        canvas_obj.setFillColor(colors.HexColor("#9DBFE0"))
        canvas_obj.setFont("Helvetica", 7)
        canvas_obj.drawString(14 * mm, H - 15 * mm, "KPMG Trusted AI Framework")

        # Make the logo area a clickable link to home
        canvas_obj.linkURL(
            self.home_url,
            (14 * mm, H - 18 * mm, 65 * mm, H - 6 * mm),
            relative=0
        )

        # Subtle underline to hint it's clickable
        canvas_obj.setStrokeColor(KPMG_TEAL)
        canvas_obj.setLineWidth(0.5)
        canvas_obj.line(14 * mm, H - 16 * mm, 55 * mm, H - 16 * mm)

        # Right: AI system name + confidential
        canvas_obj.setFillColor(colors.HexColor("#9DBFE0"))
        canvas_obj.setFont("Helvetica", 7.5)
        canvas_obj.drawRightString(W - 14 * mm, H - 10 * mm, f"AI System: {self.ai_name}")
        canvas_obj.setFillColor(colors.HexColor("#6B9EC8"))
        canvas_obj.setFont("Helvetica-Bold", 6.5)
        canvas_obj.drawRightString(W - 14 * mm, H - 15 * mm, "CONFIDENTIAL")

        # ── Footer bar ──────────────────────────────────────────────────────
        canvas_obj.setFillColor(KPMG_BLUE)
        canvas_obj.rect(0, 0, W, 11 * mm, fill=1, stroke=0)

        canvas_obj.setFillColor(KPMG_TEAL)
        canvas_obj.rect(0, 11 * mm, W, 1 * mm, fill=1, stroke=0)

        canvas_obj.setFillColor(KPMG_LIGHT_BLUE)
        canvas_obj.rect(0, 12 * mm, W, 0.5 * mm, fill=1, stroke=0)

        canvas_obj.setFillColor(KPMG_WHITE)
        canvas_obj.setFont("Helvetica", 6.5)
        canvas_obj.drawString(14 * mm, 4 * mm, f"Report ID: {self.report_id}")
        canvas_obj.drawCentredString(W / 2, 4 * mm, "TrustShield AI\u2122 Governance Audit Report")
        canvas_obj.drawRightString(W - 14 * mm, 4 * mm, f"Page {doc.page}")

        canvas_obj.restoreState()


# ─── Dynamic Report Helpers ───────────────────────────────────────────────────

def _finding_why_it_matters(category: str, severity: str) -> str:
    """Return a contextual 'why this matters' sentence for a finding category."""
    cat = category.lower()
    severity_phrase = {
        "High":   "This is a critical area that directly undermines stakeholder trust and regulatory standing.",
        "Medium": "Left unaddressed, this area will compound over time and may escalate into a higher-severity risk.",
        "Low":    "While lower priority, resolving this finding improves overall governance maturity.",
    }.get(severity, "This finding affects the overall governance posture of the AI system.")

    category_context = {
        "fairness":       "Fairness gaps can lead to discriminatory outcomes affecting real users and triggering regulatory action under the EU AI Act and existing anti-discrimination law.",
        "transparency":   "Lack of transparency prevents stakeholders from understanding AI decisions, eroding trust and making it impossible to challenge incorrect outcomes.",
        "explainability": "Without explainability, affected individuals cannot exercise their right to explanation under GDPR Article 22, and audit teams cannot validate model behaviour.",
        "accountability": "Accountability gaps mean that when something goes wrong, no clear ownership path exists — making incident response, regulatory reporting, and remediation significantly harder.",
        "data integrity": "Poor data quality directly degrades every downstream metric, making all governance assessments unreliable and potentially misleading to decision-makers.",
        "reliability":    "Reliability failures translate directly into user-facing errors, missed SLAs, and compounding reputational risk with each production incident.",
        "security":       "Security weaknesses expose the AI system to adversarial manipulation, data exfiltration, and model extraction attacks that can compromise the entire pipeline.",
        "safety":         "Safety gaps mean the AI system could cause real-world harm without adequate safeguards, creating direct liability exposure for the deploying organisation.",
        "privacy":        "Privacy failures carry mandatory notification obligations under GDPR, DPDP Act, and CCPA, with potential fines up to 4% of global annual turnover.",
        "sustainability": "Sustainability inefficiencies translate into higher operational costs, increased carbon footprint, and growing ESG reporting obligations under CSRD and similar frameworks.",
    }
    for key, ctx in category_context.items():
        if key in cat:
            return f"{ctx} {severity_phrase}"
    return f"This finding affects the AI system's alignment with the KPMG Trusted AI Framework. {severity_phrase}"


def _principle_score_narrative(pname: str, score: int, params: dict) -> str:
    """Generate a plain-English narrative explaining what the principle score means."""
    n_params = len(params)
    n_strong  = sum(1 for v in params.values() if int(v) >= 75)
    n_partial = sum(1 for v in params.values() if 55 <= int(v) < 75)
    n_weak    = sum(1 for v in params.values() if int(v) < 55)

    weakest = min(params, key=lambda k: int(params[k])) if params else None
    strongest = max(params, key=lambda k: int(params[k])) if params else None

    if score >= 75:
        narrative = (
            f"Of the {n_params} sub-parameters evaluated, {n_strong} demonstrate strong governance "
            f"practices (≥75/100). "
        )
        if n_partial:
            narrative += f"{n_partial} sub-parameter(s) show partial alignment and represent opportunities for further improvement. "
        if n_weak:
            narrative += f"{n_weak} sub-parameter(s) need attention to sustain this level of alignment. "
    elif score >= 55:
        narrative = (
            f"Of the {n_params} sub-parameters evaluated, {n_strong} are performing well, "
            f"{n_partial} show partial alignment, and {n_weak} require active remediation. "
        )
        if weakest:
            narrative += f"The weakest area is '{weakest}' ({params[weakest]}/100), which should be prioritised in the next governance cycle. "
    else:
        narrative = (
            f"This principle has significant gaps: only {n_strong} of {n_params} sub-parameters "
            f"demonstrate adequate governance. {n_weak} sub-parameter(s) score below 55, indicating "
            f"material governance deficiencies that require immediate attention. "
        )
        if weakest:
            narrative += f"'{weakest}' ({params[weakest]}/100) is the most critical area to address. "

    if strongest and int(params[strongest]) >= 70:
        narrative += f"The strongest area is '{strongest}' ({params[strongest]}/100), which can serve as a model for improving other sub-parameters."
    return narrative


def _subparam_score_meaning(param: str, score: int) -> str:
    """Generate a plain-English sentence explaining what this sub-parameter score means for the system."""
    if score >= 90:
        tier = "excellent — this area is a governance strength and requires only routine monitoring"
    elif score >= 75:
        tier = "good — governance practices are in place and functioning, with minor room for improvement"
    elif score >= 60:
        tier = "moderate — basic controls exist but there are identifiable gaps that should be addressed in the next review cycle"
    elif score >= 40:
        tier = "below expectations — controls are inconsistent or partially absent, creating meaningful governance risk"
    else:
        tier = "poor — this area has significant deficiencies and represents an active governance risk requiring prompt remediation"

    param_lower = param.lower()
    context = ""
    if any(k in param_lower for k in ["pii", "privacy", "biometric"]):
        context = " In a privacy context, this directly affects data protection compliance."
    elif any(k in param_lower for k in ["safety", "harm", "override"]):
        context = " Given the safety implications, this score warrants particular attention."
    elif any(k in param_lower for k in ["audit", "trail", "logging", "accountability"]):
        context = " Without strong audit coverage, regulatory accountability obligations cannot be demonstrated."
    elif any(k in param_lower for k in ["fairness", "equity", "bias", "balance"]):
        context = " Fairness gaps can translate directly into discriminatory outcomes at scale."
    elif any(k in param_lower for k in ["security", "injection", "adversarial"]):
        context = " Security weaknesses may be actively exploitable in production."

    return f"A score of {score}/100 is {tier}.{context}"


def _subparam_improvement(param: str, score: int) -> str:
    """Return an actionable improvement suggestion for a sub-parameter based on its score."""
    param_lower = param.lower()

    # Priority lookup — specific param names first
    specific = {
        "audit trail coverage":        "Ensure every AI event is logged with timestamp, user ID, model version, input, and output. Implement structured logging from day one rather than retrofitting.",
        "human oversight":             "Define and test a formal escalation pathway. Route uncertain or high-stakes outputs to human reviewers before action is taken.",
        "pii":                         "Deploy a PII scanning layer (regex + NER) on all outputs. Implement automatic redaction for detected personal identifiers.",
        "class balance":               "Apply SMOTE oversampling or class-weighted loss to address minority class underrepresentation. Monitor class distribution drift in production.",
        "fairness":                    "Run stratified bias tests across demographic segments. Use equalised-odds or demographic-parity constraints during model fine-tuning.",
        "hallucination":               "Add a self-consistency check — run the same query multiple times and flag divergent answers. Use retrieval-augmented generation to ground responses in source documents.",
        "toxicity":                    "Implement a multi-layer content filter: a fast keyword blocker as the first layer, and an NLI-based classifier as the second. Review flagged outputs weekly.",
        "latency":                     "Profile inference bottlenecks using a tracing tool. Consider model quantisation, caching of frequent queries, or switching to a lighter model variant.",
        "schema":                      "Enforce a schema contract at the data ingestion layer. Reject or quarantine records that do not conform before they enter the evaluation pipeline.",
        "completeness":                "Audit your data pipeline for fields that are frequently null or missing. Add validation checks at the source system to prevent incomplete records.",
        "version":                     "Tag every prediction record with the model version that produced it. Use a model registry (MLflow, W&B) to manage version metadata.",
        "injection":                   "Implement an input sanitisation layer that detects and blocks known injection patterns. Run regular red-team exercises against the production endpoint.",
        "transparency":                "Add confidence scores and uncertainty indicators to model outputs. Document known failure modes and limitations in a public model card.",
        "explainability":              "Integrate SHAP or LIME for local feature importance. Provide natural-language explanations alongside predictions for non-technical stakeholders.",
        "sustainability":              "Measure and report inference energy consumption per 1,000 requests. Explore model distillation or pruning to reduce compute without sacrificing accuracy.",
        "data minimisation":           "Audit what data fields are actually used at inference time. Remove any fields collected but not needed — collect less, store less, expose less.",
        "reliability":                 "Implement automated regression testing after every model update. Set up alerting for production metric degradation beyond defined thresholds.",
        "safety":                      "Implement a multi-stage output review for safety-critical applications. Define and test a kill-switch procedure that can halt the system within minutes.",
        "privacy":                     "Conduct a Data Protection Impact Assessment (DPIA). Implement privacy-by-design controls — anonymisation, data minimisation, and access controls — before deployment.",
    }
    for key, suggestion in specific.items():
        if key in param_lower:
            return suggestion

    # Score-tier fallback
    if score >= 60:
        return f"This area is performing reasonably well. Focus on formalising existing informal practices into documented governance controls, and set up automated monitoring to detect regression."
    elif score >= 40:
        return f"Prioritise a targeted improvement sprint for this area. Identify the root cause of the score gap — missing data fields, absent controls, or process failures — and address each in turn."
    else:
        return f"This area requires immediate remediation planning. Assign ownership, define a timeline, and treat it as a governance action item in the next audit cycle. Do not wait for the next scheduled audit to address this."


# ─── Main PDF Builder ─────────────────────────────────────────────────────────
def build_pdf(report: dict) -> BytesIO:
    buffer = BytesIO()
    W, H = A4
    margin = 16 * mm

    report_id  = report.get("report_id", "N/A")
    ai_name    = report.get("ai_name", "N/A")
    model_type = report.get("model_type", "N/A")
    evaluated  = report.get("evaluated_at", "N/A")
    try:
        dt = datetime.datetime.fromisoformat(evaluated)
        evaluated_fmt = dt.strftime("%d %B %Y, %H:%M UTC")
    except Exception:
        evaluated_fmt = evaluated

    overall_score  = report.get("overall_score", 0)
    risk_level     = report.get("risk_level", "N/A")
    struct_risk    = report.get("structural_risk") or "N/A"
    logs_evaluated = report.get("logs_evaluated", 0)
    dq_score       = report.get("data_quality_score", 0)
    principles     = report.get("trusted_ai_principles", {})
    diagnostics    = report.get("diagnostics", {})
    findings       = report.get("findings", [])
    recommendation = report.get("recommendation", "")
    framework      = report.get("framework_compliance", {})
    # AI-generated recommendation fields (rec_synthesizer.py)
    overall_narrative          = report.get("overall_narrative", "") or ""
    deployment_verdict_context = report.get("deployment_verdict_context", "") or ""
    recommended_actions        = report.get("recommended_actions", []) or []
    recs_generated             = report.get("recs_generated", False)
    # Blackbox audit data
    blackbox_data  = report.get("blackbox_audit") or report.get("code_build_risk") or {}

    template = KPMGPageTemplate(report_id, ai_name, home_url="/dashboard")

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=margin,
        leftMargin=margin,
        topMargin=26 * mm,
        bottomMargin=17 * mm,
        title=f"TrustShield AI Governance Report — {ai_name}",
        author="TrustShield AI",
        subject="KPMG Trusted AI Framework Governance Audit",
    )

    # ── Style Definitions ─────────────────────────────────────────────────
    def S(name, **kwargs):
        return ParagraphStyle(name, **kwargs)

    usable_w = W - 2 * margin

    cover_title_s = S("CoverTitle", fontSize=30, leading=36, textColor=KPMG_WHITE,
                      fontName="Helvetica-Bold", alignment=TA_LEFT)
    cover_sub_s   = S("CoverSub", fontSize=12, leading=17, textColor=colors.HexColor("#9DBFE0"),
                      fontName="Helvetica", alignment=TA_LEFT)

    sec_title_s   = S("SecTitle", fontSize=13, leading=18, textColor=KPMG_WHITE,
                      fontName="Helvetica-Bold", spaceBefore=10, spaceAfter=4)
    sec_sub_s     = S("SecSub", fontSize=8.5, leading=13, textColor=KPMG_GREY,
                      fontName="Helvetica", spaceAfter=8, alignment=TA_JUSTIFY)
    body_s        = S("Body", fontSize=8.5, leading=13, textColor=colors.HexColor("#1F2937"),
                      fontName="Helvetica", spaceAfter=4)
    body_bold_s   = S("BodyBold", fontSize=8.5, leading=13, textColor=colors.HexColor("#111827"),
                      fontName="Helvetica-Bold")
    small_s       = S("Small", fontSize=7, leading=10, textColor=KPMG_GREY,
                      fontName="Helvetica")
    label_s       = S("Label", fontSize=7.5, leading=10, textColor=KPMG_GREY,
                      fontName="Helvetica-Bold", spaceAfter=2)
    finding_txt_s = S("FindTxt", fontSize=8, leading=12, textColor=colors.HexColor("#374151"),
                      fontName="Helvetica", spaceAfter=3, alignment=TA_JUSTIFY)
    rec_txt_s     = S("RecTxt", fontSize=8, leading=12, textColor=colors.HexColor("#1D4ED8"),
                      fontName="Helvetica-Oblique", spaceAfter=0)
    def_txt_s     = S("DefTxt", fontSize=7.5, leading=11.5, textColor=colors.HexColor("#374151"),
                      fontName="Helvetica", spaceAfter=2, alignment=TA_JUSTIFY)
    calc_txt_s    = S("CalcTxt", fontSize=6.5, leading=10, textColor=KPMG_GREY,
                      fontName="Helvetica-Oblique", spaceAfter=4)

    # Accent colours matching the web app
    ACCENT_TEAL   = KPMG_TEAL          # #00C896
    ACCENT_LIGHT  = KPMG_LIGHT_BLUE    # #0091DA
    CARD_BG       = colors.HexColor("#F8FAFC")
    BORDER_LIGHT  = colors.HexColor("#E2E8F0")

    elements = []

    # ══════════════════════════════════════════════════════════════════════════
    # COVER PAGE
    # ══════════════════════════════════════════════════════════════════════════
    def build_cover():
        cover = []

        # ── Full-width dark hero banner ──────────────────────────────────────
        hero_data = [[
            Table([
                [Paragraph("TrustShield AI\u2122",
                    S("hero_brand", fontSize=32, leading=38, textColor=KPMG_TEAL,
                      fontName="Helvetica-Bold"))],
                [Paragraph("Governance Audit Report",
                    S("hero_sub", fontSize=14, leading=18, textColor=colors.HexColor("#9DBFE0"),
                      fontName="Helvetica"))],
                [Spacer(1, 3)],
                [Paragraph("KPMG Trusted AI Framework — Comprehensive Assessment",
                    S("hero_fw", fontSize=9, leading=13, textColor=colors.HexColor("#6B9EC8"),
                      fontName="Helvetica"))],
            ], colWidths=[usable_w - 60*mm]),
            Table([
                [Paragraph(f'<font color="#FFFFFF" size="42"><b>{overall_score}</b></font>',
                    S("hero_score", fontSize=42, leading=48, fontName="Helvetica-Bold",
                      textColor=KPMG_WHITE, alignment=TA_CENTER))],
                [Paragraph('<font color="#9DBFE0" size="8">/ 100</font>',
                    S("hero_score_sub", fontSize=8, leading=10, textColor=colors.HexColor("#9DBFE0"),
                      fontName="Helvetica", alignment=TA_CENTER))],
                [Spacer(1, 4)],
                [Table([[Paragraph(f'<b>{risk_level} Risk</b>',
                    S("hero_risk", fontSize=9, leading=12,
                      textColor=risk_color(risk_level),
                      fontName="Helvetica-Bold", alignment=TA_CENTER))]],
                    colWidths=[52*mm],
                    style=[
                        ("BACKGROUND", (0,0),(-1,-1), colors.HexColor("#FFFFFF")),
                        ("TOPPADDING", (0,0),(-1,-1), 4),
                        ("BOTTOMPADDING", (0,0),(-1,-1), 4),
                        ("LEFTPADDING", (0,0),(-1,-1), 6),
                        ("RIGHTPADDING", (0,0),(-1,-1), 6),
                    ])],
            ], colWidths=[58*mm]),
        ]]
        hero = Table(hero_data, colWidths=[usable_w - 60*mm, 60*mm])
        hero.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), KPMG_BLUE),
            ("LEFTPADDING",   (0, 0), (-1, -1), 18),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 14),
            ("TOPPADDING",    (0, 0), (-1, -1), 18),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 18),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))
        cover.append(hero)

        # Teal accent stripe
        cover.append(HRFlowable(width="100%", thickness=4, color=KPMG_TEAL, spaceAfter=0, spaceBefore=0))

        # Light blue secondary stripe
        cover.append(HRFlowable(width="100%", thickness=2, color=KPMG_LIGHT_BLUE, spaceAfter=6, spaceBefore=0))

        # ── Metadata grid ────────────────────────────────────────────────────
        info_rows = [
            [Paragraph("AI System",  label_s), Paragraph(f"<b>{ai_name}</b>",       body_bold_s)],
            [Paragraph("Model Type", label_s), Paragraph(model_type,               body_s)],
            [Paragraph("Evaluated",  label_s), Paragraph(evaluated_fmt,             body_s)],
            [Paragraph("Report ID",  label_s), Paragraph(
                f'<font color="#6B7280" size="7">{report_id}</font>', body_s)],
        ]
        info_tbl = Table(info_rows, colWidths=[36 * mm, usable_w - 36 * mm])
        info_tbl.setStyle(TableStyle([
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING",   (0, 0), (-1, -1), 0),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LINEBELOW",     (0, 0), (-1, -2), 0.5, KPMG_MID_GREY),
        ]))
        cover.append(info_tbl)
        cover.append(Spacer(1, 6 * mm))

        # ── Stats strip — card-style matching the web app ─────────────────
        stats = [
            ("Logs Evaluated", str(logs_evaluated), "#00338D"),
            ("Data Quality",   f"{dq_score}%",       "#059669" if dq_score >= 75 else "#2563EB" if dq_score >= 50 else "#64748B"),
            ("Structural Risk", struct_risk,          "#059669" if struct_risk == "Low" else "#2563EB" if struct_risk == "Moderate" else "#64748B"),
            ("Principles",     str(len(principles)), "#005EB8"),
            ("Findings",       str(len(findings)),   "#DC2626" if len(findings) > 0 else "#059669"),
        ]
        stat_vals = [Paragraph(f'<font color="{c}"><b>{v}</b></font>',
                        S(f"sv{i}", fontSize=16, leading=20, fontName="Helvetica-Bold",
                          alignment=TA_CENTER))
                     for i, (_, v, c) in enumerate(stats)]
        stat_keys = [Paragraph(k, S(f"sk{i}", fontSize=7, leading=10, textColor=KPMG_GREY,
                        fontName="Helvetica", alignment=TA_CENTER))
                     for i, (k, _, _c) in enumerate(stats)]
        col_w = usable_w / len(stats)
        stat_tbl = Table([stat_vals, stat_keys], colWidths=[col_w] * len(stats))
        stat_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor("#F1F5F9")),
            ("TOPPADDING",    (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ("LINEAFTER",     (0, 0), (-2, -1), 0.5, colors.HexColor("#CBD5E1")),
            ("LINEBEFORE",    (0, 0), (0, -1),  4, KPMG_BLUE),
            ("BOX",           (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ]))
        cover.append(stat_tbl)
        cover.append(Spacer(1, 8 * mm))

        # ── Mini radar chart preview ─────────────────────────────────────────
        if principles:
            radar_d = _build_radar_chart(principles, 180, 160)
            bar_d   = _build_bar_chart(principles, usable_w - 195, 160)

            chart_row = Table([[
                _drawing_to_image(radar_d, 180, 160),
                _drawing_to_image(bar_d, usable_w - 195, 160),
            ]], colWidths=[185, usable_w - 185])
            chart_row.setStyle(TableStyle([
                ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING",  (0, 0), (-1, -1), 0),
                ("TOPPADDING",   (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
            ]))
            cover.append(Paragraph("<b>Principles at a Glance</b>",
                                   S("gl", fontSize=8, leading=10, textColor=KPMG_GREY,
                                     fontName="Helvetica-Bold")))
            cover.append(Spacer(1, 2))
            cover.append(chart_row)
            cover.append(Spacer(1, 6 * mm))

        # ── AI-generated overall narrative (when available) ─────────────────
        if overall_narrative:
            cover.append(Spacer(1, 4 * mm))
            narr_tbl = Table([[
                Paragraph(overall_narrative,
                    S("ov_narr", fontSize=8.5, leading=13.5, textColor=colors.HexColor("#1E293B"),
                      fontName="Helvetica", alignment=TA_JUSTIFY))
            ]], colWidths=[usable_w])
            narr_tbl.setStyle(TableStyle([
                ("BACKGROUND",   (0, 0), (-1, -1), colors.HexColor("#F0F6FF")),
                ("LEFTPADDING",  (0, 0), (-1, -1), 14),
                ("RIGHTPADDING", (0, 0), (-1, -1), 14),
                ("TOPPADDING",   (0, 0), (-1, -1), 12),
                ("BOTTOMPADDING",(0, 0), (-1, -1), 12),
                ("LINEBEFORE",   (0, 0), (0, -1),  4, KPMG_BLUE),
                ("BOX",          (0, 0), (-1, -1), 0.5, colors.HexColor("#BFDBFE")),
            ]))
            cover.append(narr_tbl)
            cover.append(Spacer(1, 3 * mm))

        if deployment_verdict_context:
            cover.append(Paragraph(
                f"<b>Deployment Readiness:</b> {deployment_verdict_context}",
                S("dv_ctx", fontSize=8, leading=12, textColor=colors.HexColor("#374151"),
                  fontName="Helvetica", spaceAfter=4)))

        # ── Disclaimer ───────────────────────────────────────────────────────
        cover.append(HRFlowable(width="100%", thickness=0.5, color=KPMG_MID_GREY, spaceAfter=4))
        cover.append(Paragraph(
            "This report was generated by TrustShield AI\u2122 using the KPMG Trusted AI Framework. "
            "All scores are derived from structural analysis of the provided dataset and should be "
            "reviewed in conjunction with qualitative governance assessments. This document is "
            "confidential and intended solely for authorised stakeholders.",
            small_s))

        return cover

    elements.extend(build_cover())
    elements.append(PageBreak())

    # ── Section header helper ─────────────────────────────────────────────
    def section_header(number: str, title: str, subtitle: str = ""):
        """Render a polished section header matching the web app card style."""
        title_para = (
            f'<font color="#0091DA"><b>{number}</b></font>  '
            f'<font color="#FFFFFF"><b>{title}</b></font>'
            if number else
            f'<font color="#FFFFFF"><b>{title}</b></font>'
        )
        hdr_rows = [[
            Paragraph(title_para,
                S(f"sh_{number}_{title[:8]}", fontSize=12, leading=16, fontName="Helvetica-Bold",
                  textColor=KPMG_WHITE)),
        ]]
        hdr_tbl = Table(hdr_rows, colWidths=[usable_w])
        hdr_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), KPMG_BLUE),
            ("LEFTPADDING",   (0, 0), (-1, -1), 14),
            ("TOPPADDING",    (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ("LINEBELOW",     (0, 0), (-1, -1), 3, KPMG_TEAL),
        ]))
        result = [hdr_tbl]
        if subtitle:
            result.append(Spacer(1, 3))
            result.append(Paragraph(subtitle, sec_sub_s))
        result.append(Spacer(1, 4))
        return result

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 1 — REGULATORY COMPLIANCE
    # ══════════════════════════════════════════════════════════════════════════
    elements.extend(section_header("1", "Regulatory &amp; Framework Alignment",
        "This AI system was assessed against four major international AI governance frameworks. "
        "Alignment status is derived from the overall Trusted AI score and individual principle "
        "scores. Each framework defines specific governance expectations mapped to the principles evaluated."))

    FW_META = {
        "EU_AI_Act":   ("EU AI Act",         "European Union Artificial Intelligence Regulation (2024)"),
        "ISO_42001":   ("ISO/IEC 42001:2023", "International AI Management System Standard"),
        "NIST_AI_RMF": ("NIST AI RMF",        "US National Institute of Standards AI Risk Management Framework"),
        "KPMG_TAF":    ("KPMG Trusted AI",    "KPMG Trusted AI Framework — 10 Principle Assessment"),
    }
    FW_FOCUS = {
        "EU_AI_Act":   "Risk classification, human oversight, transparency obligations, and prohibited AI practices.",
        "ISO_42001":   "AI management system requirements, risk treatment, and continual improvement.",
        "NIST_AI_RMF": "Govern, Map, Measure, and Manage functions across the full AI lifecycle.",
        "KPMG_TAF":    "10-principle assessment across Values-led, Trustworthy, and Human-centric dimensions.",
    }

    def _fw_alignment_label(status: str) -> tuple:
        if overall_score >= 75:
            return "High", "#059669"
        elif overall_score >= 55:
            return "Medium", "#D97706"
        return "Low", "#DC2626"

    fw_data = [[
        Paragraph("Framework",         S("fwh0", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Standard",          S("fwh1", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Alignment",         S("fwh2", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Key Governance Focus", S("fwh3", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
    ]]
    for key, status in framework.items():
        meta = FW_META.get(key, (key, ""))
        align_label, align_hex = _fw_alignment_label(status)
        fw_data.append([
            Paragraph(f"<b>{meta[0]}</b>", body_bold_s),
            Paragraph(meta[1], small_s),
            Paragraph(f'<font color="{align_hex}"><b>{align_label}</b></font>', body_bold_s),
            Paragraph(FW_FOCUS.get(key, "\u2014"), small_s),
        ])

    fw_tbl = Table(fw_data, colWidths=[36 * mm, 58 * mm, 36 * mm, usable_w - 130 * mm])
    fw_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0),  KPMG_BLUE),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  KPMG_WHITE),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [KPMG_WHITE, KPMG_LIGHT_GREY]),
        ("GRID",          (0, 0), (-1, -1), 0.5, KPMG_MID_GREY),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
    elements.append(fw_tbl)
    elements.append(Spacer(1, 6 * mm))

    # ── Data Quality & Diagnostics summary (inline, no page break) ────────────
    if diagnostics:
        elements.extend(section_header("", "Dataset Quality &amp; Diagnostics"))
        missing_pct  = round((diagnostics.get("missing_ratio", 0) or 0) * 100, 1)
        completeness = round((1 - (diagnostics.get("missing_ratio", 0) or 0)) * 100)
        schema_conf  = round((diagnostics.get("schema_confidence", 0) or 0) * 100)
        duplicates   = diagnostics.get("duplicates", 0) or 0
        total_cols   = diagnostics.get("total_columns", 0) or 0
        text_cols    = diagnostics.get("text_columns", 0) or 0
        numeric_cols = diagnostics.get("numeric_columns", 0) or 0

        def _dq_color(v: int) -> str:
            return "#059669" if v >= 75 else "#D97706" if v >= 50 else "#DC2626"

        def _dq_numeric(val) -> int:
            """Best-effort int extraction from a metric value; 50 (amber) if not numeric."""
            digits = str(val or "").replace("%", "").replace(" cols", "").replace(" records", "")
            return int(digits) if digits.isdigit() else 50

        dq_rows = [
            ("Logs Evaluated",    str(logs_evaluated),        "Records ingested and assessed"),
            ("Data Quality Score",f"{dq_score}%",             "Completeness × schema confidence composite"),
            ("Completeness",      f"{completeness}%",         f"{missing_pct}% missing values across all fields"),
            ("Schema Confidence", f"{schema_conf}%",          "Consistency of field types and naming conventions"),
            ("Duplicate Records", str(duplicates),            "Identical rows penalise metric reliability"),
            ("Column Coverage",   f"{total_cols} cols",       f"{text_cols} text · {numeric_cols} numeric"),
            ("Structural Risk",   struct_risk,                "Composite data structural integrity rating"),
        ]
        dq_data = [[
            Paragraph("Metric",       S("dqh0", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
            Paragraph("Value",        S("dqh1", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
            Paragraph("Interpretation", S("dqh2", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        ]]
        for metric, val, interp in dq_rows:
            val = str(val) if val is not None else "N/A"
            dq_data.append([
                Paragraph(f"<b>{metric}</b>", body_bold_s),
                Paragraph(val, S(f"dqv_{metric}", fontSize=9, leading=12, fontName="Helvetica-Bold",
                                 textColor=colors.HexColor(_dq_color(_dq_numeric(val))))),
                Paragraph(interp, small_s),
            ])
        dq_tbl = Table(dq_data, colWidths=[44 * mm, 28 * mm, usable_w - 72 * mm])
        dq_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, 0),  KPMG_BLUE),
            ("TEXTCOLOR",     (0, 0), (-1, 0),  KPMG_WHITE),
            ("ROWBACKGROUNDS",(0, 1), (-1, -1), [KPMG_WHITE, KPMG_LIGHT_GREY]),
            ("GRID",          (0, 0), (-1, -1), 0.4, KPMG_MID_GREY),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING",   (0, 0), (-1, -1), 6),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))
        elements.append(dq_tbl)
        elements.append(Spacer(1, 6 * mm))

    # ── LLM Judge accuracy summary (if present) ───────────────────────────────
    llm_judge = report.get("llm_judge")
    if llm_judge and llm_judge.get("rows_judged", 0) > 0:
        accuracy       = llm_judge.get("accuracy")
        rows_judged    = llm_judge.get("rows_judged", 0)
        rows_skipped   = llm_judge.get("rows_skipped", 0)
        disputed_rows  = llm_judge.get("disputed_rows", [])
        disputed       = len(disputed_rows) if isinstance(disputed_rows, list) else 0
        panel_size     = llm_judge.get("panel_size", 3)
        accuracy_pct   = round(accuracy * 100) if accuracy is not None else None
        judge_label    = "Excellent" if accuracy_pct is not None and accuracy_pct >= 85 else \
                         "Good" if accuracy_pct is not None and accuracy_pct >= 70 else \
                         "Moderate" if accuracy_pct is not None and accuracy_pct >= 55 else "Needs Review"
        judge_color    = "#059669" if accuracy_pct is not None and accuracy_pct >= 85 else \
                         "#D97706" if accuracy_pct is not None and accuracy_pct >= 55 else "#DC2626"

        elements.extend(section_header("", "AI Response Accuracy — LLM Judge Panel",
            f"A panel of {panel_size} independent LLM judges evaluated each logged response using majority-vote "
            "consensus. Disputed rows (where judges disagree) are excluded from the accuracy calculation to "
            "ensure only high-confidence verdicts are reported."))

        judge_stats = [
            ("Majority Vote Accuracy", f"{accuracy_pct}%" if accuracy_pct is not None else "—", judge_label, judge_color),
            ("Rows Judged",            str(rows_judged),  "Evaluated by judge panel", "#005EB8"),
            ("Rows Skipped",           str(rows_skipped), "Excluded (missing reference)", "#9CA3AF" if rows_skipped == 0 else "#DC2626"),
            ("Disputed Verdicts",      str(disputed),     "Split votes — excluded from accuracy", "#9CA3AF" if disputed == 0 else "#D97706"),
            ("Judge Panel Size",       str(panel_size),   "Independent models voting", "#7C3AED"),
        ]
        jd_data = [[
            Paragraph("Metric",       S("jdh0", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
            Paragraph("Value",        S("jdh1", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
            Paragraph("Context",      S("jdh2", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        ]]
        for metric, val, ctx, clr in judge_stats:
            jd_data.append([
                Paragraph(f"<b>{metric}</b>", body_bold_s),
                Paragraph(f'<font color="{clr}"><b>{val}</b></font>',
                          S(f"jdv_{metric}", fontSize=10, leading=13, fontName="Helvetica-Bold")),
                Paragraph(ctx, small_s),
            ])
        jd_tbl = Table(jd_data, colWidths=[54 * mm, 28 * mm, usable_w - 82 * mm])
        jd_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, 0),  KPMG_BLUE),
            ("TEXTCOLOR",     (0, 0), (-1, 0),  KPMG_WHITE),
            ("ROWBACKGROUNDS",(0, 1), (-1, -1), [KPMG_WHITE, KPMG_LIGHT_GREY]),
            ("GRID",          (0, 0), (-1, -1), 0.4, KPMG_MID_GREY),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING",   (0, 0), (-1, -1), 6),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))
        elements.append(jd_tbl)
        elements.append(Spacer(1, 6 * mm))

    elements.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 2 — PRINCIPLES OVERVIEW + CHARTS
    # ══════════════════════════════════════════════════════════════════════════
    elements.extend(section_header("2", "KPMG Trusted AI — 10 Principles Overview",
        "Each of the 10 KPMG Trusted AI principles was evaluated across multiple sub-parameters "
        "derived from the structure and content of the ingested dataset. The radar chart provides "
        "an executive overview; the bar chart shows each principle's individual score "
        "(green \u2265 75: Strong Alignment, amber 55\u201374: Partial Alignment, red &lt; 55: Needs Improvement)."))

    # Full-width charts
    if principles:
        radar_large = _build_radar_chart(principles, 220, 200)
        bar_large   = _build_bar_chart(principles, usable_w - 230, 200)

        chart_row2 = Table([[
            _drawing_to_image(radar_large, 220, 200),
            _drawing_to_image(bar_large, usable_w - 230, 200),
        ]], colWidths=[225, usable_w - 225])
        chart_row2.setStyle(TableStyle([
            ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING",  (0, 0), (-1, -1), 0),
            ("TOPPADDING",   (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
        ]))
        elements.append(chart_row2)
        elements.append(Spacer(1, 5 * mm))

    # Summary table
    p_summary_data = [[
        Paragraph("#",                      S("psh0", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Principle",              S("psh1", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Score",                  S("psh2", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Status",                 S("psh3", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Sub-Parameters Evaluated", S("psh4", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
    ]]
    for i, (pname, pdata) in enumerate(principles.items(), 1):
        sc = pdata.get("score", 0)
        params = pdata.get("parameters", {})
        sc_color = score_to_color(sc)
        label = score_to_label(sc)
        p_hex = PRINCIPLE_COLORS.get(pname, "#00C896")
        sc_hex = "#059669" if sc >= 75 else "#2563EB" if sc >= 50 else "#64748B"
        minibar = _build_subparam_minibar(sc, 50, 7)
        score_cell = Table([
            [Paragraph(f'<font color="{sc_hex}"><b>{sc}</b></font>',
                       S(f"psscore{i}", fontSize=13, leading=15, fontName="Helvetica-Bold",
                         alignment=TA_CENTER))],
            [Paragraph('<font color="#9CA3AF">/100</font>',
                       S(f"pssub{i}", fontSize=6, leading=8, fontName="Helvetica",
                         alignment=TA_CENTER))],
            [_drawing_to_image(minibar, 50, 7)],
        ], colWidths=[52 * mm - 10])
        score_cell.setStyle(TableStyle([
            ("TOPPADDING",    (0, 0), (-1, -1), 1),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ("LEFTPADDING",   (0, 0), (-1, -1), 4),
            ("ALIGN",         (0, 0), (-1, -1), "LEFT"),
        ]))
        p_summary_data.append([
            Paragraph(str(i), small_s),
            Paragraph(f'<b>{pname}</b>', body_bold_s),
            score_cell,
            Paragraph(label, small_s),
            Paragraph(", ".join(params.keys()), small_s),
        ])

    p_tbl = Table(p_summary_data, colWidths=[7 * mm, 36 * mm, 55 * mm, 22 * mm, 48 * mm])
    p_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0),  KPMG_BLUE),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  KPMG_WHITE),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [KPMG_WHITE, KPMG_LIGHT_GREY]),
        ("GRID",          (0, 0), (-1, -1), 0.4, KPMG_MID_GREY),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 5),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
    elements.append(p_tbl)
    elements.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 3 — AUDIT FINDINGS & RECOMMENDATIONS
    # ══════════════════════════════════════════════════════════════════════════
    elements.extend(section_header("3", "Audit Findings &amp; Recommendations"))

    # Findings severity summary bar
    if findings:
        high_cnt   = sum(1 for f in findings if f.get("severity") == "High")
        medium_cnt = sum(1 for f in findings if f.get("severity") == "Medium")
        low_cnt    = sum(1 for f in findings if f.get("severity") == "Low")
        sev_data = [[
            Paragraph(f'<font color="#64748B"><b>{high_cnt} High</b></font>',
                      S("hs", fontSize=11, fontName="Helvetica-Bold", alignment=TA_CENTER)),
            Paragraph(f'<font color="#2563EB"><b>{medium_cnt} Medium</b></font>',
                      S("ms", fontSize=11, fontName="Helvetica-Bold", alignment=TA_CENTER)),
            Paragraph(f'<font color="#059669"><b>{low_cnt} Low</b></font>',
                      S("ls", fontSize=11, fontName="Helvetica-Bold", alignment=TA_CENTER)),
            Paragraph(f'<font color="#00338D"><b>{len(findings)} Total</b></font>',
                      S("ts", fontSize=11, fontName="Helvetica-Bold", alignment=TA_CENTER)),
        ],[
            Paragraph("Severity", S("hsl", fontSize=7, fontName="Helvetica", textColor=KPMG_GREY, alignment=TA_CENTER)),
            Paragraph("Severity", S("msl", fontSize=7, fontName="Helvetica", textColor=KPMG_GREY, alignment=TA_CENTER)),
            Paragraph("Severity", S("lsl", fontSize=7, fontName="Helvetica", textColor=KPMG_GREY, alignment=TA_CENTER)),
            Paragraph("Findings", S("tsl", fontSize=7, fontName="Helvetica", textColor=KPMG_GREY, alignment=TA_CENTER)),
        ]]
        sev_tbl = Table(sev_data, colWidths=[usable_w / 4] * 4)
        sev_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (0, -1), colors.HexColor("#FEF2F2")),
            ("BACKGROUND",    (1, 0), (1, -1), colors.HexColor("#FFFBEB")),
            ("BACKGROUND",    (2, 0), (2, -1), colors.HexColor("#F0FDF4")),
            ("BACKGROUND",    (3, 0), (3, -1), colors.HexColor("#E8EEF7")),
            ("TOPPADDING",    (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("LINEAFTER",     (0, 0), (-2, -1), 0.5, KPMG_MID_GREY),
            ("BOX",           (0, 0), (-1, -1), 0.5, KPMG_MID_GREY),
        ]))
        elements.append(sev_tbl)
        elements.append(Spacer(1, 4 * mm))

    if not findings:
        elements.append(Paragraph(
            "No critical governance findings were identified during this evaluation. "
            "The dataset demonstrates good alignment with the KPMG Trusted AI Framework. "
            "Continued monitoring and periodic re-evaluation are recommended to maintain this standard.",
            body_s))
    else:
        elements.append(Paragraph(
            f"{len(findings)} improvement area(s) were identified across the evaluated principles. "
            "Each finding is classified by severity — High, Medium, or Low — and includes a targeted, "
            "actionable recommendation. Findings are listed in order of priority, with High severity "
            "items requiring the most immediate attention.",
            sec_sub_s))

        for idx, f in enumerate(findings, 1):
            cat      = f.get("category", "N/A")
            severity = f.get("severity", "Medium")
            issue    = f.get("issue", "")
            rec      = f.get("recommendation", "")

            # Determine principle score for context
            principle_score = None
            for pname, pdata in principles.items():
                if pname.lower() in cat.lower() or cat.lower() in pname.lower():
                    principle_score = pdata.get("score")
                    break

            # Match frontend severity colors exactly
            sev_bg     = colors.HexColor("#F1F5F9") if severity == "High" else colors.HexColor("#F0FDF4") if severity == "Low" else colors.HexColor("#EFF6FF")
            sev_border = KPMG_SLATE if severity == "High" else KPMG_GREEN if severity == "Low" else KPMG_WATCH_BLUE

            score_context = f" (Principle Score: {principle_score}/100)" if principle_score is not None else ""

            f_hdr = Table([[
                Paragraph(f"<b>{idx}. {cat}{score_context}</b>",
                          S(f"fcat{idx}", fontSize=10, leading=14, textColor=sev_border,
                            fontName="Helvetica-Bold")),
                Paragraph(f"<b>{severity} Severity</b>",
                          S(f"fsev{idx}", fontSize=9, leading=12, textColor=sev_border,
                            fontName="Helvetica-Bold", alignment=TA_RIGHT)),
            ]], colWidths=[usable_w - 35 * mm, 35 * mm])
            f_hdr.setStyle(TableStyle([
                ("BACKGROUND",    (0, 0), (-1, -1), sev_bg),
                ("TOPPADDING",    (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LEFTPADDING",   (0, 0), (-1, -1), 10),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
                ("LINEBELOW",     (0, 0), (-1, -1), 2, sev_border),
            ]))

            # Build rich finding body with What/Why/How structure
            finding_body_rows = [
                [Paragraph("<b>What was found:</b>", S(f"fwhat{idx}", fontSize=8,
                    fontName="Helvetica-Bold", textColor=colors.HexColor("#374151")))],
                [Paragraph(issue, finding_txt_s)],
                [Spacer(1, 4)],
                [Paragraph("<b>Why this matters:</b>", S(f"fwhy{idx}", fontSize=8,
                    fontName="Helvetica-Bold", textColor=colors.HexColor("#374151")))],
                [Paragraph(
                    _finding_why_it_matters(cat, severity),
                    S(f"fwhytxt{idx}", fontSize=8, leading=12,
                      textColor=colors.HexColor("#4B5563"), fontName="Helvetica",
                      spaceAfter=3, alignment=TA_JUSTIFY))],
                [Spacer(1, 4)],
                [Paragraph("<b>Recommended Action:</b>", S(f"frech{idx}", fontSize=8,
                    fontName="Helvetica-Bold", textColor=colors.HexColor("#1D4ED8")))],
                [Paragraph(rec, rec_txt_s)],
            ]
            f_body = Table(finding_body_rows, colWidths=[usable_w])
            f_body.setStyle(TableStyle([
                ("BACKGROUND",    (0, 0), (-1, -1), KPMG_WHITE),
                ("TOPPADDING",    (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING",   (0, 0), (-1, -1), 12),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
                ("BOX",           (0, 0), (-1, -1), 0.5, KPMG_MID_GREY),
                ("LINEBEFORE",    (0, 0), (0, -1),  3, sev_border),
            ]))

            elements.append(KeepTogether([f_hdr, f_body, Spacer(1, 4 * mm)]))

    # Overall recommendation
    if recommendation:
        elements.append(Spacer(1, 4 * mm))
        elements.extend(section_header("", "Overall Assessment &amp; Recommendation"))
        rec_tbl = Table([[Paragraph(recommendation,
            S("ov_rec", fontSize=8.5, leading=13, textColor=colors.HexColor("#1F2937"),
              fontName="Helvetica", alignment=TA_JUSTIFY))]],
            colWidths=[usable_w])
        rec_tbl.setStyle(TableStyle([
            ("BACKGROUND",   (0, 0), (-1, -1), colors.HexColor("#EFF6FF")),
            ("LEFTPADDING",  (0, 0), (-1, -1), 14),
            ("TOPPADDING",   (0, 0), (-1, -1), 12),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 12),
            ("LINEBEFORE",   (0, 0), (0, -1), 4, KPMG_BLUE),
            ("BOX",          (0, 0), (-1, -1), 0.5, colors.HexColor("#BFDBFE")),
        ]))
        elements.append(rec_tbl)

    # ── AI-generated remediation plan (when available) ──────────────────────
    if recommended_actions:
        elements.append(Spacer(1, 4 * mm))
        elements.extend(section_header("", "AI-Generated Remediation Plan"))

        # Group by phase
        from collections import defaultdict
        by_phase = defaultdict(list)
        for a in recommended_actions:
            by_phase[a.get("phase", 2)].append(a)

        phase_labels = {0: "Immediate (Day 1–30)", 1: "Short-term (Day 31–60)", 2: "Ongoing (Day 61–90+)"}
        phase_colors = {0: colors.HexColor("#FEF2F2"), 1: colors.HexColor("#FFFBEB"), 2: colors.HexColor("#F0FDF4")}
        phase_borders = {0: KPMG_SLATE, 1: KPMG_WATCH_BLUE, 2: KPMG_GREEN}

        for phase in sorted(by_phase.keys()):
            actions = sorted(by_phase[phase], key=lambda a: a.get("day_target", 90))
            if not actions:
                continue

            elements.append(Paragraph(f"<b>{phase_labels[phase]}</b>",
                S(f"ph_{phase}", fontSize=9, fontName="Helvetica-Bold",
                  textColor=phase_borders[phase], spaceAfter=4, spaceBefore=8)))

            act_data = [[
                Paragraph("Day", S(f"ach0_{phase}", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
                Paragraph("Principle", S(f"ach1_{phase}", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
                Paragraph("Action", S(f"ach2_{phase}", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
                Paragraph("Effort", S(f"ach3_{phase}", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
                Paragraph("Owner", S(f"ach4_{phase}", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
            ]]
            for a in actions:
                effort = a.get("effort", "")
                effort_col = "#059669" if effort == "Low" else "#D97706" if effort == "Medium" else "#DC2626"
                act_data.append([
                    Paragraph(f'<b>{a.get("day_target", "—")}</b>',
                        S(f"adv_{a.get('day_target')}", fontSize=10, fontName="Helvetica-Bold",
                          textColor=phase_borders[phase], alignment=TA_CENTER)),
                    Paragraph(a.get("principle", ""), small_s),
                    Paragraph(a.get("action_text", ""), S(f"atxt_{phase}", fontSize=7.5, leading=11,
                        textColor=colors.HexColor("#1F2937"), fontName="Helvetica")),
                    Paragraph(f'<font color="{effort_col}"><b>{effort}</b></font>',
                        S(f"aef_{phase}", fontSize=7.5, fontName="Helvetica-Bold", alignment=TA_CENTER)),
                    Paragraph(a.get("owner_team", "—"), small_s),
                ])
            act_tbl = Table(act_data,
                colWidths=[14*mm, 30*mm, usable_w - 110*mm, 18*mm, 38*mm])
            act_tbl.setStyle(TableStyle([
                ("BACKGROUND",    (0, 0), (-1, 0),  phase_borders[phase]),
                ("TEXTCOLOR",     (0, 0), (-1, 0),  KPMG_WHITE),
                ("ROWBACKGROUNDS",(0, 1), (-1, -1), [KPMG_WHITE, phase_colors[phase]]),
                ("GRID",          (0, 0), (-1, -1), 0.4, KPMG_MID_GREY),
                ("TOPPADDING",    (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING",   (0, 0), (-1, -1), 6),
                ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN",         (0, 0), (0, -1), "CENTER"),  # Day col centred
                ("ALIGN",         (3, 0), (3, -1), "CENTER"),  # Effort col centred
            ]))
            elements.append(act_tbl)

        if not recs_generated:
            elements.append(Spacer(1, 3 * mm))
            elements.append(Paragraph(
                "Note: AI-tailored recommendations were not generated for this audit "
                "(Groq was unavailable during evaluation). Re-run the evaluation to generate "
                "specific day-targeted actions.",
                S("no_recs", fontSize=7.5, leading=11, textColor=KPMG_GREY,
                  fontName="Helvetica-Oblique")))

    elements.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 4 — DETAILED PRINCIPLE BREAKDOWN
    # ══════════════════════════════════════════════════════════════════════════
    elements.extend(section_header("4", "Detailed Principle Assessment",
        "Each principle is evaluated across multiple sub-parameters reflecting structural signals "
        "in the dataset. For each sub-parameter, this section explains: what it measures, "
        "what the score actually means for this AI system, and — where improvement is needed — "
        "a specific, actionable recommendation. Scores below 75 indicate areas with room for improvement."))

    for i, (pname, pdata) in enumerate(principles.items(), 1):
        sc = pdata.get("score", 0)
        params = pdata.get("parameters", {})
        p_color_hex = PRINCIPLE_COLORS.get(pname, "#00C896")
        p_color = colors.HexColor(p_color_hex)
        sc_color = score_to_color(sc)
        label = score_to_label(sc)
        desc = PRINCIPLE_DESCRIPTIONS.get(pname, "")

        # Principle donut (small)
        p_donut = _build_compliance_donut(sc, 60, 60)
        p_donut_img = _drawing_to_image(p_donut, 60, 60)

        # Principle header — clean card style with left accent border
        sc_color_hex = "#059669" if sc >= 75 else "#D97706" if sc >= 55 else "#DC2626"
        hdr_left = Paragraph(
            f'<b>{i}. {pname}</b>',
            S(f"ph{i}", fontSize=12, leading=16, textColor=KPMG_WHITE, fontName="Helvetica-Bold"))
        hdr_mid = Paragraph(
            f'{label}',
            S(f"ps{i}", fontSize=8, leading=12, textColor=colors.HexColor("#C7DCF0"),
              fontName="Helvetica", alignment=TA_RIGHT))
        # Score rendered on a white pill so colour is visible regardless of score
        hdr_score = Paragraph(
            f'<font color="{sc_color_hex}"><b>{sc}</b></font>',
            S(f"psc{i}", fontSize=20, leading=24, textColor=colors.HexColor(sc_color_hex),
              fontName="Helvetica-Bold", alignment=TA_CENTER))
        score_sub = Paragraph(
            "/100",
            S(f"psub{i}", fontSize=7, leading=9, textColor=colors.HexColor("#C7DCF0"),
              fontName="Helvetica", alignment=TA_CENTER))

        score_cell = Table([[hdr_score],[score_sub]], colWidths=[22*mm])
        score_cell.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor("#FFFFFF")),
            ("TOPPADDING",    (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING",   (0, 0), (-1, -1), 0),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ]))

        hdr_tbl = Table([[hdr_left, hdr_mid, score_cell]],
                        colWidths=[usable_w - 35*mm - 22*mm, 25*mm, 22*mm])
        hdr_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), KPMG_BLUE),
            ("TOPPADDING",    (0, 0), (-1, -1), 9),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ("LEFTPADDING",   (0, 0), (-1, -1), 10),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("LINEBELOW",     (0, 0), (-1, -1), 2.5, colors.HexColor("#0091DA")),
        ]))

        hdr_with_donut = hdr_tbl

        # Description
        desc_para = Paragraph(desc, S(f"pd{i}", fontSize=8, leading=12.5,
            textColor=colors.HexColor("#374151"), fontName="Helvetica",
            leftIndent=4, rightIndent=4, spaceBefore=5, spaceAfter=6,
            alignment=TA_JUSTIFY))

        # Sub-parameters table with definitions + mini progress bars
        sub_rows = [[
            Paragraph("Sub-Parameter", S(f"sph0_{i}", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
            Paragraph("Score &amp; Progress", S(f"sph1_{i}", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
            Paragraph("Status", S(f"sph2_{i}", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        ]]

        for param, val in params.items():
            v = int(val)
            vc = score_to_color(v)
            vl = score_to_label(v)
            vhex = "#059669" if v >= 75 else "#D97706" if v >= 55 else "#DC2626"
            bar_d = _build_subparam_minibar(v, 55, 8)
            bar_img = _drawing_to_image(bar_d, 55, 8)

            sub_rows.append([
                Paragraph(param, body_s),
                Table([[
                    bar_img,
                    Paragraph(f'<font color="{vhex}"><b> {v}</b></font>',
                              S(f"spv_{i}_{param}", fontSize=8, fontName="Helvetica-Bold")),
                ]], colWidths=[58, 32]),
                Paragraph(vl, small_s),
            ])

        sub_tbl = Table(sub_rows, colWidths=[80 * mm, 93, usable_w - 80 * mm - 93])
        sub_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, 0),  colors.HexColor("#F3F4F6")),
            ("FONTNAME",      (0, 0), (-1, 0),  "Helvetica-Bold"),
            ("FONTSIZE",      (0, 0), (-1, 0),  7.5),
            ("BACKGROUND",    (0, 0), (-1, 0),  KPMG_BLUE),
            ("ROWBACKGROUNDS",(0, 1), (-1, -1), [KPMG_WHITE, colors.HexColor("#FAFAFA")]),
            ("GRID",          (0, 0), (-1, -1), 0.4, KPMG_MID_GREY),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING",   (0, 0), (-1, -1), 7),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))

        # Sub-parameter definitions drill-down — rich version with score interpretation
        drill_items = [Paragraph("<b>Sub-Parameter Definitions, Score Interpretation &amp; Improvement Guidance</b>",
                                  S(f"dh_{i}", fontSize=8.5, fontName="Helvetica-Bold",
                                    textColor=KPMG_BLUE, spaceBefore=8, spaceAfter=4))]

        drill_items.append(Paragraph(
            f"The {pname} principle scored <b>{sc}/100</b>, indicating "
            f"<b>{score_to_label(sc)}</b> with KPMG Trusted AI standards. "
            + _principle_score_narrative(pname, sc, params),
            S(f"pnarr_{i}", fontSize=8, leading=12.5, textColor=colors.HexColor("#374151"),
              fontName="Helvetica", spaceAfter=6, alignment=TA_JUSTIFY)))

        for param, val in params.items():
            v = int(val)
            vhex = "#059669" if v >= 75 else "#D97706" if v >= 55 else "#DC2626"
            expl = _parameter_explanation(param, report)
            if isinstance(expl, tuple):
                rich_def, calc_note = expl
            else:
                rich_def, calc_note = "", str(expl)
            if not rich_def:
                rich_def = SUB_PARAMETER_DEFINITIONS.get(param, "")

            # Score meaning sentence
            score_meaning = _subparam_score_meaning(param, v)
            # Improvement guidance
            improvement = _subparam_improvement(param, v)

            # Param name line with inline score badge
            drill_items.append(Table([[
                Paragraph(f"<b>{param}</b>",
                    S(f"dn_{i}_{param}", fontSize=7.5, fontName="Helvetica-Bold",
                      textColor=colors.HexColor("#111827"))),
                Paragraph(f'<font color="{vhex}"><b>{v}/100 — {score_to_label(v)}</b></font>',
                    S(f"dnscore_{i}_{param}", fontSize=7.5, fontName="Helvetica-Bold",
                      alignment=TA_RIGHT)),
            ]], colWidths=[usable_w * 0.62, usable_w * 0.38],
            style=[
                ("TOPPADDING",    (0,0),(-1,-1), 5),
                ("BOTTOMPADDING", (0,0),(-1,-1), 2),
                ("LEFTPADDING",   (0,0),(-1,-1), 0),
                ("BACKGROUND",    (0,0),(-1,-1), colors.HexColor("#F0F4FA")),
                ("LINEBELOW",     (0,0),(-1,-1), 0.5, colors.HexColor("#CBD5E1")),
            ]))

            if rich_def:
                drill_items.append(Paragraph(rich_def, def_txt_s))

            # What this score means for this system
            drill_items.append(Paragraph(
                f"<b>What this score means:</b> {score_meaning}",
                S(f"dsm_{i}_{param}", fontSize=7.5, leading=11.5,
                  textColor=colors.HexColor("#374151"), fontName="Helvetica",
                  spaceAfter=2, leftIndent=8, alignment=TA_JUSTIFY)))

            # How to improve (only show if not already strong)
            if v < 85:
                drill_items.append(Paragraph(
                    f"<b>How to improve:</b> {improvement}",
                    S(f"dimp_{i}_{param}", fontSize=7.5, leading=11.5,
                      textColor=colors.HexColor("#1D4ED8"), fontName="Helvetica-Oblique",
                      spaceAfter=2, leftIndent=8, alignment=TA_JUSTIFY)))

            drill_items.append(Paragraph(
                f"<i>Calculation method: {calc_note}</i>", calc_txt_s))

        block = KeepTogether([
            hdr_with_donut,
            Spacer(1, 2),
            desc_para,
            sub_tbl,
            Spacer(1, 3),
            *drill_items,
            Spacer(1, 6 * mm),
        ])
        elements.append(block)

    elements.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 5 — DATASET DIAGNOSTICS
    # ══════════════════════════════════════════════════════════════════════════
    elements.extend(section_header("5", "Dataset Diagnostics",
        "Structural analysis of the ingested dataset underpins every score in this report. "
        "The metrics below reflect data completeness, schema consistency, and volume adequacy. "
        "Organisations are advised to address any gaps before the next audit cycle."))

    missing  = diagnostics.get("missing_ratio", 0)
    dupes    = diagnostics.get("duplicates", 0)
    schema_c = diagnostics.get("schema_confidence", 0)
    total_c  = diagnostics.get("total_columns", 0)
    text_c   = diagnostics.get("text_columns", 0)
    num_c    = diagnostics.get("numeric_columns", 0)
    col_names = diagnostics.get("column_names", [])

    def diag_status(val, good_thresh, warn_thresh, invert=False):
        if invert:
            return ("Good", KPMG_GREEN) if val <= good_thresh else ("Moderate", KPMG_WATCH_BLUE) if val <= warn_thresh else ("High", KPMG_SLATE)
        return ("Good", KPMG_GREEN) if val >= good_thresh else ("Moderate", KPMG_WATCH_BLUE) if val >= warn_thresh else ("Low", KPMG_SLATE)

    diag_data = [[
        Paragraph("Metric",         S("dgh0", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Value",          S("dgh1", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Status",         S("dgh2", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Interpretation", S("dgh3", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
    ]]

    diag_rows = [
        ("Total Records",     str(logs_evaluated),          ("Ingested", KPMG_BLUE),
         "Number of log entries processed by the audit pipeline."),
        ("Missing Data Ratio", f"{missing * 100:.1f}%",
         diag_status(missing, 0.05, 0.15, invert=True),
         "Proportion of fields with no value. Below 5% is acceptable."),
        ("Duplicate Records",  str(dupes),
         ("None detected", KPMG_GREEN) if dupes == 0 else ("Duplicates found", KPMG_SLATE),
         "Repeated records reduce data diversity and inflate volume metrics."),
        ("Schema Confidence",  f"{schema_c * 100:.1f}%",
         diag_status(schema_c, 0.85, 0.6),
         "Reliability of automated schema inference. >85% indicates a well-structured dataset."),
        ("Total Columns",      str(total_c),  ("\u2014", KPMG_GREY),
         "Total number of data fields in the uploaded dataset."),
        ("Text Columns",       str(text_c),   ("\u2014", KPMG_GREY),
         "String/text fields used for NLP and semantic analysis."),
        ("Numeric Columns",    str(num_c),    ("\u2014", KPMG_GREY),
         "Quantitative fields used for statistical scoring."),
        ("Data Quality Score", f"{dq_score}%",
         diag_status(dq_score, 80, 60),
         "Composite quality score combining completeness, schema confidence, and deduplication."),
    ]

    for label, val, (status_txt, status_col), interp in diag_rows:
        color_hex = status_col.hexval()[2:].upper()
        html = f'<font color="#{color_hex}"><b>{status_txt}</b></font>'
        diag_data.append([
            Paragraph(label, body_s),
            Paragraph(f"<b>{val}</b>", body_bold_s),
            Paragraph(html, small_s),
            Paragraph(interp, small_s),
        ])

    diag_tbl = Table(diag_data, colWidths=[46 * mm, 28 * mm, 28 * mm, usable_w - 102 * mm])
    diag_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0),  KPMG_BLUE),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  KPMG_WHITE),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [KPMG_WHITE, KPMG_LIGHT_GREY]),
        ("GRID",          (0, 0), (-1, -1), 0.5, KPMG_MID_GREY),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
    elements.append(diag_tbl)

    if col_names:
        elements.append(Spacer(1, 5 * mm))
        elements.append(Paragraph("<b>Detected Column Schema</b>", body_bold_s))
        elements.append(Spacer(1, 2))
        col_text = "  \u2502  ".join(col_names)
        elements.append(Paragraph(col_text,
            S("cols", fontSize=7.5, leading=12, textColor=KPMG_GREY,
              fontName="Helvetica", backColor=colors.HexColor("#F9FAFB"),
              borderPadding=(5, 8, 5, 8))))

    elements.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 6 — AI ACCURACY EVALUATION: LLM JUDGE PANEL
    # ══════════════════════════════════════════════════════════════════════════
    llm_judge = report.get("llm_judge") or {}
    elements.extend(section_header("6", "AI Response Accuracy Evaluation — LLM Judge Panel",
        "To evaluate the factual accuracy and correctness of the AI system's responses, TrustShield AI "
        "employs a Triple-LLM Judge Panel — an ensemble of three independent large language models "
        "from different providers. Each judge independently evaluates whether the AI's output is "
        "correct, and a majority vote (\u2265 2 out of 3) determines the final verdict per row. "
        "This approach substantially reduces single-model bias and delivers significantly higher "
        "confidence in accuracy assessments than any single-judge system."))

    # Why three judges box
    why_data = [[Paragraph(
        "<b>Why Three Independent Judges?</b>  Any single LLM can be wrong, biased toward verbose "
        "answers, or hallucinate a verdict. By running three architecturally different models from "
        "three different providers simultaneously, the panel achieves cross-provider independence: "
        "no shared weights, no shared fine-tuning, and no shared failure modes. The majority vote "
        "cancels out individual errors — a correct answer from 2/3 judges is exponentially more "
        "reliable than any single model's assessment. Rows where all three judges disagree are "
        "flagged as 'Disputed' and excluded from the accuracy calculation.",
        S("wt", fontSize=8, leading=12.5, textColor=colors.HexColor("#1E3A5F"),
          fontName="Helvetica", alignment=TA_JUSTIFY))]]
    why_tbl = Table(why_data, colWidths=[usable_w])
    why_tbl.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, -1), colors.HexColor("#EFF6FF")),
        ("LEFTPADDING",  (0, 0), (-1, -1), 12),
        ("TOPPADDING",   (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 10),
        ("LINEBEFORE",   (0, 0), (0, -1),  4, KPMG_LIGHT_BLUE),
        ("BOX",          (0, 0), (-1, -1), 0.5, colors.HexColor("#BFDBFE")),
    ]))
    elements.append(why_tbl)
    elements.append(Spacer(1, 5 * mm))

    # ── Judge Panel Table ───────────────────────────────────────────────────
    elements.append(Paragraph("<b>The Judge Panel — Three Independent AI Evaluators</b>",
        S("jph", fontSize=9, fontName="Helvetica-Bold", textColor=KPMG_BLUE, spaceAfter=4)))

    judge_panel_data = [[
        Paragraph("Judge",         S("jh0", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Model",         S("jh1", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Provider",      S("jh2", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Architecture",  S("jh3", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Specialisation",S("jh4", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
    ]]
    judges_info = [
        (
            "Judge 1",
            "Llama 3.3 70B Versatile",
            "Groq",
            "Meta LLaMA (open-weight transformer)",
            "Broad factual knowledge; strong at instruction-following and structured JSON output. "
            "Trained on diverse multilingual corpora with RLHF alignment."
        ),
        (
            "Judge 2",
            "Mistral Large",
            "OpenRouter / Mistral AI",
            "Mistral MoE (mixture-of-experts)",
            "Distinct architecture from Llama — different expert routing and attention patterns. "
            "Particularly strong on reasoning, code, and European-domain knowledge."
        ),
        (
            "Judge 3",
            "Qwen 2.5 72B Instruct",
            "Together AI / Alibaba",
            "Qwen transformer (multilingual, instruction-tuned)",
            "Trained primarily on Alibaba's data infrastructure. Strong on scientific, technical, "
            "and Asian-market domains. Adds maximum data-source diversity to the panel."
        ),
    ]
    for judge, model, provider, arch, spec in judges_info:
        judge_panel_data.append([
            Paragraph(f"<b>{judge}</b>", body_bold_s),
            Paragraph(model, body_s),
            Paragraph(provider, body_s),
            Paragraph(arch, small_s),
            Paragraph(spec, small_s),
        ])

    judge_tbl = Table(judge_panel_data,
                      colWidths=[18*mm, 42*mm, 28*mm, 42*mm, usable_w - 130*mm])
    judge_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0),  KPMG_BLUE),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  KPMG_WHITE),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [KPMG_WHITE, KPMG_LIGHT_GREY]),
        ("GRID",          (0, 0), (-1, -1), 0.5, KPMG_MID_GREY),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 7),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]))
    elements.append(judge_tbl)
    elements.append(Spacer(1, 5 * mm))

    # ── Two-Stage Workflow ───────────────────────────────────────────────────
    elements.append(Paragraph("<b>Evaluation Workflow — Two Stages per Log Row</b>",
        S("wfh", fontSize=9, fontName="Helvetica-Bold", textColor=KPMG_BLUE, spaceAfter=4)))

    wf_rows = [
        [Paragraph("Stage", S("wfsh", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
         Paragraph("Path", S("wfsh2", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
         Paragraph("What Happens", S("wfsh3", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE))],
        [Paragraph("<b>Stage 1A</b>", body_bold_s),
         Paragraph("Knowledge Base path\n(if KB provided)", small_s),
         Paragraph(
             "The question is looked up in the provided knowledge base using Jaccard word-overlap similarity. "
             "If a relevant chunk is found (similarity ≥ 0.12), it becomes the reference answer. "
             "This is the most reliable path — KB answers are treated as ground truth.",
             small_s)],
        [Paragraph("<b>Stage 1B</b>", body_bold_s),
         Paragraph("LLM Generation path\n(no KB or no match)", small_s),
         Paragraph(
             "All three judges independently generate what they believe is the correct answer to the question. "
             "Their answers are compared for agreement (Jaccard ≥ 0.15). The answer with highest average "
             "similarity to the other two becomes the reference. If judges disagree significantly, a warning "
             "is flagged and confidence is reduced.",
             small_s)],
        [Paragraph("<b>Stage 2</b>", body_bold_s),
         Paragraph("Majority Vote\n(both paths)", small_s),
         Paragraph(
             "All three judges vote: is the AI system's logged output CORRECT relative to the reference answer? "
             "Majority wins (≥ 2/3). Unanimous agreement → High confidence. Split 2/1 → Medium confidence. "
             "Disputed rows (tied) → flagged, excluded from accuracy. Final accuracy = correct rows ÷ judged rows.",
             small_s)],
    ]
    wf_tbl = Table(wf_rows, colWidths=[20*mm, 38*mm, usable_w - 58*mm])
    wf_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0),  KPMG_BLUE),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  KPMG_WHITE),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [KPMG_WHITE, KPMG_LIGHT_GREY]),
        ("GRID",          (0, 0), (-1, -1), 0.5, KPMG_MID_GREY),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]))
    elements.append(wf_tbl)
    elements.append(Spacer(1, 5 * mm))

    # ── Results (if llm_judge data present) ─────────────────────────────────
    if llm_judge:
        elements.append(Paragraph("<b>Accuracy Results for This Audit</b>",
            S("arh", fontSize=9, fontName="Helvetica-Bold", textColor=KPMG_BLUE, spaceAfter=4)))

        accuracy    = llm_judge.get("accuracy")
        rows_judged = llm_judge.get("rows_judged", 0)
        rows_skip   = llm_judge.get("rows_skipped", 0)
        panel_size  = llm_judge.get("panel_size", 0)
        panel_names = llm_judge.get("judge_panel", [])
        kb_count    = llm_judge.get("kb_chunks_count", 0)
        disputed    = len(llm_judge.get("disputed_rows", []))
        warnings    = llm_judge.get("warnings", [])
        labels      = llm_judge.get("labels", [])
        confs       = llm_judge.get("confidence", [])

        acc_pct = round(accuracy * 100) if accuracy is not None else None
        acc_color_hex = "#059669" if (acc_pct or 0) >= 80 else "#D97706" if (acc_pct or 0) >= 60 else "#DC2626"

        n_high   = sum(1 for c in confs if c == "high")
        n_med    = sum(1 for c in confs if c == "medium")
        n_low    = sum(1 for c in confs if c == "low")
        kb_used  = sum(1 for k in llm_judge.get("kb_used", []) if k)

        result_rows = [
            ("Accuracy (Majority Vote)",   f"{acc_pct}%" if acc_pct is not None else "N/A",
             acc_color_hex, "Proportion of AI responses judged correct by majority vote."),
            ("Rows Judged",                str(rows_judged),   "#1F2937",
             "Total log rows evaluated by the judge panel."),
            ("Rows Skipped",               str(rows_skip),    "#D97706" if rows_skip > 0 else "#059669",
             "Rows skipped due to missing data or judge API failure."),
            ("Disputed Rows",              str(disputed),     "#D97706" if disputed > 0 else "#059669",
             "Rows where judges could not reach majority agreement — excluded from accuracy."),
            ("Active Judges",              str(panel_size),   "#00338D",
             f"Number of active judges: {', '.join(panel_names) if panel_names else 'N/A'}."),
            ("High Confidence Verdicts",   str(n_high),       "#059669",
             "Rows where all 3 judges agreed (most reliable verdicts)."),
            ("Medium Confidence Verdicts", str(n_med),        "#D97706",
             "Rows where 2/3 judges agreed (solid but watch disputed cases)."),
            ("KB Reference Rows",          str(kb_used),      "#00338D",
             "Rows where the knowledge base was used as the reference (highest accuracy path)."),
        ]

        res_data = [[
            Paragraph("Metric",       S("rsh0", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
            Paragraph("Value",        S("rsh1", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
            Paragraph("Interpretation", S("rsh2", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        ]]
        for metric, val, col, interp in result_rows:
            # col may be a hex string without # or with
            hex_col = col if col.startswith("#") else f"#{col}"
            res_data.append([
                Paragraph(f"<b>{metric}</b>", body_bold_s),
                Paragraph(f'<font color="{hex_col}"><b>{val}</b></font>', body_bold_s),
                Paragraph(interp, small_s),
            ])

        res_tbl = Table(res_data, colWidths=[60*mm, 25*mm, usable_w - 85*mm])
        res_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, 0),  KPMG_BLUE),
            ("TEXTCOLOR",     (0, 0), (-1, 0),  KPMG_WHITE),
            ("ROWBACKGROUNDS",(0, 1), (-1, -1), [KPMG_WHITE, KPMG_LIGHT_GREY]),
            ("GRID",          (0, 0), (-1, -1), 0.5, KPMG_MID_GREY),
            ("TOPPADDING",    (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))
        elements.append(res_tbl)

        if warnings:
            elements.append(Spacer(1, 4 * mm))
            elements.append(Paragraph("<b>Evaluation Warnings</b>",
                S("ewh", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_AMBER, spaceAfter=3)))
            for w in warnings:
                elements.append(Paragraph(f"\u2022 {w}",
                    S("ew", fontSize=7.5, leading=11, textColor=colors.HexColor("#92400E"),
                      fontName="Helvetica", leftIndent=10)))
    else:
        elements.append(Paragraph(
            "No LLM judge accuracy evaluation was performed for this report. Accuracy evaluation "
            "requires a dataset with input/output columns and at least one configured judge API key "
            "(GROQ_API_KEY, OPENROUTER_API_KEY, or TOGETHER_API_KEY).",
            S("nojudge", fontSize=8, leading=12, textColor=KPMG_GREY, fontName="Helvetica-Oblique")))

    # ── Confidence Interpretation ─────────────────────────────────────────────
    elements.append(Spacer(1, 5 * mm))
    elements.append(Paragraph("<b>Confidence Level Interpretation</b>",
        S("cih", fontSize=9, fontName="Helvetica-Bold", textColor=KPMG_BLUE, spaceAfter=4)))

    conf_data = [[
        Paragraph("Level",          S("ch0", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Vote Pattern",   S("ch1", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Meaning",        S("ch2", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Recommended Action", S("ch3", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
    ]]
    conf_rows = [
        ("High",    "3/3 unanimous",  "#059669",
         "All three judges agree on the verdict.",
         "Trust the result. Use for production accuracy KPI reporting."),
        ("Medium",  "2/3 majority",   "#D97706",
         "Two judges agree; one dissents. Verdict is reliable but not unanimous.",
         "Acceptable for reporting. Review dissenting judge's reason for edge cases."),
        ("Low",     "Disputed / tied","#DC2626",
         "Judges could not reach majority agreement. Row is excluded from accuracy.",
         "Manual review required. These rows represent the hardest cases — consider adding KB context."),
    ]
    for level, pattern, col_hex, meaning, action in conf_rows:
        conf_data.append([
            Paragraph(f'<font color="{col_hex}"><b>{level}</b></font>', body_bold_s),
            Paragraph(pattern, small_s),
            Paragraph(meaning, small_s),
            Paragraph(action, small_s),
        ])

    conf_tbl = Table(conf_data, colWidths=[18*mm, 28*mm, 55*mm, usable_w - 101*mm])
    conf_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0),  KPMG_BLUE),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  KPMG_WHITE),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [KPMG_WHITE, KPMG_LIGHT_GREY]),
        ("GRID",          (0, 0), (-1, -1), 0.5, KPMG_MID_GREY),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]))
    elements.append(conf_tbl)

    elements.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════════════
    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 7 — BLACKBOX AUDIT SUMMARY (if available)
    # ══════════════════════════════════════════════════════════════════════════
    bb_summary = report.get("blackbox_audit_summary") or report.get("bb_summary") or {}
    bb_category_scores = bb_summary.get("category_scores") or {}
    bb_overall = bb_summary.get("overall_score")
    bb_risk = bb_summary.get("risk_level") or ""
    bb_findings = report.get("bb_findings") or []
    # Also try the probe_results count from blackbox_audits
    bb_probes_run = bb_summary.get("probes_run") or bb_summary.get("total_probes") or 0
    bb_fingerprint = report.get("fingerprint") or {}

    if bb_category_scores or bb_overall is not None:
        elements.extend(section_header("7", "Black Box Audit — Live System Probing Results",
            "The Black Box Audit fired adversarial probes directly at the live AI system's API endpoint "
            "and evaluated its responses across all 10 KPMG governance principles. Unlike the log-based "
            "SDCC analysis, these results reflect how the system actually behaves under adversarial pressure."))

        if bb_overall is not None:
            bb_sc_hex = "#059669" if bb_overall >= 75 else "#2563EB" if bb_overall >= 50 else "#64748B"
            bb_label = "Strong" if bb_overall >= 75 else "Watch" if bb_overall >= 50 else "Weak"

            bb_meta_data = [[
                Paragraph("Overall Probe Score", S("bbml", fontSize=7, fontName="Helvetica-Bold", textColor=KPMG_GREY, alignment=TA_CENTER)),
                Paragraph("Risk Level", S("bbml2", fontSize=7, fontName="Helvetica-Bold", textColor=KPMG_GREY, alignment=TA_CENTER)),
                Paragraph("Probes Run", S("bbml3", fontSize=7, fontName="Helvetica-Bold", textColor=KPMG_GREY, alignment=TA_CENTER)),
                Paragraph("Alignment", S("bbml4", fontSize=7, fontName="Helvetica-Bold", textColor=KPMG_GREY, alignment=TA_CENTER)),
            ],[
                Paragraph(f'<font color="{bb_sc_hex}"><b>{bb_overall}</b></font>', S("bbmv", fontSize=18, fontName="Helvetica-Bold", alignment=TA_CENTER)),
                Paragraph(f'<font color="{bb_sc_hex}"><b>{bb_risk or bb_label}</b></font>', S("bbmv2", fontSize=13, fontName="Helvetica-Bold", alignment=TA_CENTER)),
                Paragraph(f'<b>{bb_probes_run or "—"}</b>', S("bbmv3", fontSize=13, fontName="Helvetica-Bold", alignment=TA_CENTER, textColor=KPMG_BLUE)),
                Paragraph(f'<font color="{bb_sc_hex}"><b>{bb_label}</b></font>', S("bbmv4", fontSize=13, fontName="Helvetica-Bold", alignment=TA_CENTER)),
            ]]
            bb_meta_tbl = Table(bb_meta_data, colWidths=[usable_w / 4] * 4)
            bb_meta_tbl.setStyle(TableStyle([
                ("BACKGROUND",    (0, 0), (-1, 0),  colors.HexColor("#F1F5F9")),
                ("BACKGROUND",    (0, 1), (-1, 1),  colors.HexColor("#FAFBFD")),
                ("TOPPADDING",    (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LINEAFTER",     (0, 0), (-2, -1), 0.5, KPMG_MID_GREY),
                ("BOX",           (0, 0), (-1, -1), 0.5, KPMG_MID_GREY),
                ("LINEBEFORE",    (0, 0), (0, -1),  4, KPMG_BLUE),
            ]))
            elements.append(bb_meta_tbl)
            elements.append(Spacer(1, 4 * mm))

        # Category score table from blackbox
        if bb_category_scores:
            elements.append(Paragraph("<b>Probe Results by Governance Principle</b>",
                S("bbch", fontSize=9, fontName="Helvetica-Bold", textColor=KPMG_BLUE, spaceAfter=4)))

            bb_cat_data = [[
                Paragraph("Principle", S("bbcath0", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
                Paragraph("Score", S("bbcath1", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
                Paragraph("Alignment", S("bbcath2", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
                Paragraph("Probes", S("bbcath3", fontSize=7.5, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
            ]]
            for cat, cdata in sorted(bb_category_scores.items()):
                if isinstance(cdata, dict):
                    sc = cdata.get("pass_rate", cdata.get("score", 0))
                    if isinstance(sc, float) and sc <= 1.0:
                        sc = round(sc * 100)
                    sc = int(sc or 0)
                    n_probes = cdata.get("total", cdata.get("probes_run", "—"))
                else:
                    sc = int(float(cdata) * 100) if isinstance(cdata, float) and cdata <= 1 else int(cdata or 0)
                    n_probes = "—"
                sc_hex = "#059669" if sc >= 75 else "#2563EB" if sc >= 50 else "#64748B"
                label = "Strong" if sc >= 75 else "Watch" if sc >= 50 else "Weak"
                bb_cat_data.append([
                    Paragraph(f"<b>{cat}</b>", body_bold_s),
                    Paragraph(f'<font color="{sc_hex}"><b>{sc}</b></font>',
                        S(f"bbsc_{cat}", fontSize=12, leading=14, fontName="Helvetica-Bold", alignment=TA_CENTER)),
                    Paragraph(f'<font color="{sc_hex}">{label}</font>',
                        S(f"bblbl_{cat}", fontSize=8, fontName="Helvetica-Bold", alignment=TA_CENTER)),
                    Paragraph(str(n_probes), small_s),
                ])
            bb_cat_tbl = Table(bb_cat_data,
                colWidths=[50*mm, 25*mm, 28*mm, usable_w - 103*mm])
            bb_cat_tbl.setStyle(TableStyle([
                ("BACKGROUND",    (0, 0), (-1, 0),  KPMG_BLUE),
                ("TEXTCOLOR",     (0, 0), (-1, 0),  KPMG_WHITE),
                ("ROWBACKGROUNDS",(0, 1), (-1, -1), [KPMG_WHITE, KPMG_LIGHT_GREY]),
                ("GRID",          (0, 0), (-1, -1), 0.4, KPMG_MID_GREY),
                ("TOPPADDING",    (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING",   (0, 0), (-1, -1), 7),
                ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN",         (1, 0), (2, -1), "CENTER"),
            ]))
            elements.append(bb_cat_tbl)
            elements.append(Spacer(1, 4 * mm))

        elements.append(Paragraph(
            "Note: Black Box Audit scores reflect adversarial probe pass rates and are "
            "separate from the log-based SDCC governance scores. Both assessments contribute "
            "to the overall risk picture for this AI system.",
            S("bb_note", fontSize=7.5, leading=11, textColor=KPMG_GREY, fontName="Helvetica-Oblique")))
        elements.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 8 (was 7) — FRAMEWORK REFERENCE
    # ══════════════════════════════════════════════════════════════════════════
    elements.extend(section_header("8", "KPMG Trusted AI Framework — Reference Guide",
        "The KPMG Trusted AI Framework defines 10 interconnected principles organised around "
        "three core values: Values-led, Trustworthy, and Human-centric. These principles cover "
        "the full AI lifecycle from strategy and development through to deployment and monitoring. "
        "Each principle maps to specific governance requirements across the EU AI Act, ISO 42001, and NIST AI RMF."))

    core_values = {
        "Fairness":       "Values-led",
        "Transparency":   "Trustworthy",
        "Explainability": "Trustworthy",
        "Accountability": "Values-led",
        "Data Integrity": "Trustworthy",
        "Reliability":    "Trustworthy",
        "Security":       "Trustworthy",
        "Safety":         "Human-centric",
        "Privacy":        "Values-led",
        "Sustainability":  "Values-led",
    }
    focus_areas = {
        "Fairness":       "Equitable treatment across all demographic groups; bias monitoring and equal error rates",
        "Transparency":   "Openness about model capabilities, training data, limitations, and decision logic",
        "Explainability": "Interpretable outputs and confidence scores accessible to all stakeholder levels",
        "Accountability": "Clear governance structures, comprehensive audit trails, and escalation procedures",
        "Data Integrity": "Accurate, complete, and representative data pipelines with provenance tracking",
        "Reliability":    "Consistent performance under normal and adverse conditions with SLA compliance",
        "Security":       "Resilience against adversarial attacks, prompt injection, and cyber threats",
        "Safety":         "Proactive safeguarding against harm to people, businesses, and property",
        "Privacy":        "GDPR/CCPA compliance, data minimisation, and right-to-erasure by design",
        "Sustainability":  "Minimised environmental and compute footprint; energy-efficient architectures",
    }

    ref_data = [[
        Paragraph("Principle",    S("rh0", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Core Value",   S("rh1", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
        Paragraph("Key Focus Area", S("rh2", fontSize=8, fontName="Helvetica-Bold", textColor=KPMG_WHITE)),
    ]]
    for pname in principles.keys():
        ref_data.append([
            Paragraph(f'<b>{pname}</b>', body_bold_s),
            Paragraph(core_values.get(pname, "\u2014"), small_s),
            Paragraph(focus_areas.get(pname, "\u2014"), small_s),
        ])

    ref_tbl = Table(ref_data, colWidths=[40 * mm, 30 * mm, usable_w - 70 * mm])
    ref_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0),  KPMG_BLUE),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  KPMG_WHITE),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [KPMG_WHITE, KPMG_LIGHT_GREY]),
        ("GRID",          (0, 0), (-1, -1), 0.5, KPMG_MID_GREY),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
    elements.append(ref_tbl)
    elements.append(Spacer(1, 6 * mm))

    # Score legend
    elements.append(Paragraph("<b>Score Interpretation Guide</b>", body_bold_s))
    elements.append(Spacer(1, 3))
    legend_rows = [
        ("75 \u2013 100", "Strong",   KPMG_GREEN,      "The AI system demonstrates strong governance practices. Continue monitoring and document evidence for stakeholder reporting."),
        ("50 \u2013 74",  "Watch",    KPMG_WATCH_BLUE, "Moderate alignment detected with identifiable gaps. Targeted remediation is recommended within the next governance cycle."),
        ("0 \u2013 49",   "Weak",     KPMG_SLATE,      "Material improvement areas identified. Remediation actions should be prioritised before expanded deployment or regulatory review."),
    ]
    leg_data = []
    for rng, lbl, col, desc in legend_rows:
        leg_data.append([
            Paragraph(f'<font color="#{col.hexval()[2:]}"><b>{rng}</b></font>',
                      S(f"lg_{lbl}", fontSize=9, leading=12, fontName="Helvetica-Bold")),
            Paragraph(f'<font color="#{col.hexval()[2:]}"><b>{lbl}</b></font>',
                      S(f"lgl_{lbl}", fontSize=9, leading=12, fontName="Helvetica-Bold")),
            Paragraph(desc, small_s),
        ])
    leg_tbl = Table(leg_data, colWidths=[24 * mm, 30 * mm, usable_w - 54 * mm])
    leg_tbl.setStyle(TableStyle([
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW",     (0, 0), (-1, -2), 0.5, KPMG_MID_GREY),
        ("LEFTPADDING",   (0, 0), (-1, -1), 4),
    ]))
    elements.append(leg_tbl)

    # ── Build ─────────────────────────────────────────────────────────────
    doc.build(elements,
              onFirstPage=template.on_page,
              onLaterPages=template.on_page)

    buffer.seek(0)
    return buffer


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _friendly_report_id(ai_name: str, evaluated_at: str) -> str:
    """Generate a human-readable report ID: <AIName>_<YYYYMMDD>_<HHMM>"""
    try:
        dt = datetime.datetime.fromisoformat(evaluated_at)
        date_part = dt.strftime("%Y%m%d_%H%M")
    except Exception:
        date_part = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M")

    safe_name = "".join(c if c.isalnum() else "_" for c in ai_name.strip()).strip("_")
    safe_name = safe_name[:30]
    return f"{safe_name}_{date_part}"


# ─── List reports for current user ───────────────────────────────────────────
@router.get("")
def list_reports(current_user=Depends(get_current_user)):
    docs = list(
        reports_collection.find(
            {"owner_id": str(current_user["_id"])},
            {
                "_id": 0,
                "sample_records": 0,
                "trusted_ai_principles": 0,
                "risk_analysis.risk_items": 0,
            },
            sort=[("created_at", -1)],
            limit=50,
        )
    )
    for d in docs:
        if isinstance(d.get("created_at"), datetime.datetime):
            d["created_at"] = d["created_at"].isoformat()
    return {"reports": docs}


# ─── Single report by report_id ──────────────────────────────────────────────
@router.get("/{report_id}")
def get_report(report_id: str, current_user=Depends(get_current_user)):
    doc = reports_collection.find_one(
        {"report_id": report_id, "owner_id": str(current_user["_id"])},
        {"_id": 0, "sample_records": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found.")
    if isinstance(doc.get("created_at"), datetime.datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    return doc


# ─── PDF download ──────────────────────────────────────────────────────────────
@router.get("/{report_id}/pdf")
async def download_report_pdf(report_id: str, current_user=Depends(get_current_user)):
    report = reports_collection.find_one(
        {"report_id": report_id, "owner_id": str(current_user["_id"])}
    )

    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    buffer = build_pdf(report)

    # Friendly filename: <AIName>_<YYYYMMDD>_<HHMM>_AuditReport.pdf
    ai_name = report.get("ai_name", "AI")
    evaluated_at = report.get("evaluated_at", "")
    friendly_id = _friendly_report_id(ai_name, evaluated_at)
    filename = f"{friendly_id}_AuditReport.pdf"

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )