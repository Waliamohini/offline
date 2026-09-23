/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import AuditContextBar, { LensFooter } from "../components/AuditContextBar";
import { useLocation, useNavigate } from "react-router-dom";

const M = "#005EB8";
const FF = "'Plus Jakarta Sans', system-ui, sans-serif";
const sc = (s: number) => s >= 75 ? "#059669" : s >= 50 ? M : "#64748B";
const sb = (s: number) => s >= 75 ? "#F0FDF4" : s >= 50 ? "#EFF6FF" : "#F1F5F9";
const band = (s: number) => s >= 75 ? "Strong" : s >= 50 ? "Watch" : "Critical";

// NOTE: not currently rendered anywhere on this page. Exported (not left
// unused) so it isn't silently discarded — looks like intended plain-English
// tooltip copy for technical parameter names that was never wired into the
// UI, rather than dead code.
export const PARAM_LABELS: Record<string, { label: string; plain: string }> = {
  "missing_ratio":       { label: "Missing Data", plain: "What % of log fields are empty or null" },
  "duplicates":          { label: "Duplicate Records", plain: "Identical rows in the dataset that skew results" },
  "schema_confidence":   { label: "Schema Confidence", plain: "How reliably the expected columns were detected" },
  "logs_evaluated":      { label: "Records Evaluated", plain: "Total log entries used for this audit" },
  "column_count":        { label: "Column Count", plain: "Number of data columns in the uploaded file" },
};

const METRIC_LABELS: Record<string, { label: string; plain: string }> = {
  "avg_latency_ms":      { label: "Response Latency", plain: "Average time the agent takes to produce a response (lower is better)" },
  "p95_latency_ms":      { label: "95th Percentile Latency", plain: "Worst-case latency for 95% of requests — used for SLA planning" },
  "error_rate":          { label: "Error Rate", plain: "Fraction of requests that returned an error or failed to respond" },
  "hallucination_rate":  { label: "Hallucination Rate", plain: "Fraction of responses containing fabricated or unsupported facts" },
  "pii_leakage_rate":    { label: "PII Leakage Rate", plain: "How often personal data appeared in the agent's outputs" },
  "toxicity_score":      { label: "Toxicity Score", plain: "Average harmfulness level of agent responses (lower is better)" },
  "avg_tokens":          { label: "Avg Response Length", plain: "Mean token count per response — indicates verbosity" },
  "response_length":     { label: "Response Length", plain: "Average length of responses in tokens" },
};

const NOTE_LABELS: Record<string, { label: string; plain: string }> = {
  "semantic_similarity":     { label: "Response Consistency", plain: "Do similar questions get similar answers?" },
  "sentiment_variance":      { label: "Tone Consistency", plain: "Is the agent's tone stable across different users?" },
  "response_coherence":      { label: "Response Coherence", plain: "Are individual responses logically well-structured?" },
  "hallucination_score":     { label: "Hallucination Score", plain: "How often does the agent state things that aren't true?" },
  "safety_score":            { label: "Safety Score", plain: "Overall safety rating from the LLM judge panel" },
  "bias_score":              { label: "Bias Score", plain: "How fairly does the agent respond across user groups?" },
  "bleu_score":              { label: "Answer Accuracy (BLEU)", plain: "How closely responses match expected reference answers" },
  "rouge_score":             { label: "Answer Overlap (ROUGE)", plain: "How much content from reference answers appears in responses" },
  "flesch_reading_ease":     { label: "Readability", plain: "How easy the agent's responses are to read and understand" },
  "lexical_diversity":       { label: "Vocabulary Range", plain: "Variety of language used — low diversity can indicate templated responses" },
  "pii_detection_rate":      { label: "PII in Outputs", plain: "How often personal data leaked into the agent's responses" },
  "input_output_relevance":  { label: "Relevance to Question", plain: "How closely each answer addresses what was actually asked" },
};

function humanise(key: string): string {
  if (NOTE_LABELS[key]) return NOTE_LABELS[key].label;
  if (METRIC_LABELS[key]) return METRIC_LABELS[key].label;
  return key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
function explain(key: string): string {
  if (NOTE_LABELS[key]) return NOTE_LABELS[key].plain;
  if (METRIC_LABELS[key]) return METRIC_LABELS[key].plain;
  return "";
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0;}body{background:#F8FAFC;}
.ab-card{background:#fff;border-radius: 0px;border:1px solid #E2E8F0;box-shadow:0 1px 3px rgba(0,0,0,0.05),0 4px 12px rgba(0,0,0,0.04);}
.ab-row{transition:background 0.12s;border-radius: 0px;}
.ab-row:hover{background:#F8FAFC;}
@keyframes abIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.ab-in{animation:abIn 0.32s cubic-bezier(.22,1,.36,1) both;}
`;


/* ── InfoTooltip ─────────────────────────────────────────────────────── */
function InfoTooltip({ text, width = 200 }: { text: string; width?: number }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", verticalAlign: "middle", marginLeft: 4, cursor: "help" }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
      {show && (
        <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", background: "#0F172A", color: "white", fontSize: 11.5, lineHeight: 1.5, padding: "7px 11px", borderRadius: 0, width, pointerEvents: "none", boxShadow: "0 4px 16px rgba(0,0,0,0.25)", zIndex: 9999, whiteSpace: "normal" as const }}>
          {text}
          <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", borderWidth: 5, borderStyle: "solid", borderColor: "#0F172A transparent transparent transparent" }} />
        </div>
      )}
    </span>
  );
}

export default function AgentBehaviour() {
  const location = useLocation();
  const navigate = useNavigate();
  const raw = location.state?.data || (() => { try { const s = sessionStorage.getItem("lastReportData"); return s ? JSON.parse(s) : null; } catch { return null; } })();
  const [, setAnim] = useState(false);
  useEffect(() => { setTimeout(() => setAnim(true), 100); }, []);

  if (!raw) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: FF }}>
      <button onClick={() => navigate("/dashboard")} style={{ padding: "10px 24px", background: M, border: "none", borderRadius: 0, color: "white", fontWeight: 700, cursor: "pointer" }}>← Back</button>
    </div>
  );

  const r = raw;
  const d = r.diagnostics || {};
  const dq            = r.data_quality_score || 0;
  const missing       = d.missing_ratio || 0;
  const completeness  = Math.round((1 - missing) * 100);
  const schemaScore   = Math.round((d.schema_confidence || 0) * 100);
  const dupCount      = d.duplicates || 0;
  const dupFreeRate   = Math.max(0, Math.min(100, Math.round(Math.max(0, 100 - (dupCount / Math.max(r.logs_evaluated || 1, 1)) * 500))));
  const volScore      = Math.min(100, Math.round((r.logs_evaluated || 0) / 100 * 100));
  const notes         = r.computation_notes ? Object.entries(r.computation_notes).filter(([k]) => k !== "_error") : [];
  const computed      = notes.filter(([, n]: any) => n.status === "computed");
  const unavailable   = notes.filter(([, n]: any) => n.status !== "computed");

  /* Build data quality cards — with plain English explanations */
  const DQ_CARDS = [
    {
      label: "Overall Data Quality",
      value: `${dq}%`,
      score: dq,
      formula: "(1 − missing_ratio) × 70 + schema_confidence × 30",
      explanation: dq >= 75
        ? `At ${dq}%, your dataset is in good shape. Missing values are low and the schema is well-structured. This supports reliable governance scoring.`
        : dq >= 50
        ? `At ${dq}%, your dataset has moderate quality. A missing-value rate of ${(missing * 100).toFixed(1)}% is reducing the reliability of principle scores.`
        : `At ${dq}%, data quality is poor. Missing fields and structural issues are significantly impacting audit accuracy. Clean the dataset before re-running.`,
    },
    {
      label: "Completeness",
      value: `${completeness}%`,
      score: completeness,
      formula: "(1 − missing_ratio) × 100",
      explanation: completeness >= 90
        ? `${completeness}% of all expected fields are populated — excellent. Near-complete data leads to the most accurate governance scores.`
        : `${completeness}% completeness means ${(missing * 100).toFixed(1)}% of fields are empty. Populate required columns (input, output, task_id, latency) for better results.`,
    },
    {
      label: "No Duplicate Records",
      value: dupCount === 0 ? "Clean" : `${dupCount} found`,
      score: dupFreeRate,
      formula: "clamp(100 − (duplicates / total) × 500, 0, 100)",
      explanation: dupCount === 0
        ? "No duplicate records detected. Clean deduplication prevents metrics from being artificially inflated."
        : `${dupCount} duplicate record${dupCount > 1 ? "s" : ""} found. Duplicates cause metrics like consistency and coherence to appear higher than they really are. Remove them before re-running.`,
    },
    {
      label: "Schema Confidence",
      value: `${schemaScore}%`,
      score: schemaScore,
      formula: "(1 − missing_ratio × 0.5) × 100",
      explanation: schemaScore >= 85
        ? `Schema confidence is ${schemaScore}%. The expected column structure was clearly detected — your data is well-formatted.`
        : `Schema confidence is ${schemaScore}%. Some expected columns may be missing or named differently. Verify your file includes: task_id, input, output, latency.`,
    },
    {
      label: "Log Volume",
      value: `${r.logs_evaluated || 0} records`,
      score: volScore,
      formula: "min(logs_evaluated / 100 × 100, 100)",
      explanation: (r.logs_evaluated || 0) >= 100
        ? `${r.logs_evaluated} records is a solid sample size for statistically reliable governance scoring.`
        : `Only ${r.logs_evaluated || 0} records uploaded. Aim for at least 100 records to get meaningful, statistically stable scores.`,
    },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: FF, color: "#0F172A" }}>
      <style>{CSS}</style>
      <AuditContextBar data={raw} />



      <div style={{ padding: "24px 40px 0" }}>

        {/* Summary strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
          {[
            { label: "Data Quality Score", val: `${dq}%`, score: dq, tip: "Composite score: (1 − missing_ratio) × 70 + schema_confidence × 30. Reflects how complete and well-structured your log data is." },
            { label: "Completeness",        val: `${completeness}%`, score: completeness, tip: "Percentage of log fields that are populated. 100% means no missing values — every row has all expected columns filled." },
            { label: "Log Records",          val: `${r.logs_evaluated || 0}`, score: volScore, tip: "Number of AI responses evaluated. More records = more statistically reliable governance scores. Under 50 records reduces confidence." },
            { label: "Structural Risk",      val: r.structural_risk || "—", score: r.structural_risk === "Low" ? 80 : r.structural_risk === "Moderate" ? 55 : 30, tip: "Risk from how your data is organised — missing columns, wrong types, or inconsistent schema. Low = well-structured. High = audit scores may be unreliable." },
          ].map((k, i) => (
            <div key={i} className="ab-card" style={{ padding: "16px 18px", borderTop: `3px solid ${sc(k.score)}` }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.6px", marginBottom: 7, display: "flex", alignItems: "center", gap: 4 }}>{k.label}{(k as any).tip && <InfoTooltip text={(k as any).tip} />}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: sc(k.score), lineHeight: 1 }}>{k.val}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 0, background: sb(k.score), color: sc(k.score), marginTop: 5, display: "inline-block", textTransform: "uppercase" }}>{band(k.score)}</div>
            </div>
          ))}
        </div>

        {/* ── Data quality breakdown ── */}
        <div className="ab-card ab-in" style={{ padding: "22px 28px", marginBottom: 16 }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#0F172A" }}>Data Quality Breakdown</div>
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 3 }}>Why each metric received its score — based on your uploaded dataset</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {DQ_CARDS.map((row, i) => (
              <div key={i} style={{
                padding: "16px 18px", borderRadius: 0,
                background: "#F8FAFC", border: `1px solid ${row.score >= 75 ? "rgba(5,150,105,0.15)" : row.score >= 50 ? "rgba(0,94,184,0.12)" : "#E2E8F0"}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>{row.label}</div>
                    <code style={{ fontSize: 10.5, background: "#fff", border: "1px solid #E2E8F0", borderRadius: 0, padding: "2px 7px", color: "#64748B", display: "inline-block" }}>{row.formula}</code>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: sc(row.score), lineHeight: 1 }}>{row.value}</div>
                    <div style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 0, background: sb(row.score), color: sc(row.score), marginTop: 4, display: "inline-block", textTransform: "uppercase" }}>{band(row.score)}</div>
                  </div>
                </div>
                {/* Progress bar */}
                <div style={{ height: 4, background: "#E2E8F0", borderRadius: 0, marginBottom: 10 }}>
                  <div style={{ width: `${Math.min(row.score, 100)}%`, height: "100%", borderRadius: 0, background: sc(row.score), transition: "width 0.9s ease" }}/>
                </div>
                <div style={{ fontSize: 12.5, color: "#475569", lineHeight: 1.7, padding: "10px 12px", background: "#fff", borderRadius: 0, border: "1px solid #E2E8F0" }}>
                  {row.explanation}
                </div>
              </div>
            ))}
          </div>

          {/* Detected columns */}
          {d.column_names && d.column_names.length > 0 && (
            <div style={{ marginTop: 14, padding: "14px 16px", borderRadius: 0, background: "#fff", border: "1px solid #E2E8F0" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: M, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 10 }}>Detected Columns ({d.column_names.length})</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {d.column_names.map((col: string) => {
                  const isKey = ["task_id", "input", "output", "latency"].some(k => col.toLowerCase().includes(k));
                  return (
                    <span key={col} style={{
                      padding: "4px 11px", borderRadius: 0, fontSize: 11.5, fontWeight: 500,
                      background: isKey ? "#DCFCE7" : "#F1F5F9",
                      color: isKey ? "#065F46" : "#475569",
                      border: isKey ? "1px solid rgba(5,150,105,0.25)" : "1px solid #E2E8F0",
                      fontFamily: "monospace",
                    }}>
                      {col}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Measured metrics ── */}
        {r.model_metrics && Object.values(r.model_metrics).some((m: any) => m.value !== null) && (
          <div className="ab-card ab-in" style={{ padding: "22px 28px", marginBottom: 16 }}>
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#0F172A" }}>Measured Agent Metrics</div>
              <div style={{ fontSize: 12, color: "#64748B", marginTop: 3 }}>Performance signals measured directly from your agent's outputs</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {Object.entries(r.model_metrics).filter(([, m]: any) => m.value !== null).map(([key, m]: any) => {
                const mc  = m.risk_level === "Low" ? "#059669" : m.risk_level === "Moderate" ? M : "#64748B";
                const mcBg = m.risk_level === "Low" ? "#F0FDF4" : m.risk_level === "Moderate" ? "#EFF6FF" : "#F1F5F9";
                const dv  = m.unit === "ms" ? `${Math.round(m.value)}ms` : (m.value < 1 ? `${(m.value * 100).toFixed(1)}%` : m.value.toFixed(2));
                const lbl = METRIC_LABELS[key]?.label || humanise(key);
                const exp = METRIC_LABELS[key]?.plain || m.description || "";
                return (
                  <div key={key} style={{ padding: "16px", borderRadius: 0, background: mcBg, border: `1px solid ${mc}20` }}>
                    <div style={{ fontSize: 10.5, color: "#64748B", fontWeight: 600, letterSpacing: "0.4px", marginBottom: 6, textTransform: "uppercase" }}>{lbl}</div>
                    <div style={{ fontSize: 24, fontWeight: 900, color: mc, marginBottom: 6, lineHeight: 1 }}>{dv}</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: mc, background: "#fff", border: `1px solid ${mc}40`, padding: "2px 8px", borderRadius: 0, fontWeight: 700 }}>{m.risk_level}</span>
                      {m.threshold_low !== undefined && <span style={{ fontSize: 10, color: "#94A3B8" }}>threshold: {m.threshold_low}{m.unit ? ` ${m.unit}` : ""}</span>}
                    </div>
                    {exp && <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.6 }}>{exp}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── NLP metric transparency ── */}
        {notes.length > 0 && (
          <div className="ab-card ab-in" style={{ padding: "22px 28px", marginBottom: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#0F172A" }}>NLP Metric Details</div>
                <div style={{ fontSize: 12, color: "#64748B", marginTop: 3 }}>Every score computed directly from input/output text using real NLP libraries</div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {[
                  { label: "Computed", count: computed.length, color: "#059669", bg: "#F0FDF4" },
                  { label: "Unavailable", count: unavailable.length, color: "#64748B", bg: "#F1F5F9" },
                ].map(({ label, count, color, bg }) => (
                  <div key={label} style={{ padding: "10px 16px", borderRadius: 0, background: bg, textAlign: "center", minWidth: 90 }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color }}>{count}</div>
                    <div style={{ fontSize: 10.5, color: "#64748B", marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {notes.map(([key, note]: any, i: number) => {
                const ok   = note.status === "computed";
                const lbl  = humanise(key);
                const exp  = explain(key);
                const val  = note.value !== null && note.value !== undefined
                  ? (note.value < 1 && note.value > 0 ? `${(note.value * 100).toFixed(1)}%` : note.value.toFixed ? note.value.toFixed(3) : String(note.value))
                  : "—";
                const nc   = ok ? M : "#94A3B8";
                return (
                  <div key={key} className="ab-row" style={{
                    display: "grid", gridTemplateColumns: "200px 80px 1fr 90px",
                    gap: 12, padding: "11px 12px", alignItems: "center",
                    borderBottom: i < notes.length - 1 ? "1px solid #F1F5F9" : "none",
                  }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0F172A" }}>{lbl}</div>
                      {exp && <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 1, lineHeight: 1.4 }}>{exp}</div>}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: nc, fontFamily: "monospace", textAlign: "right" }}>{val}</div>
                    <div style={{ fontSize: 11, color: "#64748B" }}>{note.library || ""}</div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 0, background: ok ? "#F0FDF4" : "#F1F5F9", color: ok ? "#059669" : "#64748B", border: ok ? "1px solid rgba(5,150,105,0.2)" : "1px solid #E2E8F0" }}>
                        {ok ? "computed" : "unavailable"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 40 }}>
        <LensFooter data={raw} />
      </div>
    </div>
  );
}