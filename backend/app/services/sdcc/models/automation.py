"""
services/sdcc/models/automation.py
=====================================
Automation / Agentic AI — Enterprise-grade evaluator.

Production hardening:
- error_rate uses text-heuristic (error keywords in output text) not column coverage
  (the original used _coverage(df,"error") which returned % of rows where "error"
   column EXISTS, not % of rows that contain errors — entirely different meaning)
- Step success/failure properly inferred from output text when no boolean column
- Sample-size warnings
"""

from __future__ import annotations
import pandas as pd
from app.services.sdcc.base_evaluator import BaseEvaluator


class AutomationEvaluator(BaseEvaluator):

    MODEL_TYPE  = "automation"
    LABEL       = "Automation / Agentic AI"
    DESCRIPTION = "AI agents executing multi-step workflows, RPA, or tool-calling pipelines"

    THRESHOLDS = {
        "step_success_rate":    {"low": 0.95, "moderate": 0.85, "unit": "ratio"},
        "task_completion_rate": {"low": 0.90, "moderate": 0.75, "unit": "ratio"},
        "error_rate":           {"low": 0.02, "moderate": 0.10, "unit": "ratio", "inverted": True},
        "avg_retry_rate":       {"low": 0.10, "moderate": 0.30, "unit": "count", "inverted": True},
        "avg_step_latency_ms":  {"low": 500,  "moderate": 2000, "unit": "ms",    "inverted": True},
    }

    TAF_METRIC_WEIGHTS = {
        # step_success_rate / task_completion_rate are the primary reliability signals
        "Reliability":     0.25,
        # error_rate triggers mandatory human-in-the-loop intervention
        "Accountability":  0.18,
        # failed automation steps can cause real downstream harm
        "Safety":          0.15,
        # retry_rate exposes overall system health to operations teams
        "Transparency":    0.12,
        # task_completion_rate ↔ accuracy of data being processed
        "Data Integrity":  0.10,
        # equitable task distribution and outcome parity across users
        "Fairness":        0.08,
        # error messages / step logs make decisions understandable
        "Explainability":  0.05,
        # latency ↔ compute and energy efficiency
        "Sustainability":  0.04,
        # automation pipelines handle personal data at each step
        "Privacy":         0.02,
        # pipeline injection / privilege-escalation risk
        "Security":        0.01,
    }  # sum = 1.00

    def model_metrics(self, df: pd.DataFrame, computed: dict | None = None) -> dict:
        c = computed or {}
        sw = self._validate_sample_size(len(df))

        # Infer error_rate from output text (keywords) when no numeric column exists
        # FIX: original used _coverage(df,"error") which returns % where column is non-null
        # Correct: infer from output text content
        err_val = c.get("error_rate")
        if err_val is None:
            err_val = self._mean(df, "error_rate")  # explicit numeric column
        if err_val is None:
            # Infer from output text
            out_col = self._col(df, "output","result","step_result","response")
            if out_col:
                ERROR_KWORDS = {"error","failed","failure","exception","timeout","crash","retry"}
                outputs = df[out_col].dropna().astype(str).str.lower().tolist()
                if outputs:
                    err_val = sum(
                        1 for o in outputs if any(k in o for k in ERROR_KWORDS)
                    ) / len(outputs)

        return {
            "step_success_rate": self._metric_result(
                c.get("step_success_rate") or self._bool_rate(df, "step_success","success","step_result","status"),
                f"Proportion of workflow steps completed successfully. [{sw['level']}: {sw['message']}]",
                "step_success_rate"),
            "task_completion_rate": self._metric_result(
                c.get("task_completion_rate") or self._bool_rate(df, "task_complete","completed","done"),
                "Proportion of end-to-end tasks completed without failure.",
                "task_completion_rate"),
            "error_rate": self._metric_result(
                err_val,
                "Proportion of steps raising errors (inferred from output keywords or explicit column).",
                "error_rate"),
            "avg_retry_rate": self._metric_result(
                c.get("avg_retry_rate") or self._mean(df, "retry_count","retries","attempts"),
                "Mean retries per step.",
                "avg_retry_rate"),
            "avg_step_latency_ms": self._metric_result(
                c.get("avg_step_latency_ms") or self._mean(df, "latency","step_duration","duration_ms"),
                "Mean step execution time in milliseconds.",
                "avg_step_latency_ms"),
        }

    def taf_principles(self, diagnostics: dict, logs_count: int, metrics: dict,
                       df: pd.DataFrame | None = None) -> dict:
        sp  = self._compute_sp(df)
        s   = self._structural(diagnostics, logs_count)
        c   = self.clamp
        G   = lambda key, fb, inv=False: self._sp(sp, key, fb, inv)
        M   = lambda key, inverted=False: self._mv(metrics, key, inverted)

        step  = M("step_success_rate")
        task  = M("task_completion_rate")
        err   = M("error_rate", inverted=True)
        retry = M("avg_retry_rate", inverted=True)
        lat   = M("avg_step_latency_ms", inverted=True)

        vol    = s["volume_score"];  schema = s["schema_score"]
        compl  = s["completeness"]; dup    = s["dup_penalty"]
        B      = lambda f: 100 if f else 0
        has_ts  = B(s["has_timestamp"]); has_uid = B(s["has_user_id"])
        has_ver = B(s["has_version"]);   has_err = B(s["has_error"])
        has_ovr = B(s["has_override"]);  has_lat = B(s["has_latency"])

        pp = {
            "Fairness": {
                "Task Success Equity":          c(0.5*step + 0.5*task),
                "Input Request Equity":         G("output_equity_score",         step),
                "User Group Fairness":          G("bias_measurement_coverage",   50),
                "Workflow Representativeness":  G("data_representativeness",     compl),
            },
            "Transparency": {
                "Step Result Logging Rate":     G("io_transparency",             schema),
                "Tool Call Visibility":         G("decision_logic_visibility",   40),
                "Workflow Step Disclosure":     G("responsible_disclosure",      40),
                "Model & Pipeline Versioning":  c(0.6*has_ver + 0.4*has_ts),
            },
            "Explainability": {
                "Step Reasoning Language":      G("reasoning_transparency",      40),
                "Error Explanation Quality":    G("error_acknowledgment_rate",   has_err),
                "Decision Traceability":        G("output_traceability",         c((has_uid+has_ts)//2)),
                "Human-Readable Step Outputs":  G("human_readable_outputs",      50),
            },
            "Accountability": {
                "Human Override on Failure":    c(0.5*G("human_oversight_signals",has_ovr)+0.5*has_ovr),
                "Step-Level Audit Coverage":    c(0.35*vol + 0.35*has_ts + 0.30*has_uid),
                "Governance & Compliance":      G("governance_compliance_lang",  schema//2),
                "Error & Exception Logging":    c(0.5*G("error_acknowledgment_rate",has_err)+0.5*has_err),
            },
            "Data Integrity": {
                "Step Result Validity":         step,
                "Workflow Schema Consistency":  G("schema_quality_score",        schema),
                "Data Completeness Rate":       G("data_completeness_text",      compl),
                "Deduplication Quality":        dup,
            },
            "Reliability": {
                "Step Success Rate":            step,
                "Task Completion Rate":         task,
                "Error Rate Control":           err,
                "Retry Rate Control":           retry,
            },
            "Security": {
                "Tool Input Injection Resistance":G("injection_rate",            80, inv=True),
                "Unauthorised Action Detection": G("harmful_content_rate",       80, inv=True),
                "PII in Workflow Payloads":      G("pii_in_outputs",             80, inv=True),
                "Input Validation Rate":         G("input_anomaly_rate",         80, inv=True),
            },
            "Safety": {
                "Human Override Capability":    c(0.5*G("human_override_signals",has_ovr)+0.5*has_ovr),
                "Unsafe Action Prevention":     c(0.5*err + 0.5*G("harm_prevention_rate",80,inv=True)),
                "Incident Response Signals":    G("incident_response_signals",   has_err),
                "Escalation Path Defined":      G("governance_compliance_lang",  has_ovr),
            },
            "Privacy": {
                "PII in Workflow Payloads":     G("pii_leakage_rate",            80, inv=True),
                "Workflow Data Minimisation":   G("data_minimisation_score",     60),
                "Output Anonymisation":         G("anonymisation_score",         60),
                "Data Retention Compliance":    G("data_retention_signals",      has_ts//2),
            },
            "Sustainability": {
                "Step Latency Efficiency":      lat,
                "Redundant Step Rate":          G("output_redundancy",           80, inv=True),
                "Workflow Deduplication":       G("lexical_redundancy",          80, inv=True),
                "Compute Efficiency Proxy":     G("token_economy",               60),
            },
        }
        result = self._assemble_principles(pp, metrics)
        sw = self._validate_sample_size(logs_count)
        for pdata in result.values():
            pdata["sample_size_warning"] = sw
        return result

    _STRUCTURAL_RECS = {
        "Fairness": {
            "Task Success Equity":          "Audit step success rates across user groups and task types.",
            "Input Request Equity":         "Ensure workflows handle all request types with equal reliability.",
            "User Group Fairness":          "Monitor task completion rates across user segments.",
            "Workflow Representativeness":  "Include diverse workflow types and user personas in testing.",
        },
        "Transparency": {
            "Step Result Logging Rate":     "Log the result of every workflow step.",
            "Tool Call Visibility":         "Log tool names, inputs, and outputs for every API call.",
            "Workflow Step Disclosure":     "Include step-level reasoning in workflow logs.",
            "Model & Pipeline Versioning":  "Version-stamp all pipeline configurations and model checkpoints.",
        },
        "Explainability": {
            "Step Reasoning Language":      "Include reasoning for each workflow decision in step logs.",
            "Error Explanation Quality":    "Log human-readable error messages with root cause analysis.",
            "Decision Traceability":        "Trace every output to the step and tool call that produced it.",
            "Human-Readable Step Outputs":  "Ensure step results are readable by operations teams.",
        },
        "Accountability": {
            "Human Override on Failure":    "Implement automated escalation to human review on step failure.",
            "Step-Level Audit Coverage":    "Log every step with timestamp, agent ID, and user attribution.",
            "Governance & Compliance":      "Ensure workflows comply with applicable policies; log compliance checks.",
            "Error & Exception Logging":    "Implement structured error logging for all failed steps.",
        },
        "Data Integrity": {
            "Step Result Validity":         "Validate step outputs before passing to the next step.",
            "Workflow Schema Consistency":  "Enforce schema validation at each workflow boundary.",
            "Data Completeness Rate":       "Ensure all step inputs and outputs are fully logged.",
            "Deduplication Quality":        "Deduplicate workflow execution logs before analysis.",
        },
        "Reliability": {
            "Step Success Rate":            "Add retry logic, timeouts, and fallback strategies.",
            "Task Completion Rate":         "Review workflow design; add end-to-end error handling.",
            "Error Rate Control":           "Implement structured error logging and automated alerting.",
            "Retry Rate Control":           "Add idempotency and circuit breaker patterns.",
        },
        "Security": {
            "Tool Input Injection Resistance":"Validate all tool inputs; reject injected commands.",
            "Unauthorised Action Detection": "Implement action whitelisting; log all external API calls.",
            "PII in Workflow Payloads":      "Scan workflow payloads for PII; redact before logging.",
            "Input Validation Rate":         "Validate all workflow inputs before execution.",
        },
        "Safety": {
            "Human Override Capability":    "Implement kill-switch mechanism for all workflow agents.",
            "Unsafe Action Prevention":     "Implement action safety checks before executing real-world actions.",
            "Incident Response Signals":    "Log all workflow failures as incidents; trigger automated alerts.",
            "Escalation Path Defined":      "Define and test escalation paths for all failure modes.",
        },
        "Privacy": {
            "PII in Workflow Payloads":     "Scan all workflow data for PII; implement redaction at each step.",
            "Workflow Data Minimisation":   "Only pass necessary data between workflow steps.",
            "Output Anonymisation":         "Anonymise user-identifying information in workflow logs.",
            "Data Retention Compliance":    "Implement workflow log retention policies.",
        },
        "Sustainability": {
            "Step Latency Efficiency":      "Profile slow steps; add async execution where possible.",
            "Redundant Step Rate":          "Remove unnecessary steps; implement step result caching.",
            "Workflow Deduplication":       "Deduplicate identical workflow runs; return cached results.",
            "Compute Efficiency Proxy":     "Optimise tool calls; batch API requests where possible.",
        },
    }

    def _rec_for_metric(self, m: str) -> str:
        return {
            "step_success_rate":    "Add retry logic, timeouts, and fallback strategies.",
            "task_completion_rate": "Review workflow design; add end-to-end error handling.",
            "error_rate":           "Implement structured error logging and automated alerting.",
            "avg_retry_rate":       "Add idempotency and circuit breaker patterns.",
            "avg_step_latency_ms":  "Profile bottlenecks; add async execution.",
        }.get(m, f"Investigate elevated risk in '{m}'.")

    def _context_for_rec(self, principle: str, worst_param: str) -> str:
        """Model-type-specific context for the Groq recommendation prompt."""
        if principle == "Fairness":
            return "Agentic automation systems may discriminate in who they route tasks to or whose requests they prioritise."
        if principle == "Security":
            return "Agentic systems with tool access are high-value targets — prompt injection can cause them to exfiltrate data or take destructive actions."
        if principle == "Privacy":
            return "Agentic systems often access multiple data sources — they can aggregate PII from several systems in ways that violate data minimisation."
        if principle == "Transparency":
            return "Agentic systems take sequences of autonomous actions — each action should be logged and explainable to affected users."
        if principle == "Explainability":
            return "Agentic systems' multi-step reasoning chains are often opaque — the connection between an input and a final action is hard to trace."
        if principle == "Accountability":
            return "Agentic systems that take real-world actions (send emails, book appointments) must have clear escalation paths and human override."
        if principle == "Reliability":
            return "Agentic systems can get stuck in loops or fail silently when a tool call fails — error handling and retry logic are commonly weak."
        if principle == "Data Integrity":
            return "Agentic systems may write to databases or external services — incorrect data written by an agent is harder to remediate than a wrong text output."
        if principle == "Safety":
            return "Agentic systems can cause irreversible harm through autonomous actions — a safety guardrail must exist before any write or external call."
        if principle == "Sustainability":
            return "Agentic systems make multiple LLM calls per task — the compound inference cost is significantly higher than a single-shot system."
        return ""