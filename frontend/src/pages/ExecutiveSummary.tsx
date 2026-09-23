/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import AuditContextBar, { LensFooter } from "../components/AuditContextBar";
import { useLocation, useNavigate } from "react-router-dom";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from "recharts";

const B = "#00338D", M = "#005EB8";
const FF = "'Plus Jakarta Sans', system-ui, sans-serif";

const sc   = (s: number) => s >= 75 ? "#059669" : s >= 50 ? "#2563EB" : "#64748B";
const scT  = (s: number) => s >= 75 ? "#059669" : s >= 50 ? "#2563EB" : "#475569";
const sb   = (s: number) => s >= 75 ? "#F0FDF4" : s >= 50 ? "#EFF6FF" : "#F1F5F9";
const band = (s: number) => s >= 75 ? "Strong" : s >= 50 ? "Watch" : "Critical";
const fmt  = (d: string) => { try { return new Date(d).toLocaleString("en-GB", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }); } catch { return d; } };

/* ── Narrative ────────────────────────────────────────────────────── */
function buildNarrative(r: any, highF: number, medF: number, weakPrn: string[]) {
  const name  = r.ai_name || "This agent";
  const score = r.overall_score;
  const ok    = score >= 75 && highF === 0;
  const opening = ok
    ? `${name} meets enterprise governance standards with a score of ${score}/100 and no high-severity findings. The agent is cleared for production deployment.`
    : highF > 0
    ? `${name} returned a score of ${score}/100 with ${highF} high-severity finding${highF > 1 ? "s" : ""} that must be resolved before production. These represent active deployment blockers.`
    : `${name} scored ${score}/100, satisfying baseline requirements with identifiable gaps. No deployment blockers detected.`;
  const middle = weakPrn.length > 0
    ? `The weakest governance dimensions are ${weakPrn.slice(0, 3).join(", ")}${weakPrn.length > 3 ? ` and ${weakPrn.length - 3} others` : ""}. Targeted remediation in these areas will have the highest impact on the next audit cycle.`
    : `All governance dimensions are performing at acceptable levels, with consistent alignment across the KPMG Trusted AI Framework.`;

  // Concrete, specific next step — names the actual dimensions/finding counts
  // driving the verdict instead of generic boilerplate like "engage the team".
  const topWeak = weakPrn.slice(0, 2).join(" and ");
  const closing = ok
    ? `Recommended action: Approve for production. Re-assess in 90 days${weakPrn.length > 0 ? ` — keep an eye on ${topWeak}, the closest dimension${weakPrn.length>1?"s":""} to the 75 threshold` : ""}.`
    : score >= 60
    ? `Recommended action: Conditional approval. Fix the ${highF + medF} open finding${highF+medF!==1?"s":""}${topWeak ? ` in ${topWeak}` : ""} first — those moves are the fastest path over the 75 threshold — then re-audit within 30 days.`
    : `Recommended action: Hold deployment. Start with ${topWeak || "the lowest-scoring dimensions"}: resolve the ${highF} high-severity finding${highF!==1?"s":""} there before anything else, since those are what's blocking production, then re-audit.`;
  return { opening, middle, closing };
}

/* ── Score arc ────────────────────────────────────────────────────── */
function Arc({ score, size = 96 }: { score: number; size?: number }) {
  const cx = size / 2, cy = size / 2, r = size * 0.36;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = sc(score);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display:"block" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F1F5F9" strokeWidth={size * 0.08}/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={size * 0.08}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`} style={{ transition:"stroke-dasharray 1.2s ease" }}/>
      <text x={cx} y={cy + 5} textAnchor="middle" fill="#0F172A" fontSize={size * 0.21} fontWeight="900" fontFamily={FF}>{score}</text>
    </svg>
  );
}

/* ── InfoTooltip ──────────────────────────────────────────────────── */
function InfoTooltip({ text, width = 200 }: { text: string; width?: number }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position:"relative", display:"inline-flex", alignItems:"center", verticalAlign:"middle", marginLeft:5, cursor:"help" }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
      {show && (
        <div style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)",
          background:"#0F172A", color:"white", fontSize:11.5, lineHeight:1.5, padding:"7px 11px", borderRadius:0,
          width, pointerEvents:"none", boxShadow:"0 4px 16px rgba(0,0,0,0.25)", zIndex:9999, whiteSpace:"normal" }}>
          {text}
          <div style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", borderWidth:5, borderStyle:"solid", borderColor:"#0F172A transparent transparent transparent" }}/>
        </div>
      )}
    </span>
  );
}

/* ── Gate check row ───────────────────────────────────────────────── */
function Gate({ pass, label, detail }: { pass: boolean; label: string; detail: string }) {
  return (
    <div style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"10px 12px", borderRadius:0, background:pass?"#F0FDF4":"#F8FAFC", border:`1px solid ${pass?"#BBF7D0":"#E2E8F0"}` }}>
      <div style={{ width:20, height:20, borderRadius:"50%", flexShrink:0, marginTop:1, display:"flex", alignItems:"center", justifyContent:"center", background:pass?"#059669":"#CBD5E1" }}>
        {pass
          ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>}
      </div>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:12.5, fontWeight:700, color:pass?"#059669":"#374151", marginBottom:1 }}>{label}</div>
        <div style={{ fontSize:11.5, color:"#64748B", lineHeight:1.4 }}>{detail}</div>
      </div>
    </div>
  );
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0;}body{background:#F8FAFC;}
.es-card{background:#fff;border-radius: 0px;border:1px solid #E2E8F0;box-shadow:0 1px 2px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.04);}
.es-bar{height:4px;background:#F1F5F9;border-radius: 0px;overflow:hidden;}
.es-bar-fill{height:100%;border-radius: 0px;transition:width 1s ease;}
.es-lens{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius: 0px;cursor:pointer;transition:background 0.12s;font-size:13px;font-weight:500;color:#374151;}
.es-lens:hover{background:#F1F5F9;}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.es-in{animation:fadeUp 0.35s cubic-bezier(.22,1,.36,1) both;}
.es-pill{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;padding:3px 10px;border-radius: 0px;letter-spacing:0.3px;}
`;

export default function ExecutiveSummary() {
  const location = useLocation();
  const navigate = useNavigate();
  const raw = location.state?.data || (() => { try { const s = sessionStorage.getItem("lastReportData"); return s ? JSON.parse(s) : null; } catch { return null; } })();
  const [, setAnim] = useState(false);
  useEffect(() => { setTimeout(() => setAnim(true), 60); }, []);

  if (!raw) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100vh", gap:14, fontFamily:FF, background:"#F8FAFC" }}>
      <div style={{ fontSize:15, color:"#64748B" }}>No audit data. Run a governance evaluation first.</div>
      <button onClick={() => navigate("/dashboard")} style={{ padding:"10px 24px", background:M, border:"none", borderRadius:0, color:"white", fontWeight:700, cursor:"pointer", fontSize:13 }}>⬅️ Go to Audit Pipeline</button>
    </div>
  );

  const r = raw;
  const prn        = r.trusted_ai_principles || {};
  const pkeys      = Object.keys(prn);
  const avgPrn     = pkeys.length ? Math.round(pkeys.reduce((s: number, k: string) => s + (prn[k]?.score || 0), 0) / pkeys.length) : 0;
  const highF      = (r.findings || []).filter((f: any) => f.severity === "High").length;
  const medF       = (r.findings || []).filter((f: any) => f.severity === "Medium").length;
  const lowF       = (r.findings || []).filter((f: any) => f.severity === "Low").length;
  const weakPrn    = pkeys.filter(k => (prn[k]?.score ?? 100) < 60);
  const deployReady = r.overall_score >= 75 && highF === 0;
  const narrative  = buildNarrative(r, highF, medF, weakPrn);

  const isRerun        = !!(r.parent_audit_id || (r.rerun_sequence && r.rerun_sequence > 1));
  const deltaSummary   = r.delta_summary || null;
  const rerunSequence  = r.rerun_sequence || null;
  const userContext    = r.operator_change_context || r.user_context || null;
  const principleDeltas: any[] = r.principle_deltas || [];
  const resolvedFindings: any[] = r.resolved_findings || [];
  const persistingFindings: any[] = r.persisting_findings || [];
  const newFindings: any[] = r.new_findings || [];

  // LLM Judge
  const llm        = r.llm_judge;
  const llmAcc     = llm?.accuracy != null ? Math.round(llm.accuracy * 100) : null;
  const llmGrounded = llm?.kb_grounded || llm?.kb_used?.some(Boolean) || false;
  const llmPanel   = llm?.judge_panel?.length || llm?.panel_size || (llm?.judge_model ? 1 : null);
  const llmDisputed = llm?.disputed_rows?.length ?? 0;
  const llmRows    = llm?.rows_judged || 0;

  // Data health (from diagnostics)
  const diag      = r.diagnostics || {};
  const missingPct = diag.missing_ratio != null ? Math.round(diag.missing_ratio * 100) : null;
  const schemaConf = diag.schema_confidence != null ? Math.round(diag.schema_confidence * 100) : null;
  const dupCount   = diag.duplicates ?? null;

  // Model identity
  const modelLabel  = (r.model_label || r.model_type || "—").replace(/_/g, " ");
  const detConf     = r.detection_confidence != null ? Math.round(r.detection_confidence * 100) : null;
  const auditSource = r.audit_source || (r.probe_results?.length ? "Black Box" : "Log Upload");
  const domain      = r.domain || r.ai_domain || r.ai_description_used || null;

  // Top priority recommendations — take highest severity findings first, cap at 3
  const topActions = [...(r.findings || [])]
    .sort((a: any, b: any) => {
      const o: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
      return (o[a.severity] ?? 3) - (o[b.severity] ?? 3);
    })
    .slice(0, 3);

  // Deployment gates
  const gates = [
    { pass: highF === 0,                  label: "No high-severity findings",       detail: highF === 0 ? "All critical governance checks passed." : `${highF} finding${highF>1?"s":""} must be resolved before deployment.` },
    { pass: r.overall_score >= 75,        label: "Governance score ≥ 75",           detail: `Current score: ${r.overall_score}/100. Threshold is 75 for production readiness.` },
    { pass: (r.data_quality_score||0) >= 60, label: "Data quality ≥ 60%",          detail: `Data quality: ${r.data_quality_score||0}%. Low data quality reduces score reliability.` },
    { pass: weakPrn.length <= 2,          label: "≤ 2 weak governance dimensions",  detail: weakPrn.length === 0 ? "All dimensions performing at acceptable levels." : `Weak: ${weakPrn.slice(0,3).join(", ")}${weakPrn.length>3?` +${weakPrn.length-3} more`:""}` },
    ...(llmAcc !== null ? [{ pass: llmAcc >= 70, label: "LLM Judge accuracy ≥ 70%", detail: `Current accuracy: ${llmAcc}%. Below 70% indicates unreliable response quality.` }] : []),
  ];
  const gatesPassed = gates.filter(g => g.pass).length;

  const LENS_LINKS = [
    { label:"Data Quality",          path:"/agent-behaviour",       desc:"Dataset completeness, schema confidence, NLP metrics" },
    { label:"LLM Analysis",          path:"/llm-analysis",          desc:"Accuracy probe results and safety scoring"            },
    { label:"Governance Principles", path:"/governance-principles", desc:"10-dimension KPMG Trusted AI assessment"              },
    { label:"Framework Alignment",  path:"/regulatory-alignment",  desc:"EU AI Act, ISO 42001, NIST framework compliance"     },
    { label:"Risk Profile",          path:"/risk-intelligence",     desc:"Severity breakdown and remediation actions"          },
    { label:"Recommendations",       path:"/recommendations",       desc:"Per-principle remediation roadmap"                   },
  ];
  const nav = (path: string) => navigate(path, { state:{ data:r } });

  return (
    <div style={{ minHeight:"100vh", background:"#F8FAFC", fontFamily:FF, color:"#0F172A" }}>
      <style>{CSS}</style>
      <AuditContextBar data={r} />

      {/* ── RERUN DELTA BANNER ─────────────────────────────────────── */}
      {isRerun && deltaSummary && (
        <div style={{ background:"linear-gradient(135deg,#1E3A8A,#2563EB)", padding:0 }}>
          <div style={{ padding:"14px 40px", display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" as const }}>
            <span style={{ fontSize:16 }}>🔄</span>
            <div style={{ flex:1, minWidth:200 }}>
              <div style={{ fontSize:13, fontWeight:800, color:"white" }}>Re-run #{rerunSequence} Comparison</div>
              {userContext && <div style={{ fontSize:11, color:"rgba(255,255,255,0.65)", marginTop:2 }}>"{userContext.slice(0,100)}{userContext.length>100?"…":""}"</div>}
            </div>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap" as const }}>
              {[
                { label:"Score",       val:`${deltaSummary.overall_score_change>=0?"+":""}${deltaSummary.overall_score_change}`, color:deltaSummary.overall_score_change>=0?"#6EE7B7":"#FCA5A5" },
                { label:"Resolved",    val:deltaSummary.resolved_count,   color:"#6EE7B7" },
                { label:"Regressed",   val:deltaSummary.regressed_count,  color:deltaSummary.regressed_count>0?"#FCA5A5":"rgba(255,255,255,0.5)" },
                { label:"New Findings",val:deltaSummary.new_finding_count??0, color:(deltaSummary.new_finding_count??0)>0?"#FDE68A":"rgba(255,255,255,0.5)" },
              ].map(s => (
                <div key={s.label} style={{ textAlign:"center", padding:"8px 14px", background:"rgba(255,255,255,0.1)", borderRadius:0 }}>
                  <div style={{ fontSize:18, fontWeight:900, color:s.color, lineHeight:1 }}>{s.val}</div>
                  <div style={{ fontSize:9.5, color:"rgba(255,255,255,0.55)", marginTop:2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
          {principleDeltas.filter((pd: any) => !pd.not_reprobed).length > 0 && (
            <div style={{ padding:"0 40px 14px", display:"flex", gap:6, flexWrap:"wrap" as const }}>
              {principleDeltas.filter((pd: any) => !pd.not_reprobed).map((pd: any) => {
                const mlColors: Record<string, {color:string;bg:string}> = { RESOLVED:{color:"#059669",bg:"#DCFCE7"}, REGRESSED:{color:"#DC2626",bg:"#FEE2E2"}, IMPROVING:{color:"#0284C7",bg:"#E0F2FE"}, WORSENING:{color:"#D97706",bg:"#FEF3C7"}, UNCHANGED:{color:"#64748B",bg:"#F1F5F9"} };
                const ml = mlColors[pd.movement_label||"UNCHANGED"]||mlColors.UNCHANGED;
                const icons: Record<string,string> = { RESOLVED:"✅", REGRESSED:"❌", IMPROVING:"📈", WORSENING:"📉", UNCHANGED:"➖" };
                return (
                  <div key={pd.principle} style={{ padding:"3px 9px", borderRadius:0, background:ml.bg, fontSize:10.5, fontWeight:700, color:ml.color, display:"flex", gap:4, alignItems:"center" }}>
                    <span>{icons[pd.movement_label||"UNCHANGED"]}</span>
                    <span>{pd.principle}</span>
                    <span style={{ opacity:0.7 }}>{pd.prior_score}→{pd.current_score}</span>
                  </div>
                );
              })}
            </div>
          )}
          {(resolvedFindings.length+persistingFindings.length+newFindings.length)>0 && (
            <div style={{ padding:"0 40px 14px", display:"flex", gap:8 }}>
              {resolvedFindings.length>0 && <span style={{ fontSize:11, fontWeight:700, color:"#DCFCE7", background:"rgba(5,150,105,0.25)", padding:"3px 10px", borderRadius:0 }}>✅ {resolvedFindings.length} Resolved</span>}
              {persistingFindings.length>0 && <span style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.7)", background:"rgba(255,255,255,0.1)", padding:"3px 10px", borderRadius:0 }}>⭕ {persistingFindings.length} Persisting</span>}
              {newFindings.length>0 && <span style={{ fontSize:11, fontWeight:700, color:"#FDE68A", background:"rgba(217,119,6,0.25)", padding:"3px 10px", borderRadius:0 }}>⚡ {newFindings.length} New</span>}
            </div>
          )}
        </div>
      )}

      <div style={{ padding:"24px 40px 0" }}>

        {/* ── VERDICT HERO ─────────────────────────────────────────── */}
        <div className="es-card es-in" style={{ padding:"26px 28px", marginBottom:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:6 }}>
            <div style={{ fontSize:10.5, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.8px" }}>Audit Verdict</div>
            <InfoTooltip
              width={270}
              text="Approved: score 75+ with zero high-severity findings. Conditional: score 60–74 (or 75+ with open findings). Hold: score below 60. All three are based on the overall average across the 10 governance dimensions."
            />
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:24, alignItems:"start" }}>
            <div>
              <div style={{ fontSize:17, fontWeight:900, color:"#0F172A", marginBottom:4, letterSpacing:"-0.3px" }}>
                {deployReady ? "Approved for Deployment" : r.overall_score >= 60 ? "Conditional — Remediation Required" : "Hold — Significant Gaps Identified"}
              </div>
              <div style={{ fontSize:12, color:"#94A3B8", marginBottom:18 }}>
                {deployReady
                  ? `Score ${r.overall_score}/100 with no high-severity findings — clears the 75-point Approved bar.`
                  : r.overall_score >= 60
                  ? `Score ${r.overall_score}/100 — above the 60-point Hold line, but ${75 - r.overall_score} point${75 - r.overall_score !== 1 ? "s" : ""} short of the 75-point Approved bar.`
                  : `Score ${r.overall_score}/100 — ${60 - r.overall_score} point${60 - r.overall_score !== 1 ? "s" : ""} short of the 60-point Conditional threshold.`}
              </div>

              {/* Scannable stat rows instead of one dense paragraph */}
              <div style={{ display:"grid", gap:11, marginBottom:16 }}>
                <div style={{ display:"flex", gap:10, alignItems:"baseline" }}>
                  <span style={{ fontSize:11, fontWeight:700, color:"#64748B", textTransform:"uppercase", letterSpacing:"0.4px", width:118, flexShrink:0 }}>Findings</span>
                  <span style={{ fontSize:13, color:"#334155", lineHeight:1.6 }}>
                    {highF > 0
                      ? <><strong style={{ color:"#DC2626" }}>{highF} high-severity</strong>{medF > 0 ? <> and <strong>{medF} medium</strong></> : ""} — high-severity findings are what block production.</>
                      : medF > 0
                      ? <><strong>{medF} medium-severity</strong> — no deployment blockers, but worth addressing.</>
                      : "None — all governance checks passed."}
                  </span>
                </div>
                <div style={{ display:"flex", gap:10, alignItems:"baseline" }}>
                  <span style={{ fontSize:11, fontWeight:700, color:"#64748B", textTransform:"uppercase", letterSpacing:"0.4px", width:118, flexShrink:0 }}>Weakest areas</span>
                  <span style={{ fontSize:13, color:"#334155", lineHeight:1.6 }}>
                    {weakPrn.length > 0
                      ? <><strong>{weakPrn.slice(0,3).join(", ")}</strong>{weakPrn.length > 3 ? ` +${weakPrn.length - 3} more` : ""} — each scored below 60/100.</>
                      : "None — every dimension scored 60 or above."}
                  </span>
                </div>
              </div>

              {/* Recommended action — its own callout, not buried in prose */}
              <div style={{
                padding:"12px 14px", borderRadius:0,
                background: deployReady ? "#F0FDF4" : r.overall_score >= 60 ? "#FFFBEB" : "#FEF2F2",
                border:`1px solid ${deployReady ? "#86EFAC" : r.overall_score >= 60 ? "#FDE68A" : "#FECACA"}`,
              }}>
                <div style={{ fontSize:10.5, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.5px", color: deployReady ? "#166534" : r.overall_score >= 60 ? "#92400E" : "#991B1B", marginBottom:4 }}>
                  Recommended action
                </div>
                <div style={{ fontSize:13, lineHeight:1.65, color:"#334155" }}>
                  {narrative.closing.replace(/^Recommended action:\s*/, "")}
                </div>
              </div>
            </div>

            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, flexShrink:0 }}>
              <Arc score={r.overall_score} size={96} />
              <div style={{ display:"flex", alignItems:"center", gap:3 }}>
                <div style={{ fontSize:11, fontWeight:700, color:scT(r.overall_score), textTransform:"uppercase", letterSpacing:"0.5px" }}>Avg tier: {band(r.overall_score)}</div>
                <InfoTooltip
                  width={250}
                  text="Based on the overall average score across all 10 dimensions. The risk badge at the top of the page uses a stricter rule instead — it shows 'Critical' if even one dimension scores below 40, regardless of this average, so the two can legitimately disagree."
                />
              </div>
              <div style={{ padding:"3px 10px", borderRadius:0, background:sb(r.overall_score), fontSize:10.5, fontWeight:600, color:scT(r.overall_score) }}>
                {deployReady ? "Deploy ready" : "Needs work"}
              </div>
            </div>
          </div>
        </div>

        {/* ── TWO-COLUMN BODY ──────────────────────────────────────── */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 252px", gap:20, alignItems:"start" }}>

          {/* LEFT */}
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

            {/* ── 1. AGENT IDENTITY ─────────────────────────────────── */}
            <div className="es-card" style={{ padding:"20px 24px" }}>
              <div style={{ fontSize:13, fontWeight:800, color:"#0F172A", marginBottom:14 }}>Agent Identity</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:14 }}>
                {[
                  { label:"AI System Type",    val:modelLabel,  tip:"Detected from log structure and column patterns. Affects which governance metrics are applied." },
                  { label:"Detection Confidence", val:detConf!=null?`${detConf}%`:"—", tip:"How confident the system is in its model type classification. <70% means some metrics may use fallback methods." },
                  { label:"Audit Source",      val:auditSource, tip:"How the audit data was collected — live API/UI probing (Black Box) or log file upload (SDCC)." },
                ].map((k, i) => (
                  <div key={i} style={{ padding:"12px 14px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E2E8F0" }}>
                    <div style={{ fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.5px", marginBottom:6, display:"flex", alignItems:"center" }}>
                      {k.label}<InfoTooltip text={k.tip} width={200}/>
                    </div>
                    <div style={{ fontSize:14, fontWeight:800, color:"#0F172A" }}>{k.val}</div>
                  </div>
                ))}
              </div>
              {/* Domain / description row */}
              {domain && (
                <div style={{ padding:"10px 14px", borderRadius:0, background:"#EEF4FF", border:`1px solid ${M}20`, fontSize:12.5, color:"#1E3A5F", lineHeight:1.6 }}>
                  <span style={{ fontWeight:700, color:M }}>Domain / context: </span>{domain}
                </div>
              )}
              {/* Evaluated at + log count inline */}
              <div style={{ display:"flex", gap:16, marginTop:12, fontSize:12, color:"#64748B" }}>
                <span>Evaluated: <strong style={{ color:"#374151" }}>{r.evaluated_at ? fmt(r.evaluated_at) : "—"}</strong></span>
                <span>Records: <strong style={{ color:"#374151" }}>{r.logs_evaluated||0}</strong></span>
                {r.report_id && <span>Report ID: <strong style={{ color:"#374151", fontFamily:"monospace" }}>#{r.report_id.slice(0,10)}</strong></span>}
                {isRerun && <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"1px 8px", borderRadius:0, background:"#E0F2FE", color:"#0284C7", fontWeight:700, fontSize:11 }}>🔄 Re-run #{rerunSequence}</span>}
              </div>
            </div>

            {/* ── 2. GOVERNANCE DIMENSIONS ──────────────────────────── */}
            {pkeys.length > 0 && (
              <div className="es-card" style={{ padding:"20px 24px" }}>
                <div style={{ fontSize:13.5, fontWeight:800, color:"#0F172A", marginBottom:14 }}>Governance Dimensions</div>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {[...pkeys].sort((a,b) => (prn[a]?.score||0)-(prn[b]?.score||0)).map(k => {
                    const s = prn[k]?.score || 0;
                    return (
                      <div key={k} style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ fontSize:12, fontWeight:500, color:"#374151", minWidth:128, flexShrink:0 }}>{k}</div>
                        <div className="es-bar" style={{ flex:1 }}>
                          <div className="es-bar-fill" style={{ width:`${s}%`, background:sc(s) }}/>
                        </div>
                        <div style={{ fontSize:12.5, fontWeight:800, color:sc(s), minWidth:28, textAlign:"right" }}>{s}</div>
                        <div style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:0, background:sb(s), color:sc(s), minWidth:52, textAlign:"center" }}>{band(s)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── 2b. GOVERNANCE RADAR CHART ────────────────────────── */}
            {pkeys.length > 0 && (
              <div className="es-card" style={{ padding:"20px 24px" }}>
                <div style={{ fontSize:13.5, fontWeight:800, color:"#0F172A", marginBottom:4 }}>Governance Radar</div>
                <div style={{ fontSize:12, color:"#94A3B8", marginBottom:16 }}>Visual coverage across all {pkeys.length} KPMG principles — green dashed line marks the 75-point target</div>
                <ResponsiveContainer width="100%" height={340}>
                  <RadarChart
                    data={pkeys.map(k => ({
                      subject: k,
                      score: prn[k]?.score || 0,
                      target: 75,
                    }))}
                    margin={{ top:16, right:32, left:32, bottom:16 }}
                  >
                    <PolarGrid stroke="#E2E8F0" />
                    <PolarAngleAxis
                      dataKey="subject"
                      tick={{ fontSize:11.5, fill:"#475569", fontWeight:600 }}
                    />
                    <PolarRadiusAxis
                      angle={90}
                      domain={[0, 100]}
                      tick={{ fontSize:9.5, fill:"#CBD5E1" }}
                      tickCount={5}
                      axisLine={false}
                    />
                    {/* Target zone at 75 */}
                    <Radar
                      name="Target (75)"
                      dataKey="target"
                      stroke="#059669"
                      fill="#059669"
                      fillOpacity={0.07}
                      strokeDasharray="5 3"
                      strokeWidth={1.5}
                    />
                    {/* Current scores */}
                    <Radar
                      name="Current Score"
                      dataKey="score"
                      stroke={M}
                      fill={M}
                      fillOpacity={0.2}
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: M, strokeWidth: 0 }}
                    />
                    <Tooltip
                      contentStyle={{ background:"white", border:"1px solid #E2E8F0", borderRadius:0, fontSize:12 }}
                      formatter={(v: any, name: any) => [
                        name === "Current Score" ? `${v}/100` : `${v} (target)`,
                        name,
                      ]}
                    />
                  </RadarChart>
                </ResponsiveContainer>
                {/* Legend */}
                <div style={{ display:"flex", gap:20, justifyContent:"center", marginTop:4, fontSize:12, fontWeight:600 }}>
                  <span style={{ display:"flex", alignItems:"center", gap:6, color:M }}>
                    <span style={{ width:20, height:3, background:M, borderRadius:0, display:"inline-block" }}/>
                    Current Score
                  </span>
                  <span style={{ display:"flex", alignItems:"center", gap:6, color:"#059669" }}>
                    <svg width="20" height="3" viewBox="0 0 20 3"><line x1="0" y1="1.5" x2="20" y2="1.5" stroke="#059669" strokeWidth="1.5" strokeDasharray="5 3"/></svg>
                    Target (75)
                  </span>
                </div>
              </div>
            )}

            {/* ── 3. CORE METRICS ROW ───────────────────────────────── */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
              {[
                { label:"Governance Score", val:`${r.overall_score}/100`, sub:band(r.overall_score), color:sc(r.overall_score), tip:"Weighted composite score across all 10 KPMG Trusted AI dimensions. 75+ is production-ready." },
                { label:"Data Quality",     val:`${r.data_quality_score||0}%`, sub:`${r.logs_evaluated||0} records`, color:sc(r.data_quality_score||0), tip:"How complete and well-structured the log data is. Low scores reduce the reliability of all governance findings." },
                { label:"Avg Principle",    val:`${avgPrn}/100`, sub:`${pkeys.length} dimensions`, color:sc(avgPrn), tip:"Average score across all evaluated KPMG Trusted AI principles." },
                { label:"Findings",         val:`${(r.findings||[]).length}`, sub:`${highF} critical · ${medF} watch`, color:highF>0?"#64748B":medF>0?"#D97706":"#059669", tip:"Total governance gaps found. High findings are deployment blockers." },
              ].map((k,i) => (
                <div key={i} className="es-card" style={{ padding:"14px 16px", borderTop:`3px solid ${k.color}` }}>
                  <div style={{ fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.5px", marginBottom:6, display:"flex", alignItems:"center" }}>
                    {k.label}<InfoTooltip text={k.tip} width={210}/>
                  </div>
                  <div style={{ fontSize:22, fontWeight:900, color:k.color, lineHeight:1, marginBottom:3 }}>{k.val}</div>
                  <div style={{ fontSize:11, color:"#64748B" }}>{k.sub}</div>
                </div>
              ))}
            </div>

            {/* ── 4. DATA HEALTH ────────────────────────────────────── */}
            <div className="es-card" style={{ padding:"20px 24px" }}>
              <div style={{ fontSize:13, fontWeight:800, color:"#0F172A", marginBottom:3 }}>Data Health</div>
              <div style={{ fontSize:11.5, color:"#94A3B8", marginBottom:14 }}>Structural integrity of the uploaded logs — affects reliability of all governance metrics</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:14 }}>
                {[
                  { label:"Schema Confidence", val:schemaConf!=null?`${schemaConf}%`:"—", good:(schemaConf||0)>=70, tip:"How reliably the required columns were detected. <70% suggests column naming issues." },
                  { label:"Missing Data",       val:missingPct!=null?`${missingPct}%`:"—", good:(missingPct||0)<10, tip:"Percentage of cells with missing values. >15% significantly reduces metric accuracy." },
                  { label:"Duplicates",         val:dupCount!=null?String(dupCount):"—", good:(dupCount||0)===0, tip:"Duplicate rows detected (by task_id if present). Duplicates can inflate metric scores." },
                  { label:"Structural Risk",    val:r.structural_risk||"—", good:r.structural_risk==="Low", tip:"Overall data structural risk rating. High = schema or completeness issues that may distort audit results." },
                ].map((k,i) => {
                  const col = k.good ? "#059669" : "#D97706";
                  const bg  = k.good ? "#F0FDF4" : "#FFFBEB";
                  return (
                    <div key={i} style={{ padding:"11px 13px", borderRadius:0, background:bg, border:`1px solid ${col}25` }}>
                      <div style={{ fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.5px", marginBottom:5, display:"flex", alignItems:"center" }}>
                        {k.label}<InfoTooltip text={k.tip} width={190}/>
                      </div>
                      <div style={{ fontSize:16, fontWeight:900, color:col }}>{k.val}</div>
                    </div>
                  );
                })}
              </div>
              {/* Column warnings */}
              {(r.column_warnings||[]).length > 0 && (
                <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                  {(r.column_warnings as string[]).slice(0,3).map((w,i) => (
                    <div key={i} style={{ display:"flex", gap:8, padding:"8px 11px", borderRadius:0, background:"#FFFBEB", border:"1px solid #FDE68A", fontSize:12, color:"#92400E" }}>
                      <span style={{ flexShrink:0 }}>⚠</span>{w}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── 5. LLM JUDGE SNAPSHOT — only if llm_judge present ── */}
            {llm && (
              <div className="es-card" style={{ padding:"20px 24px" }}>
                <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:3 }}>
                  <div style={{ fontSize:13, fontWeight:800, color:"#0F172A" }}>LLM Judge Panel</div>
                  {llmPanel && <span style={{ fontSize:10.5, fontWeight:700, color:M, background:"#EEF4FF", padding:"2px 8px", borderRadius:0 }}>{llmPanel}-judge panel</span>}
                  {llmGrounded && <span style={{ fontSize:10.5, fontWeight:700, color:"#059669", background:"#F0FDF4", padding:"2px 8px", borderRadius:0 }}>KB-grounded</span>}
                </div>
                <div style={{ fontSize:11.5, color:"#94A3B8", marginBottom:14 }}>Cross-model accuracy panel evaluating response quality against expected outputs</div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }}>
                  {[
                    { label:"Accuracy",      val:llmAcc!=null?`${llmAcc}%`:"—",       good:(llmAcc||0)>=70, tip:"Percentage of AI responses judged correct by the panel. 85%+ is strong; below 70% indicates reliability issues." },
                    { label:"Rows Judged",   val:String(llmRows),                      good:llmRows>=30, tip:"Number of log rows evaluated by the LLM judge panel. 30+ gives statistically meaningful accuracy scores." },
                    { label:"Disputed Rows", val:String(llmDisputed),                  good:llmDisputed===0, tip:"Rows where judges disagreed. High dispute rates suggest ambiguous responses or inconsistent behaviour." },
                    { label:"KB Grounded",   val:llmGrounded?"Yes":"No",               good:llmGrounded, tip:"Whether the judge evaluated responses against your uploaded knowledge base. KB-grounded audits are more accurate for RAG and domain-specific systems." },
                  ].map((k,i) => {
                    const col = k.good ? "#059669" : "#D97706";
                    return (
                      <div key={i} style={{ padding:"11px 13px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E2E8F0" }}>
                        <div style={{ fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.5px", marginBottom:5, display:"flex", alignItems:"center" }}>
                          {k.label}<InfoTooltip text={k.tip} width={195}/>
                        </div>
                        <div style={{ fontSize:16, fontWeight:900, color:col }}>{k.val}</div>
                      </div>
                    );
                  })}
                </div>
                {/* Accuracy bar */}
                {llmAcc !== null && (
                  <div style={{ marginTop:14 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:10.5, color:"#94A3B8", marginBottom:5 }}>
                      <span>0%</span><span style={{ color:M, fontWeight:600 }}>Industry benchmark 85%+</span><span>100%</span>
                    </div>
                    <div style={{ position:"relative", height:8, background:"#F1F5F9", borderRadius:0, overflow:"hidden" }}>
                      <div style={{ position:"absolute", left:"85%", top:0, bottom:0, width:1, background:`${M}60`, zIndex:1 }}/>
                      <div style={{ width:`${llmAcc}%`, height:"100%", background:sc(llmAcc), borderRadius:0, transition:"width 1s ease" }}/>
                    </div>
                    {llm.warnings && llm.warnings.length > 0 && (
                      <div style={{ marginTop:10, padding:"8px 12px", background:"#FFFBEB", border:"1px solid #FDE68A", borderRadius:0, fontSize:12, color:"#92400E" }}>
                        ⚠ {llm.warnings[0]}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── 6. DEPLOYMENT READINESS CHECKLIST ─────────────────── */}
            <div className="es-card" style={{ padding:"20px 24px" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:3 }}>
                <div style={{ fontSize:13, fontWeight:800, color:"#0F172A" }}>Deployment Readiness</div>
                <div style={{ fontSize:12, fontWeight:700, color:gatesPassed===gates.length?"#059669":gatesPassed>=gates.length-1?M:"#64748B" }}>
                  {gatesPassed}/{gates.length} gates passed
                </div>
              </div>
              <div style={{ fontSize:11.5, color:"#94A3B8", marginBottom:14 }}>All gates must pass for production deployment approval</div>
              {/* Gate progress bar */}
              <div style={{ height:5, background:"#F1F5F9", borderRadius:0, overflow:"hidden", marginBottom:14 }}>
                <div style={{ width:`${(gatesPassed/gates.length)*100}%`, height:"100%", background:gatesPassed===gates.length?"#059669":gatesPassed>=gates.length-1?M:"#D97706", borderRadius:0, transition:"width 1s ease" }}/>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {gates.map((g, i) => <Gate key={i} {...g}/>)}
              </div>
            </div>

            {/* ── 7. FINDINGS BREAKDOWN ─────────────────────────────── */}
            <div className="es-card" style={{ padding:"20px 24px" }}>
              <div style={{ fontSize:13.5, fontWeight:800, color:"#0F172A", marginBottom:14 }}>Findings Breakdown</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:highF+medF>0?16:0 }}>
                {[
                  { sev:"High",   count:highF, color:"#64748B", bg:"#F1F5F9" },
                  { sev:"Medium", count:medF,  color:"#D97706", bg:"#FFF7ED" },
                  { sev:"Low",    count:lowF,  color:"#059669", bg:"#F0FDF4" },
                ].map(s => (
                  <div key={s.sev} style={{ padding:"12px", borderRadius:0, background:s.bg, textAlign:"center" }}>
                    <div style={{ fontSize:28, fontWeight:900, color:s.color, lineHeight:1 }}>{s.count}</div>
                    <div style={{ fontSize:10.5, color:s.color, fontWeight:700, marginTop:3 }}>{s.sev}</div>
                  </div>
                ))}
              </div>
              {(r.findings||[]).filter((f: any) => f.severity==="High"||f.severity==="Medium").slice(0,4).map((f: any, i: number) => (
                <div key={i} style={{ display:"flex", gap:10, padding:"10px 12px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E2E8F0", marginBottom:6, alignItems:"flex-start" }}>
                  <div style={{ width:5, height:5, borderRadius:"50%", flexShrink:0, marginTop:5, background:f.severity==="High"?"#64748B":"#D97706" }}/>
                  <div>
                    <div style={{ fontSize:12.5, fontWeight:600, color:"#0F172A", marginBottom:1 }}>{f.category||f.probe}</div>
                    <div style={{ fontSize:11.5, color:"#64748B", lineHeight:1.5 }}>{(f.issue||f.recommendation||"").slice(0,130)}{(f.issue||"").length>130?"…":""}</div>
                  </div>
                </div>
              ))}
              {(r.findings||[]).length>4 && (
                <div style={{ fontSize:12, color:M, fontWeight:600, cursor:"pointer", marginTop:4 }} onClick={() => nav("/risk-intelligence")}>
                  View all {(r.findings||[]).length} findings →
                </div>
              )}
            </div>

            {/* ── 8. TOP PRIORITY ACTIONS ───────────────────────────── */}
            {topActions.length > 0 && (
              <div className="es-card" style={{ padding:"20px 24px" }}>
                <div style={{ fontSize:13, fontWeight:800, color:"#0F172A", marginBottom:3 }}>Top Priority Actions</div>
                <div style={{ fontSize:11.5, color:"#94A3B8", marginBottom:14 }}>Highest-impact remediations — resolve these first to maximise score improvement</div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {topActions.map((f: any, i: number) => {
                    const sevColor = f.severity==="High" ? "#64748B" : f.severity==="Medium" ? "#D97706" : "#059669";
                    const sevBg    = f.severity==="High" ? "#F1F5F9" : f.severity==="Medium" ? "#FFF7ED" : "#F0FDF4";
                    return (
                      <div key={i} style={{ display:"flex", gap:12, padding:"13px 16px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E2E8F0", alignItems:"flex-start" }}>
                        <div style={{ width:22, height:22, borderRadius:0, background:`linear-gradient(135deg,${B},${M})`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:11, fontWeight:900, color:"white" }}>{i+1}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                            <span style={{ fontSize:13, fontWeight:700, color:"#0F172A" }}>{f.category}</span>
                            <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:0, background:sevBg, color:sevColor }}>{f.severity}</span>
                          </div>
                          <div style={{ fontSize:12.5, color:"#374151", lineHeight:1.6, marginBottom:6 }}>{f.issue||f.note||""}</div>
                          {f.recommendation && (
                            <div style={{ fontSize:11.5, color:M, fontWeight:600, lineHeight:1.5 }}>
                              → {f.recommendation.slice(0,140)}{f.recommendation.length>140?"…":""}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ fontSize:12, color:M, fontWeight:600, cursor:"pointer", textAlign:"right" as const }} onClick={() => nav("/recommendations")}>
                    View full remediation roadmap →
                  </div>
                </div>
              </div>
            )}

            {/* ── 9. FRAMEWORK COMPLIANCE ───────────────────────────── */}
            {Object.keys(r.framework_compliance||{}).length > 0 && (
              <div className="es-card" style={{ padding:"20px 24px", marginBottom:0 }}>
                <div style={{ fontSize:13.5, fontWeight:800, color:"#0F172A", marginBottom:14 }}>Regulatory Framework Alignment</div>
                <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                  {Object.entries(r.framework_compliance||{}).map(([key,val]: any) => {
                    const labels: Record<string,string> = { EU_AI_Act:"EU AI Act", ISO_42001:"ISO 42001", NIST_AI_RMF:"NIST AI RMF", KPMG_TAF:"KPMG Trusted AI" };
                    // Backend returns an object ({status, overall_score, threshold, principle_scores}),
                    // but this also tolerates the older plain-string shape just in case.
                    const status  = typeof val === "string" ? val : (val?.status || "");
                    const comp    = ["Compliant","Aligned","Good","Certified"].some(x => status.includes(x));
                    const partial = ["Conditional","Partial","Assessed"].some(x => status.includes(x));
                    const fc  = comp?"#059669":partial?"#2563EB":"#64748B";
                    const fbg = comp?"#F0FDF4":partial?"#EFF6FF":"#F1F5F9";
                    return (
                      <div key={key} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E2E8F0" }}>
                        <div style={{ fontSize:13, fontWeight:600 }}>{labels[key]||key}</div>
                        <div style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:0, background:fbg, color:fc }}>{comp?"Aligned":partial?"Partial":"Limited"}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>

          {/* RIGHT SIDEBAR ─────────────────────────────────────────── */}
          <div style={{ position:"sticky", top:70, display:"flex", flexDirection:"column", gap:14 }}>

            {/* Navigation */}
            <div className="es-card" style={{ padding:"16px 14px" }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.6px", marginBottom:10 }}>Audit Sections</div>
              {LENS_LINKS.map((l,i) => (
                <div key={i} className="es-lens" onClick={() => nav(l.path)}>
                  <div>
                    <div style={{ fontSize:12.5, fontWeight:600, color:"#0F172A", marginBottom:1 }}>{l.label}</div>
                    <div style={{ fontSize:11, color:"#94A3B8", lineHeight:1.4 }}>{l.desc}</div>
                  </div>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
                </div>
              ))}
            </div>

            {/* Audit metadata */}
            <div className="es-card" style={{ padding:"16px 14px" }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.6px", marginBottom:10 }}>Audit Info</div>
              {[
                { l:"Model",      v:(r.model_label||r.model_type||"—").replace(/_/g," ") },
                { l:"Evaluated",  v:r.evaluated_at ? fmt(r.evaluated_at).split(",")[0] : "—" },
                { l:"Logs",       v:`${r.logs_evaluated||0}` },
                { l:"Dimensions", v:`${pkeys.length}` },
                { l:"Report ID",  v:r.report_id ? `#${r.report_id.slice(0,10)}` : "—" },
                ...(detConf!==null?[{ l:"Detect. conf.", v:`${detConf}%` }]:[]),
                ...(isRerun?[{ l:"Run #", v:`${rerunSequence}` },{ l:"Scope", v:r.rerun_scope||"targeted" }]:[]),
              ].map(({ l, v }) => (
                <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", fontSize:12, padding:"6px 0", borderBottom:"1px solid #F8FAFC" }}>
                  <span style={{ color:"#94A3B8", fontWeight:500 }}>{l}</span>
                  <span style={{ color:"#334155", fontWeight:600, textAlign:"right", maxWidth:"55%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Findings severity summary */}
            <div className="es-card" style={{ padding:"16px 14px" }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.6px", marginBottom:10 }}>Finding Summary</div>
              {[
                { label:"High",   count:highF, color:"#64748B", bg:"#F1F5F9", note:"Deployment blockers" },
                { label:"Medium", count:medF,  color:"#D97706", bg:"#FFF7ED", note:"Address within 60 days" },
                { label:"Low",    count:lowF,  color:"#059669", bg:"#F0FDF4", note:"Monitor & review" },
              ].map(s => (
                <div key={s.label} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 10px", borderRadius:0, background:s.bg, marginBottom:6 }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:s.color }}>{s.label}</div>
                    <div style={{ fontSize:10, color:"#94A3B8" }}>{s.note}</div>
                  </div>
                  <div style={{ fontSize:22, fontWeight:900, color:s.color }}>{s.count}</div>
                </div>
              ))}
            </div>

            {/* Score gauge visual */}
            <div className="es-card" style={{ padding:"16px 14px", textAlign:"center" }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.6px", marginBottom:12 }}>Overall Score</div>
              <Arc score={r.overall_score} size={80}/>
              <div style={{ fontSize:11, color:scT(r.overall_score), fontWeight:700, marginTop:6, textTransform:"uppercase", letterSpacing:"0.5px" }}>{band(r.overall_score)}</div>
              <div style={{ fontSize:10.5, color:"#64748B", marginTop:4 }}>{r.risk_level} risk</div>
              {llmAcc !== null && (
                <div style={{ marginTop:12, paddingTop:12, borderTop:"1px solid #F1F5F9" }}>
                  <div style={{ fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:6 }}>LLM Accuracy</div>
                  <div style={{ fontSize:20, fontWeight:900, color:sc(llmAcc) }}>{llmAcc}%</div>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      <div style={{ marginTop:40 }}>
        <LensFooter data={r} />
      </div>
    </div>
  );
}