
"""
services/sdcc/models/image_cv.py
==================================
Computer Vision / Image Classification — Enterprise-grade evaluator.

Production hardening:
- Carbon Footprint Proxy computed from actual inference latency and dataset size
  instead of a hardcoded c(35)
- Confidence-based metrics use proper averaging with NaN guards
- Sample-size warnings
- All structural recs aligned with real sub-parameter names
"""

from __future__ import annotations
import pandas as pd
from app.services.sdcc.base_evaluator import BaseEvaluator


class ImageCVEvaluator(BaseEvaluator):

    MODEL_TYPE  = "image_classification"
    LABEL       = "Computer Vision / Image Classification"
    DESCRIPTION = "Object detection, image classification, and segmentation models"

    THRESHOLDS = {
        "map_score":        {"low": 0.60, "moderate": 0.40, "unit": "score"},
        "avg_iou":          {"low": 0.75, "moderate": 0.50, "unit": "score"},
        "top_k_accuracy":   {"low": 0.85, "moderate": 0.70, "unit": "ratio"},
        "avg_confidence":   {"low": 0.80, "moderate": 0.65, "unit": "score"},
        "label_coverage":   {"low": 0.95, "moderate": 0.80, "unit": "ratio"},
        "avg_inference_ms": {"low": 100,  "moderate": 500,  "unit": "ms", "inverted": True},
    }

    TAF_METRIC_WEIGHTS = {
        # mAP, avg_iou, top_k_accuracy directly measure prediction reliability
        "Reliability":     0.20,
        # label_coverage imbalance = class under-representation = fairness gap
        "Fairness":        0.18,
        # low avg_confidence = uncertain predictions = unacceptable safety risk
        "Safety":          0.14,
        # label_coverage + confidence = what the model detects and how openly
        "Transparency":    0.12,
        # confidence score = primary proxy for prediction explainability
        "Explainability":  0.10,
        # label_coverage + mAP = quality of annotated ground truth
        "Data Integrity":  0.10,
        # avg_inference_ms SLA determines feasibility of human review loops
        "Accountability":  0.07,
        # biometric / facial-recognition privacy implications
        "Privacy":         0.05,
        # adversarial patch robustness
        "Security":        0.02,
        # avg_inference_ms ↔ energy per inference
        "Sustainability":  0.02,
    }  # sum = 1.00

    def model_metrics(self, df: pd.DataFrame, computed: dict | None = None) -> dict:
        c = computed or {}
        sw = self._validate_sample_size(len(df))
        return {
            "map_score": self._metric_result(
                c.get("map_score") or self._mean(df, "map", "mean_average_precision", "map_score"),
                f"Mean Average Precision — primary detection metric. [{sw['level']}: {sw['message']}]",
                "map_score"),
            "avg_iou": self._metric_result(
                c.get("avg_iou") or self._mean(df, "iou", "intersection_over_union", "mean_iou"),
                "Mean Intersection-over-Union for bounding box predictions.",
                "avg_iou"),
            "top_k_accuracy": self._metric_result(
                c.get("top_k_accuracy") or self._mean(df, "top_k", "top_k_accuracy", "top5_acc"),
                "Top-K accuracy — proportion with confidence ≥ 0.5.",
                "top_k_accuracy"),
            "avg_confidence": self._metric_result(
                c.get("avg_confidence") or self._mean(df, "confidence_score", "confidence", "detection_score"),
                "Mean prediction confidence / detection score.",
                "avg_confidence"),
            "label_coverage": self._metric_result(
                c.get("label_coverage") or self._coverage(df, "label", "ground_truth", "annotation", "category"),
                "Proportion of images with ground-truth labels.",
                "label_coverage"),
            "avg_inference_ms": self._metric_result(
                c.get("avg_inference_ms") or self._mean(df, "latency", "inference_time", "duration_ms"),
                "Mean model inference time per image in milliseconds.",
                "avg_inference_ms"),
        }

    def taf_principles(self, diagnostics: dict, logs_count: int, metrics: dict,
                       df: pd.DataFrame | None = None) -> dict:
        sp  = self._compute_sp(df)
        s   = self._structural(diagnostics, logs_count)
        c   = self.clamp
        G   = lambda key, fb, inv=False: self._sp(sp, key, fb, inv)
        M   = lambda key, inverted=False: self._mv(metrics, key, inverted)

        mmap    = M("map_score");         iou  = M("avg_iou")
        topk    = M("top_k_accuracy");    conf = M("avg_confidence")
        lbl_cov = M("label_coverage");    lat  = M("avg_inference_ms", inverted=True)

        vol    = s["volume_score"];  schema = s["schema_score"]
        compl  = s["completeness"]; dup    = s["dup_penalty"]
        B      = lambda f: 100 if f else 0
        has_ts  = B(s["has_timestamp"]); has_uid = B(s["has_user_id"])
        has_ver = B(s["has_version"]);   has_err = B(s["has_error"])
        has_lbl = B(s["has_label"]);     has_ovr = B(s["has_override"])

        # Carbon footprint: CV models are compute-heavy.
        # Use inference latency + dataset size as a proxy.
        # Lower latency and smaller dataset = better carbon footprint.
        # If no latency metric: use size-based estimate.
        lat_raw = metrics.get("avg_inference_ms", {}).get("value")
        if lat_raw is not None:
            # > 200ms per image = high carbon; < 50ms = low
            carbon_proxy = c(max(0, 100 - max(0, lat_raw - 50) / 3))
        else:
            # Fall back to size-based heuristic: larger dataset = more inference = more carbon
            carbon_proxy = c(max(20, 80 - (logs_count / 10_000) * 20))

        pp = {
            "Fairness": {
                "Class Balance in Detections":   G("bias_measurement_coverage",  conf),
                "Detection Equity Across Groups":G("output_equity_score",        conf),
                "Label Class Representativeness":lbl_cov,
                "Fairness Monitoring Signals":   G("fairness_monitoring_signals",30),
            },
            "Transparency": {
                "Confidence Score Disclosure":   conf,
                "Bounding Box / Label Visibility":lbl_cov,
                "Detection Result Logging":      G("io_transparency",            schema),
                "Model Version Tracking":        c(0.6*has_ver + 0.4*has_ts),
            },
            "Explainability": {
                "Confidence Calibration":        conf,
                "mAP-IoU Alignment":             c(0.5*mmap + 0.5*iou),
                "Label Coverage for Validation": lbl_cov,
                "Detection Output Readability":  G("human_readable_outputs",     50),
            },
            "Accountability": {
                "Ground Truth Annotation Coverage":lbl_cov,
                "Human Review on Low Confidence":c(0.5*G("human_oversight_signals",has_ovr)+0.5*has_ovr),
                "Error & Misdetection Logging":  G("error_acknowledgment_rate",  has_err),
                "Audit Trail Coverage":          c(0.35*vol + 0.35*has_ts + 0.30*has_uid),
            },
            "Data Integrity": {
                "Label Coverage Rate":           lbl_cov,
                "Annotation Quality Score":      c(0.5*lbl_cov + 0.5*conf),
                "Ground Truth Accuracy":         c(0.5*mmap + 0.5*topk),
                "Dataset Schema Consistency":    G("schema_quality_score",       schema),
            },
            "Reliability": {
                "Mean Average Precision (mAP)":  mmap,
                "Mean IoU Score":                iou,
                "Top-K Accuracy":                topk,
                "Inference Consistency":         G("output_consistency_score",   compl),
            },
            "Security": {
                "Adversarial Input Resistance":  G("injection_rate",             80, inv=True),
                "PII/Biometric in Images":       G("pii_in_outputs",             60, inv=True),
                "Harmful Image Content Rate":    G("harmful_content_rate",       80, inv=True),
                "Input Validation Rate":         G("input_anomaly_rate",         80, inv=True),
            },
            "Safety": {
                "Misidentification Risk Control":c(0.5*conf + 0.5*mmap),
                "Human Override on Low Confidence":c(0.5*G("human_override_signals",has_ovr)+0.5*has_ovr),
                "Safety-Critical Recall":        topk,
                "Incident Response Signals":     G("incident_response_signals",  has_err),
            },
            "Privacy": {
                "Biometric PII Leakage Rate":    G("pii_leakage_rate",           60, inv=True),
                "Image Data Minimisation":       G("data_minimisation_score",    60),
                "Biometric Anonymisation":       G("anonymisation_score",        50),
                "Image Retention Compliance":    G("data_retention_signals",     has_ts//2),
            },
            "Sustainability": {
                "Inference Latency Efficiency":  lat,
                "Detection Compute Efficiency":  G("token_economy",              60),
                "Dataset Redundancy Rate":       G("lexical_redundancy",         80, inv=True),
                "Carbon Footprint Proxy":        carbon_proxy,   # computed, not hardcoded
            },
        }
        result = self._assemble_principles(pp, metrics)
        sw = self._validate_sample_size(logs_count)
        for pdata in result.values():
            pdata["sample_size_warning"] = sw
        return result

    _STRUCTURAL_RECS = {
        "Fairness": {
            "Class Balance in Detections":   "Audit detection rates across class categories; resample underrepresented classes.",
            "Detection Equity Across Groups":"Test detection performance on diverse demographic groups.",
            "Label Class Representativeness":"Ensure label distribution is representative; add underrepresented classes.",
            "Fairness Monitoring Signals":   "Add demographic labels to enable per-group performance analysis.",
        },
        "Transparency": {
            "Confidence Score Disclosure":   "Return confidence scores alongside all detection results.",
            "Bounding Box / Label Visibility":"Log bounding box coordinates, class labels, and scores.",
            "Detection Result Logging":      "Log all detection results with image IDs for auditability.",
            "Model Version Tracking":        "Version-stamp all model checkpoints; log version per inference.",
        },
        "Explainability": {
            "Confidence Calibration":        "Calibrate confidence scores; use temperature scaling.",
            "mAP-IoU Alignment":             "Investigate mAP/IoU divergence; review anchor sizes and NMS thresholds.",
            "Label Coverage for Validation": "Add ground-truth annotations for ≥95% of images.",
            "Detection Output Readability":  "Provide human-readable class descriptions alongside detection codes.",
        },
        "Accountability": {
            "Ground Truth Annotation Coverage":"Annotate ≥95% of images; implement annotation quality control.",
            "Human Review on Low Confidence": "Route detections below confidence threshold to human review.",
            "Error & Misdetection Logging":   "Log all false positives and false negatives for model improvement.",
            "Audit Trail Coverage":           "Log image ID, detection results, confidence, and timestamp per inference.",
        },
        "Data Integrity": {
            "Label Coverage Rate":           "Ensure all images have ground-truth annotations before evaluation.",
            "Annotation Quality Score":      "Implement annotation review process; use inter-annotator agreement.",
            "Ground Truth Accuracy":         "Audit annotation quality; correct labelling errors.",
            "Dataset Schema Consistency":    "Enforce consistent annotation schema across all datasets.",
        },
        "Reliability": {
            "Mean Average Precision (mAP)":  "Review anchor sizes, NMS thresholds, and class-specific recall.",
            "Mean IoU Score":                "Improve bounding box regression; increase data diversity.",
            "Top-K Accuracy":                "Investigate hard negatives; improve augmentation strategy.",
            "Inference Consistency":         "Reduce confidence variance across similar images.",
        },
        "Security": {
            "Adversarial Input Resistance":  "Test with adversarial patches; implement input validation.",
            "PII/Biometric in Images":       "Scan images for faces/license plates; implement anonymisation.",
            "Harmful Image Content Rate":    "Filter training and inference images for harmful content.",
            "Input Validation Rate":         "Validate image format and dimensions before inference.",
        },
        "Safety": {
            "Misidentification Risk Control":"In safety-critical domains, require confidence ≥ 0.9 before acting.",
            "Human Override on Low Confidence":"Route low-confidence detections to human review.",
            "Safety-Critical Recall":        "In medical/autonomous driving, optimise for recall over precision.",
            "Incident Response Signals":     "Log and alert on safety-critical misidentifications.",
        },
        "Privacy": {
            "Biometric PII Leakage Rate":    "Anonymise faces and biometric data before logging or sharing.",
            "Image Data Minimisation":       "Store only detection metadata; do not retain raw images beyond necessity.",
            "Biometric Anonymisation":       "Blur or pseudonymise faces in all logged images.",
            "Image Retention Compliance":    "Implement image retention policies; delete after defined period.",
        },
        "Sustainability": {
            "Inference Latency Efficiency":  "Use quantisation, TensorRT, or model pruning to reduce latency.",
            "Detection Compute Efficiency":  "Use lightweight architectures (MobileNet, EfficientDet) where precision allows.",
            "Dataset Redundancy Rate":       "Deduplicate training images; remove near-duplicate frames.",
            "Carbon Footprint Proxy":        "Use GPU efficiently; batch inference; target < 50ms per image.",
        },
    }

    def _rec_for_metric(self, m: str) -> str:
        return {
            "map_score":        "Review anchor sizes, NMS thresholds, class-specific recall.",
            "avg_iou":          "Improve bounding box regression; increase data diversity.",
            "top_k_accuracy":   "Investigate hard negatives; improve augmentation strategy.",
            "avg_confidence":   "Distribution shift detected; check train/test domain gap.",
            "label_coverage":   "Improve annotation pipeline to ≥95% coverage.",
            "avg_inference_ms": "Use quantisation, TensorRT, or model pruning.",
        }.get(m, f"Investigate elevated risk in '{m}'.")