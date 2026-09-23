import { useEffect, useState } from "react";
import AuditContextBar, { LensFooter } from "../components/AuditContextBar";
import { useLocation, useNavigate } from "react-router-dom";

const M = "#005EB8", B = "#00338D";
const sc = (s: number) => s >= 75 ? "#059669" : s >= 50 ? M : "#64748B";
const sb = (s: number) => s >= 75 ? "#F0FDF4" : s >= 50 ? "#EFF6FF" : "#F1F5F9";

type RecAction = {
  text: string;
  effort: "Low" | "Medium" | "High";
  impact: "Quick win" | "Structural" | "Ongoing";
  day_target: number;
  phase: number;
  owner_team: string;
};
type PrincipleRec = {
  what: string;
  owner: string;
  root_cause: string;
  actions: RecAction[];
};

// ── Effort / impact chip styling ──────────────────────────────────────────────
const effortMeta = (e: string) =>
  e === "Low"    ? { color: "#059669", bg: "#F0FDF4" } :
  e === "Medium" ? { color: "#2563EB", bg: "#EFF6FF" } :
                   { color: "#64748B", bg: "#F1F5F9" };
const impactMeta = (i: string) =>
  i === "Quick win"  ? { color: "#059669", bg: "#F0FDF4" } :
  i === "Structural" ? { color: "#2563EB", bg: "#EFF6FF" } :
                       { color: "#7C3AED", bg: "#F5F3FF" };
const sevDot = (sev: string) => sev === "High" ? "#64748B" : sev === "Medium" ? "#2563EB" : "#059669";
const titleCase = (s: string) => (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function Recommendations() {
  const location = useLocation();
  const navigate = useNavigate();
  const raw = location.state?.data || (() => { try { const s = sessionStorage.getItem("lastReportData"); return s ? JSON.parse(s) : null; } catch { return null; } })();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [, setAnim] = useState(false);
  useEffect(() => { setTimeout(() => setAnim(true), 100); }, []);

  if (!raw) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", fontFamily:"'Plus Jakarta Sans',sans-serif" }}>
      <button onClick={() => navigate("/dashboard")} style={{ padding:"10px 24px", background:M, border:"none", borderRadius:0, color:"white", fontWeight:700, cursor:"pointer" }}>← Back</button>
    </div>
  );

  const r = raw;
  const prn = r.trusted_ai_principles || {};
  const pkeys = Object.keys(prn);

  // ── AI-generated recommendation data ────────────────────────────────────────
  // recommended_actions is a flat array from rec_synthesizer.py.
  // We group it by principle for the per-principle cards.
  // Backend/DB field is `action_text` (see rec_synthesizer.py + reports.py PDF export).
  // Normalize to `text` here so every consumer below (Gantt bar, expanded action list)
  // reads real Groq-generated text instead of silently falling back to generic copy.
  const rawActions: RecAction[] = (r.recommended_actions || []).map((a: any) => ({
    ...a,
    text: a.text ?? a.action_text ?? "",
  }));
  const recsGenerated: boolean = r.recs_generated ?? rawActions.length > 0;
  const overallNarrative: string = r.overall_narrative || "";
  const verdictContext: string = r.deployment_verdict_context || "";

  // Group actions by principle
  const recsByPrinciple: Record<string, PrincipleRec> = {};
  for (const action of rawActions) {
    const p = (action as any).principle;
    if (!p) continue;
    if (!recsByPrinciple[p]) {
      // Pull what/owner/root_cause from the principles payload if Groq stored it there
      const groqPrinciple = (r.rec_principles || {})[p] || {};
      recsByPrinciple[p] = {
        what:       groqPrinciple.what || "",
        owner:      groqPrinciple.owner || "",
        root_cause: groqPrinciple.root_cause || "",
        actions:    [],
      };
    }
    recsByPrinciple[p].actions.push(action);
  }
  // Sort actions within each principle by day_target ascending
  for (const p of Object.keys(recsByPrinciple)) {
    recsByPrinciple[p].actions.sort((a, b) => (a.day_target || 0) - (b.day_target || 0));
  }

  // Findings actually produced by this audit, linkable back to a principle
  const findingsAll: any[] = r.findings || [];
  const findingsFor = (k: string) => findingsAll.filter((f: any) => f.category === k);

  // Weakest sub-parameter per principle (base_evaluator.compute_risk_analysis)
  const riskItems: any[] = r.risk_analysis?.risk_items || [];
  const worstByPrinciple: Record<string, any> = {};
  for (const item of riskItems) worstByPrinciple[item.principle] = item;

  // Rerun movement, when available, escalates a principle regardless of its
  // current score — a regression is a scheduling signal even if still "Watch".
  const principleDeltas: any[] = r.principle_deltas || [];
  const isRerun = !!(r.parent_audit_id || (r.rerun_sequence && r.rerun_sequence > 1));

  const HIGH_IMPACT = new Set(["Safety", "Privacy", "Security", "Fairness"]);

  // Phase 0 = Immediate, 1 = Short-term, 2 = Ongoing.
  // Score alone under-prioritises regulatory-weighted principles sitting just
  // inside the "Watch" band, and ignores a fresh regression on a re-run — so
  // both pull a principle one phase earlier than pure score would.
  function phaseFor(k: string, score: number): number {
    const delta = principleDeltas.find((d: any) => d.principle === k);
    const regressed = !!delta && (delta.movement_label === "REGRESSED" || delta.movement_label === "WORSENING");
    const hi = HIGH_IMPACT.has(k);
    if (score < 50 || regressed) return 0;
    if (score < 75 || (hi && score < 85)) return 1;
    return 2;
  }
  function isEscalated(k: string, score: number): string | null {
    const delta = principleDeltas.find((d: any) => d.principle === k);
    if (delta && (delta.movement_label === "REGRESSED" || delta.movement_label === "WORSENING")) return "Regressed since prior audit";
    if (HIGH_IMPACT.has(k) && score >= 75 && score < 85) return "Elevated regulatory weight";
    return null;
  }

  // Sort: earliest phase first; within a phase, more linked findings first;
  // ties broken by raw score ascending.
  const sorted = [...pkeys].sort((a, b) => {
    const sa = prn[a]?.score || 0, sb_ = prn[b]?.score || 0;
    const pa = phaseFor(a, sa), pb = phaseFor(b, sb_);
    if (pa !== pb) return pa - pb;
    const fa = findingsFor(a).length, fb = findingsFor(b).length;
    if (fa !== fb) return fb - fa;
    return sa - sb_;
  });

  // Portfolio view across every recommended action, for the header strip
  const allActions: RecAction[] = rawActions;
  const quickWinCount   = allActions.filter(a => a.impact === "Quick win").length;
  const structuralCount = allActions.filter(a => a.impact === "Structural").length;
  const ongoingCount    = allActions.filter(a => a.impact === "Ongoing").length;
  const highFindings = (r.findings || []).filter((f: any) => f.severity === "High").length;
  const weakCount = pkeys.filter(k => (prn[k]?.score || 0) < 60).length;
  // Use Groq-generated narrative when available; fall back to deterministic template
  const overallRec = overallNarrative ||
    (r.overall_score >= 80 && highFindings === 0
    ? `${r.ai_name} demonstrates strong governance posture with an overall score of ${r.overall_score}/100. No high-severity findings were detected. Continue monitoring and schedule quarterly re-assessments to maintain compliance.`
    : highFindings > 0
    ? `${r.ai_name} has ${highFindings} high-severity finding(s) that require immediate remediation before production deployment. ${weakCount > 0 ? `Additionally, ${weakCount} principle(s) are critically low and need urgent attention.` : ""} Implement the recommended controls below and re-run the audit after remediation.`
    : r.overall_score >= 60
    ? `${r.ai_name} meets baseline governance requirements with a score of ${r.overall_score}/100. ${weakCount > 0 ? `Focus remediation on the ${weakCount} principle(s) scoring below 60.` : "Address the identified gaps within 60 days."} Re-assess to achieve full alignment with governance standards.`
    : `${r.ai_name} requires significant governance improvements before deployment. Score of ${r.overall_score}/100 indicates critical gaps. Engage your AI governance team to implement a structured remediation plan.`);

  return (
    <div style={{ minHeight:"100vh", background:"#F4F7FB", fontFamily:"'Plus Jakarta Sans',sans-serif", color:"#0F172A", paddingBottom:80 }}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0;}.rec-card{background:white;border-radius: 0px;border:1px solid #E2E8F0;box-shadow:0 1px 4px rgba(0,0,0,0.05),0 4px 16px rgba(0,0,0,0.04);}`}</style>

      <AuditContextBar data={raw} />

      <div style={{ maxWidth:1160, margin:"0 auto", padding:"28px 24px" }}>

        {/* Overall recommendation */}
        <div className="rec-card" style={{ padding:"28px 32px", marginBottom:20, borderLeft:`4px solid ${r.overall_score>=75?"#059669":r.overall_score>=50?M:"#64748B"}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
            <div style={{ width:36, height:36, borderRadius:0, background:"#EEF4FF", display:"grid", placeItems:"center", color:M }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            </div>
            <div>
              <div style={{ fontSize:16, fontWeight:800, color:"#0F172A" }}>Overall Governance Recommendation</div>
              <div style={{ fontSize:12, color:"#94A3B8", marginTop:2 }}>
                Based on audit results for {r.model_label || r.model_type}
                {isRerun && r.rerun_sequence ? ` · re-run #${r.rerun_sequence}, phased against movement since the prior audit` : ""}
              </div>
            </div>
            <div style={{ marginLeft:"auto", textAlign:"right" }}>
              <div style={{ fontSize:32, fontWeight:900, color:sc(r.overall_score), lineHeight:1 }}>{r.overall_score}</div>
              <div style={{ fontSize:10, color:"#94A3B8" }}>/ 100</div>
            </div>
          </div>
          <div style={{ padding:"16px 20px", background:`linear-gradient(135deg,${B}08,${M}05)`, border:`1.5px solid ${M}25`, borderRadius:0 }}>
            <p style={{ margin:0, color:"#1E293B", lineHeight:1.85, fontSize:14 }}>{overallRec}</p>
          </div>
          {verdictContext && (
            <div style={{ marginTop:10, padding:"10px 16px", background:"#F8FAFC", border:"1px solid #E2E8F0", fontSize:12.5, color:"#475569", lineHeight:1.6 }}>
              <strong style={{ color:M }}>Deployment readiness: </strong>{verdictContext}
            </div>
          )}
          {!recsGenerated && (
            <div style={{ marginTop:10, padding:"10px 16px", background:"#FFF7ED", border:"1px solid #FED7AA", fontSize:12, color:"#92400E", display:"flex", alignItems:"center", gap:8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              AI-tailored recommendations were not generated for this audit (Groq was unavailable). Re-run the audit to generate specific actions and day targets.
            </div>
          )}

          {/* Action portfolio — the shape of the remediation effort, not just a score */}
          <div style={{ display:"flex", gap:10, marginTop:16 }}>
            {[
              { label:"Quick wins",  sub:"Low effort, fast to ship",        val:quickWinCount,   ...impactMeta("Quick win") },
              { label:"Structural",  sub:"Pipeline or process changes",     val:structuralCount, ...impactMeta("Structural") },
              { label:"Ongoing",     sub:"Recurring practice, not one-off", val:ongoingCount,     ...impactMeta("Ongoing") },
            ].map(s => (
              <div key={s.label} style={{ flex:1, padding:"10px 14px", background:s.bg, borderRadius:0, border:`1px solid ${s.color}20` }}>
                <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                  <span style={{ fontSize:20, fontWeight:900, color:s.color }}>{s.val}</span>
                  <span style={{ fontSize:11.5, fontWeight:700, color:s.color }}>{s.label}</span>
                </div>
                <div style={{ fontSize:10, color:"#94A3B8", marginTop:1 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Remediation timeline — Gantt chart */}
          <div style={{ marginTop:20 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.7px", marginBottom:16 }}>Remediation Timeline</div>

            {/* Time axis */}
            <div style={{ paddingLeft:168, marginBottom:6 }}>
              <div style={{ position:"relative", height:18 }}>
                {[
                  { label:"Day 0",    pct:0   },
                  { label:"Day 7",    pct:8   },
                  { label:"Day 14",   pct:16  },
                  { label:"Day 30",   pct:33  },
                  { label:"Day 45",   pct:50  },
                  { label:"Day 60",   pct:67  },
                  { label:"Day 90+",  pct:100 },
                ].map(t => (
                  <span key={t.label} style={{ position:"absolute", left:`${t.pct}%`, transform:t.pct===100?"translateX(-100%)":t.pct===0?"none":"translateX(-50%)", fontSize:10, fontWeight:600, color:"#94A3B8", whiteSpace:"nowrap" as const }}>
                    {t.label}
                  </span>
                ))}
              </div>
              {/* tick line */}
              <div style={{ position:"relative", height:6 }}>
                {[0,20,40,60,80,100].map(p => (
                  <div key={p} style={{ position:"absolute", left:`${p}%`, top:0, width:1, height:6, background:"#E2E8F0" }}/>
                ))}
                <div style={{ position:"absolute", top:5, left:0, right:0, height:1, background:"#E2E8F0" }}/>
              </div>
            </div>

            {/* Phase background bands */}
            <div style={{ position:"relative" }}>
              <div style={{ paddingLeft:168, position:"absolute", inset:0, display:"flex", pointerEvents:"none", zIndex:0 }}>
                <div style={{ width:"40%", background:"rgba(0,51,141,0.03)", borderRight:"1px dashed #E2E8F0" }}/>
                <div style={{ width:"40%", background:"rgba(0,94,184,0.03)", borderRight:"1px dashed #E2E8F0" }}/>
                <div style={{ flex:1, background:"rgba(0,145,218,0.03)" }}/>
              </div>

              {/* Rows */}
              <div style={{ display:"flex", flexDirection:"column" as const, gap:3, position:"relative", zIndex:1 }}>
                {sorted.map((k) => {
                  const score = prn[k]?.score || 0;
                  const rec = recsByPrinciple[k];
                  const phase = phaseFor(k, score);
                  const barColor = phase === 0 ? "#00338D" : phase === 1 ? "#005EB8" : "#0091DA";
                  const escalated = isEscalated(k, score);
                  // Use day_target from first action for Gantt bar endpoint
                  // Phase bands: 0→0-30d (0-33% of 90), 1→31-60d (33-67%), 2→61-90d (67-100%)
                  const firstAction = rec?.actions?.[0];
                  const dayTarget = firstAction?.day_target || (phase === 0 ? 21 : phase === 1 ? 45 : 80);
                  const endPct   = Math.round((dayTarget / 90) * 100);
                  const startPct = phase === 0 ? 0 : phase === 1 ? 34 : 68;
                  const widthPct = Math.max(4, endPct - startPct);
                  const action   = firstAction?.text || "Review and remediate.";
                  const shortAction = (escalated ? `⚠ ${escalated} — ` : "") + (action.length > 55 ? action.slice(0, 52) + "…" : action);

                  return (
                    <div key={k} style={{ display:"flex", alignItems:"stretch", minHeight:34 }}>
                      {/* Principle name */}
                      <div style={{ width:168, flexShrink:0, paddingRight:14, display:"flex", alignItems:"center" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                          <div style={{ width:3, height:22, background:barColor, flexShrink:0 }}/>
                          <span style={{ fontSize:11.5, fontWeight:700, color:"#1E293B", lineHeight:1.3 }}>{k}</span>
                        </div>
                      </div>

                      {/* Bar track */}
                      <div style={{ flex:1, position:"relative", background:"#F8FAFC", borderTop:"1px solid #F1F5F9", borderBottom:"1px solid #F1F5F9" }}>
                        <div style={{
                          position:"absolute",
                          left:`${startPct}%`,
                          width:`${widthPct}%`,
                          top:4,
                          bottom:4,
                          background:barColor,
                          display:"flex",
                          alignItems:"center",
                          paddingLeft:8,
                          paddingRight:8,
                          gap:6,
                          overflow:"hidden",
                        }}>
                          {/* Score badge */}
                          <span style={{ fontSize:11, fontWeight:900, color:"white", flexShrink:0, opacity:0.95 }}>{score}</span>
                          <span style={{ width:1, height:12, background:"rgba(255,255,255,0.3)", flexShrink:0 }}/>
                          {/* Action text */}
                          <span style={{ fontSize:10.5, color:"rgba(255,255,255,0.92)", fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const, flex:1 }}>
                            {shortAction}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Phase label strip */}
            <div style={{ paddingLeft:168, display:"flex", marginTop:8, fontSize:10, fontWeight:700, color:"#94A3B8" }}>
              <div style={{ width:"40%", paddingLeft:4, color:"#00338D" }}>Phase 1 — Immediate (0–30 days)</div>
              <div style={{ width:"40%", paddingLeft:4, color:"#005EB8" }}>Phase 2 — Short-Term (30–60 days)</div>
              <div style={{ flex:1,      paddingLeft:4, color:"#0091DA" }}>Phase 3 — Ongoing</div>
            </div>

            {/* Legend */}
            <div style={{ display:"flex", gap:20, marginTop:14, paddingTop:12, borderTop:"1px solid #F1F5F9" }}>
              {[
                { color:"#00338D", label:"Score < 50  —  Critical: must resolve before deployment" },
                { color:"#005EB8", label:"Score 50–74  —  Watch: improve within 60 days" },
                { color:"#0091DA", label:"Score ≥ 75  —  Strong: monitor quarterly" },
              ].map(l => (
                <div key={l.color} style={{ display:"flex", alignItems:"center", gap:7, fontSize:11, color:"#475569" }}>
                  <div style={{ width:16, height:5, background:l.color, flexShrink:0 }}/>
                  {l.label}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Per-principle recommendations */}
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {sorted.map(k => {
            const score = prn[k]?.score || 0;
            const rec = recsByPrinciple[k];
            const isOpen = expanded === k;
            const priorityColor = score < 50 ? "#64748B" : score < 75 ? "#2563EB" : "#059669";
            const priorityBg    = score < 50 ? "#F1F5F9" : score < 75 ? "#EFF6FF" : "#DCFCE7";
            const priorityLabel = score < 50 ? "Critical" : score < 75 ? "Watch" : "Strong";
            const linkedFindings = findingsFor(k);
            const escalated = isEscalated(k, score);
            const worst = worstByPrinciple[k];

            return (
              <div key={k} className="rec-card" style={{ overflow:"hidden", borderLeft:`4px solid ${sc(score)}` }}>
                {/* Header row */}
                <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:14, cursor:"pointer" }}
                  onClick={() => setExpanded(isOpen ? null : k)}>
                  <div style={{ width:36, height:36, borderRadius:0, background:sb(score), display:"grid", placeItems:"center", fontSize:18, flexShrink:0 }}>
                    <span style={{ fontSize:12, fontWeight:800, color:"currentColor" }}>{(k||"?")[0]}</span>
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:7, flexWrap:"wrap" as const }}>
                      <span style={{ fontSize:14.5, fontWeight:800, color:"#0F172A" }}>{k}</span>
                      {linkedFindings.length > 0 && (
                        <span style={{ fontSize:9.5, fontWeight:700, color:"#64748B", background:"#F1F5F9", padding:"1px 7px", borderRadius:0 }}>{linkedFindings.length} linked finding{linkedFindings.length === 1 ? "" : "s"}</span>
                      )}
                      {escalated && (
                        <span style={{ fontSize:9.5, fontWeight:700, color:"#B45309", background:"#FEF3C7", padding:"1px 7px", borderRadius:0 }}>⚠ {escalated}</span>
                      )}
                    </div>
                    {rec && <div style={{ fontSize:12, color:"#64748B", marginTop:2, lineHeight:1.4 }}>{rec.what}</div>}
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:24, fontWeight:900, color:sc(score), lineHeight:1 }}>{score}</div>
                      <div style={{ fontSize:9, color:sc(score), fontWeight:700 }}>/ 100</div>
                    </div>
                    <div style={{ padding:"4px 10px", borderRadius:0, background:priorityBg, color:priorityColor, fontSize:11, fontWeight:700 }}>{priorityLabel}</div>
                    <div style={{ width:28, height:28, borderRadius:"50%", background:"#F1F5F9", display:"grid", placeItems:"center", fontSize:12, color:"#94A3B8", transition:"transform 0.2s", transform:isOpen?"rotate(180deg)":"none" }}>▾</div>
                  </div>
                </div>

                {/* Score bar */}
                <div style={{ padding:"0 20px 12px" }}>
                  <div style={{ height:5, background:"#F1F5F9", borderRadius:0, overflow:"hidden" }}>
                    <div style={{ width:`${score}%`, height:"100%", background:`linear-gradient(90deg,${sc(score)}88,${sc(score)})`, borderRadius:0, transition:"width 0.8s ease" }}/>
                  </div>
                </div>

                {/* Expanded actions */}
                {isOpen && rec && (
                  <div style={{ padding:"0 20px 20px", borderTop:"1px solid #F1F5F9" }}>

                    {/* Owner + weakest signal */}
                    <div style={{ display:"flex", gap:10, flexWrap:"wrap" as const, margin:"16px 0" }}>
                      <div style={{ padding:"6px 12px", background:"#F8FAFC", border:"1px solid #E2E8F0", borderRadius:0, fontSize:11 }}>
                        <span style={{ color:"#94A3B8", fontWeight:600 }}>Suggested owner: </span>
                        <span style={{ color:"#374151", fontWeight:700 }}>{rec.owner}</span>
                      </div>
                      {worst && (
                        <div style={{ padding:"6px 12px", background:"#FAFBFF", border:`1px solid ${M}20`, borderRadius:0, fontSize:11 }}>
                          <span style={{ color:M, fontWeight:600 }}>Weakest signal: </span>
                          <span style={{ color:"#374151", fontWeight:700 }}>{titleCase(worst.worst_param)} ({worst.worst_val}/100)</span>
                        </div>
                      )}
                    </div>

                    <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.7px", marginBottom:12 }}>Recommended Actions</div>
                    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                      {rec.actions.map((action, i) => {
                        const em = effortMeta(action.effort), im = impactMeta(action.impact);
                        return (
                          <div key={i} style={{ display:"flex", gap:12, padding:"12px 14px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E2E8F0" }}>
                            <div style={{ width:22, height:22, borderRadius:"50%", background:sb(score), color:sc(score), display:"grid", placeItems:"center", fontSize:11, fontWeight:800, flexShrink:0 }}>{i+1}</div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:13, color:"#374151", lineHeight:1.65, marginBottom:6 }}>{action.text}</div>
                              <div style={{ display:"flex", gap:6 }}>
                                <span style={{ fontSize:9.5, fontWeight:700, color:em.color, background:em.bg, padding:"1px 7px", borderRadius:0 }}>{action.effort} effort</span>
                                <span style={{ fontSize:9.5, fontWeight:700, color:im.color, background:im.bg, padding:"1px 7px", borderRadius:0 }}>{action.impact}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Findings driving this recommendation — real evidence, not just playbook */}
                    {linkedFindings.length > 0 && (
                      <div style={{ marginTop:16 }}>
                        <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.7px", marginBottom:10 }}>
                          Findings Driving This Recommendation
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                          {linkedFindings.map((f: any, i: number) => (
                            <div key={i} style={{ display:"flex", gap:10, padding:"10px 14px", background:"#FFFDF7", border:"1px solid #FDE68A50", borderRadius:0 }}>
                              <div style={{ width:6, height:6, borderRadius:"50%", background:sevDot(f.severity), marginTop:5, flexShrink:0 }}/>
                              <div style={{ flex:1 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
                                  <span style={{ fontSize:9.5, fontWeight:700, color:sevDot(f.severity) }}>{f.severity} severity</span>
                                </div>
                                <div style={{ fontSize:12, color:"#374151", lineHeight:1.55 }}>{f.issue || f.note}</div>
                                {f.probe && (
                                  <div style={{ fontSize:11, color:"#94A3B8", fontStyle:"italic" as const, marginTop:4 }}>Probe: {f.probe}</div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Sub-parameter breakdown */}
                    {prn[k]?.parameters && Object.keys(prn[k].parameters).length > 0 && (
                      <div style={{ marginTop:16 }}>
                        <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.7px", marginBottom:10 }}>Sub-parameter Scores</div>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:8 }}>
                          {Object.entries(prn[k].parameters)
                            .sort((a: any, b: any) => a[1] - b[1])
                            .map(([param, val]: any) => (
                            <div key={param} style={{ padding:"10px 12px", borderRadius:0, background:sb(val), border:`1px solid ${sc(val)}18` }}>
                              <div style={{ fontSize:11, fontWeight:700, color:"#0F172A", marginBottom:5 }}>{titleCase(param)}</div>
                              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                <div style={{ flex:1, height:4, background:"rgba(0,0,0,0.08)", borderRadius:0 }}>
                                  <div style={{ width:`${val}%`, height:"100%", borderRadius:0, background:sc(val) }}/>
                                </div>
                                <span style={{ fontSize:13, fontWeight:800, color:sc(val), flexShrink:0 }}>{val}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

    <LensFooter data={raw} />
    </div>
  );
}