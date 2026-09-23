/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import AuditContextBar, { LensFooter } from "../components/AuditContextBar";
import { useLocation, useNavigate } from "react-router-dom";
import { getJudgePanel } from "../services/api";

const M = "#005EB8";

const CSS = `*{box-sizing:border-box;margin:0;padding:0;}body{background:#F8FAFC;}.la-card{background:white;border-radius: 0px;border:1px solid #E2E8F0;box-shadow:0 1px 3px rgba(0,0,0,0.05),0 4px 12px rgba(0,0,0,0.04);}`;

export default function LlmAnalysis() {
  const location = useLocation();
  const navigate = useNavigate();
  const raw = location.state?.data || (() => { try { const s = sessionStorage.getItem("lastReportData"); return s ? JSON.parse(s) : null; } catch { return null; } })();
  const [anim, setAnim] = useState(false);
  useEffect(() => { setTimeout(() => setAnim(true), 60); }, []);
  void anim;

  const [panelRows, setPanelRows] = useState<any[] | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState<number | null>(null);
  const reportIdForPanel = raw?.report_id;
  useEffect(() => {
    if (!reportIdForPanel) return;
    setPanelLoading(true);
    getJudgePanel(reportIdForPanel)
      .then((res) => setPanelRows(res.data?.rows ?? []))
      .catch(() => setPanelRows(null))
      .finally(() => setPanelLoading(false));
  }, [reportIdForPanel]);

  if (!raw) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", fontFamily:"'Plus Jakarta Sans',sans-serif" }}>
      <button onClick={() => navigate("/dashboard")} style={{ padding:"10px 24px", background:M, border:"none", borderRadius:0, color:"white", fontWeight:700, cursor:"pointer" }}>← Back</button>
    </div>
  );

  const r = raw;
  const llm = r.llm_judge;

  if (!llm) return (
    <div style={{ minHeight:"100vh", background:"#F8FAFC", fontFamily:"'Plus Jakarta Sans',sans-serif", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
      <div style={{ fontSize:15, color:"#64748B" }}>No LLM Judge data available for this audit.</div>
      <button onClick={() => navigate(-1)} style={{ padding:"10px 24px", background:M, border:"none", borderRadius:0, color:"white", fontWeight:700, cursor:"pointer" }}>← Back</button>
    </div>
  );

  const accuracyPct = llm.accuracy != null ? Math.round(llm.accuracy * 100) : null;
  const hasError    = !!llm.error;
  const ac = accuracyPct != null ? (accuracyPct >= 80 ? "#059669" : accuracyPct >= 60 ? M : "#64748B") : "#94A3B8";
  const ab = accuracyPct != null ? (accuracyPct >= 80 ? "#F0FDF4" : accuracyPct >= 60 ? "#EEF4FF" : "#F1F5F9") : "#F8FAFC";
  const panelSize  = llm.panel_size ?? (llm.judge_panel?.length ?? (llm.rows_judged > 0 ? 3 : 0));
  const kbCount    = llm.kb_chunks_count ?? llm.kb_chunks_used ?? 0;
  const kbGrounded = llm.kb_grounded ?? (kbCount > 0);
  const disputed   = llm.disputed_rows?.length ?? 0;
  const confs      = llm.confidence ?? [];
  const nHigh      = confs.filter((c: string) => c === "high").length;
  const nMed       = confs.filter((c: string) => c === "medium").length;
  const nLow       = confs.filter((c: string) => c === "low").length;
  const kbUsed     = (llm.kb_used ?? []).filter(Boolean).length;

  const interp = () => {
    if (hasError) return { label:"Unavailable", desc: llm.error || "LLM judge could not be run." };
    if (accuracyPct == null) return { label:"Not Computed", desc:"No accuracy data returned." };
    if (accuracyPct >= 90) return { label:"Excellent", desc:`${accuracyPct}% of responses judged correct by majority vote${kbGrounded?", grounded against your knowledge base":""}. Highly accurate and reliable.` };
    if (accuracyPct >= 75) return { label:"Good", desc:`${accuracyPct}% accuracy. Around ${100-accuracyPct}% had factual issues. Review incorrect rows to identify failure patterns.` };
    if (accuracyPct >= 60) return { label:"Moderate", desc:`${accuracyPct}% accuracy. ${100-accuracyPct}% of responses judged incorrect. Review system prompts and retrieval quality.` };
    return { label:"Low", desc:`${accuracyPct}% accuracy is below acceptable thresholds. Immediate remediation recommended before deployment.` };
  };
  const ip = interp();

  return (
    <div style={{ minHeight:"100vh", background:"#F8FAFC", fontFamily:"'Plus Jakarta Sans',sans-serif", color:"#0F172A" }}>
      <style>{CSS}</style>

      <AuditContextBar data={raw} />



      {/* Body */}
      <div style={{ padding:"28px 40px 60px" }}>

        {/* Accuracy hero + metrics row */}
        <div style={{ display:"grid", gridTemplateColumns:"auto 1fr", gap:20, marginBottom:20 }}>
          <div style={{ padding:"24px 30px", borderRadius:0, background:ab, border:`1.5px solid ${ac}25`, textAlign:"center", minWidth:160 }}>
            <div style={{ fontSize:11, fontWeight:700, color:ac, textTransform:"uppercase" as const, letterSpacing:"0.8px", marginBottom:10 }}>Majority Vote Accuracy</div>
            <div style={{ fontSize:54, fontWeight:900, color:ac, lineHeight:1, letterSpacing:"-2px" }}>{accuracyPct != null ? `${accuracyPct}%` : "—"}</div>
            <div style={{ marginTop:10, padding:"4px 14px", borderRadius:0, background:"white", border:`1px solid ${ac}30`, display:"inline-block" }}>
              <span style={{ fontSize:12, fontWeight:700, color:ac }}>{ip.label}</span>
            </div>
            <div style={{ marginTop:8, fontSize:11, color:"#64748B" }}>correct ÷ (judged − disputed)</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div className="la-card" style={{ padding:"16px 18px", background:ab, border:`1px solid ${ac}20`, fontSize:13.5, color:"#1E293B", lineHeight:1.75 }}>{ip.desc}</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10 }}>
              {[
                { label:"Rows Judged",   val:String(llm.rows_judged),  color:M, bg:"#EEF4FF" },
                { label:"Skipped",       val:String(llm.rows_skipped), color:llm.rows_skipped>0?"#64748B":"#059669", bg:llm.rows_skipped>0?"#F1F5F9":"#F0FDF4" },
                { label:"Disputed",      val:String(disputed),         color:disputed>0?"#2563EB":"#059669", bg:disputed>0?"#EFF6FF":"#F0FDF4" },
                { label:"KB-Grounded",   val:String(kbUsed),           color:kbUsed>0?"#059669":"#94A3B8", bg:kbUsed>0?"#F0FDF4":"#F8FAFC" },
                { label:"Active Judges", val:String(panelSize>0?panelSize:llm.rows_judged>0?3:0), color:"#7C3AED", bg:"#F3E8FF" },
              ].map(item => (
                <div key={item.label} style={{ padding:"12px 10px", borderRadius:0, background:item.bg, textAlign:"center" }}>
                  <div style={{ fontSize:9, fontWeight:700, color:item.color, textTransform:"uppercase" as const, letterSpacing:"0.5px", marginBottom:5 }}>{item.label}</div>
                  <div style={{ fontSize:20, fontWeight:900, color:item.color }}>{item.val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 2-col layout for the rest */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:20 }}>

          {/* Judge panel */}
          <div className="la-card" style={{ padding:"22px 24px" }}>
            <div style={{ fontSize:14, fontWeight:800, color:"#0F172A", marginBottom:4 }}>The Panel</div>
            <div style={{ fontSize:12, color:"#94A3B8", marginBottom:16 }}>Three architecturally different models from three different providers</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {[
                { name: llm.judge_panel?.[0] || "Judge 1", color:"#7C3AED", bg:"#F3E8FF", specialty:"Broad factual knowledge, structured output" },
                { name: llm.judge_panel?.[1] || "Judge 2", color:"#0091DA", bg:"#E0F2FE", specialty:"Reasoning, code, European-domain knowledge" },
                { name: llm.judge_panel?.[2] || "Judge 3", color:"#059669", bg:"#DCFCE7", specialty:"Scientific, technical, multilingual domains" },
              ].map((j, idx) => {
                const active = panelSize > 0 ? idx < panelSize : llm.rows_judged > 0;
                return (
                  <div key={j.name} style={{ padding:"13px 15px", borderRadius:0, background:active?j.bg:"#F8FAFC", border:`1px solid ${active?j.color:"#E2E8F0"}30`, opacity:active?1:0.45 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                      <span style={{ fontSize:12, fontWeight:700, color:active?j.color:"#94A3B8" }}>{j.name}</span>
                      <span style={{ fontSize:10, padding:"2px 8px", borderRadius:0, background:active?j.color:"#94A3B8", color:"white", fontWeight:700 }}>{active?"Active":"Offline"}</span>
                    </div>
                    <div style={{ fontSize:11.5, color:"#475569", lineHeight:1.5, fontStyle:"italic" }}>{j.specialty}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Evaluation workflow */}
          <div className="la-card" style={{ padding:"22px 24px" }}>
            <div style={{ fontSize:14, fontWeight:800, color:"#0F172A", marginBottom:16 }}>Evaluation Workflow</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {[
                { step:"1A", title:"KB Lookup",      subtitle:kbGrounded?"Used":"Not used", color:kbGrounded?"#059669":"#94A3B8", bg:kbGrounded?"#F0FDF4":"#F8FAFC", desc:"Question matched against knowledge base. If found, KB chunk becomes the ground-truth reference." },
                { step:"1B", title:"LLM Generation", subtitle:kbGrounded?"Skipped":"Used",  color:kbGrounded?"#94A3B8":M,         bg:kbGrounded?"#F8FAFC":"#EEF4FF", desc:"All 3 judges independently generate a reference answer and cross-validate for agreement." },
                { step:"2",  title:"Majority Vote",  subtitle:"Always runs",                 color:"#7C3AED",                       bg:"#F3E8FF",                       desc:"≥ 2/3 judges = verdict. 3/3 = High confidence. 2/3 = Medium. Tied = Disputed, excluded." },
              ].map((s) => (
                <div key={s.step} style={{ padding:"13px 15px", borderRadius:0, background:s.bg, border:"1px solid #E2E8F0" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                    <span style={{ fontSize:9, fontWeight:700, color:s.color, textTransform:"uppercase" as const, letterSpacing:"0.5px" }}>Stage {s.step}</span>
                    <span style={{ fontWeight:700, fontSize:13, color:"#1E293B", flex:1 }}>{s.title}</span>
                    <span style={{ fontSize:10, padding:"2px 8px", borderRadius:0, background:s.color, color:"white", fontWeight:700 }}>{s.subtitle}</span>
                  </div>
                  <p style={{ margin:0, fontSize:11.5, color:"#475569", lineHeight:1.5 }}>{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Accuracy gauge — full width */}
        {accuracyPct != null && (
          <div className="la-card" style={{ padding:"22px 24px", marginBottom:20 }}>
            <div style={{ fontSize:14, fontWeight:800, color:"#0F172A", marginBottom:16 }}>Accuracy Gauge</div>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#94A3B8", marginBottom:6, fontWeight:500 }}>
              <span>0%</span><span style={{ color:"#64748B" }}>Poor (&lt;60%)</span><span style={{ color:M }}>Moderate (60–80%)</span><span style={{ color:"#059669" }}>Good (80%+)</span><span>100%</span>
            </div>
            <div style={{ height:12, background:"linear-gradient(90deg,#FEE2E2 0%,#FEE2E2 60%,#EEF4FF 60%,#EEF4FF 80%,#DCFCE7 80%,#DCFCE7 100%)", borderRadius:0, position:"relative", border:"1px solid #E2E8F0" }}>
              <div style={{ position:"absolute", left:`${Math.min(accuracyPct,98)}%`, top:"50%", transform:"translate(-50%,-50%)", width:20, height:20, background:ac, borderRadius:"50%", border:"3px solid white", boxShadow:`0 0 0 2px ${ac}`, transition:"left 0.8s ease" }}/>
            </div>
            <div style={{ textAlign:"center", marginTop:10, fontSize:13, fontWeight:700, color:ac }}>
              {r.model_label||r.model_type} scored {accuracyPct}% — benchmark: 85%+ general, 90%+ domain-specific
            </div>
          </div>
        )}

        {/* Confidence + methodology */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>

          {confs.length > 0 && (
            <div className="la-card" style={{ padding:"22px 24px" }}>
              <div style={{ fontSize:14, fontWeight:800, color:"#0F172A", marginBottom:16 }}>Confidence Breakdown</div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {[
                  { label:"High Confidence",  count:nHigh, total:confs.length, color:"#059669", bg:"#F0FDF4", vote:"3/3 unanimous",  tip:"All judges agreed" },
                  { label:"Medium Confidence",count:nMed,  total:confs.length, color:"#2563EB", bg:"#EFF6FF", vote:"2/3 majority",   tip:"Solid — review dissent" },
                  { label:"Low / Disputed",   count:nLow+disputed, total:confs.length, color:"#64748B", bg:"#F1F5F9", vote:"Split/tied", tip:"Excluded from accuracy" },
                ].map(c => {
                  const pct = confs.length > 0 ? Math.round((c.count/confs.length)*100) : 0;
                  return (
                    <div key={c.label} style={{ padding:"13px 15px", borderRadius:0, background:c.bg, border:`1px solid ${c.color}25` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                        <span style={{ fontSize:12, fontWeight:700, color:c.color }}>{c.label}</span>
                        <span style={{ fontSize:11, color:"#64748B" }}>{c.count} rows ({pct}%)</span>
                      </div>
                      <div style={{ height:5, background:"white", borderRadius:0, overflow:"hidden", marginBottom:6 }}>
                        <div style={{ height:"100%", width:`${pct}%`, background:c.color, borderRadius:0 }}/>
                      </div>
                      <div style={{ fontSize:11, color:"#94A3B8", fontStyle:"italic" }}>{c.tip} · {c.vote}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="la-card" style={{ padding:"22px 24px" }}>
            <div style={{ fontSize:14, fontWeight:800, color:"#0F172A", marginBottom:16 }}>Methodology</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {[
                { label:"Reference Source", val:kbGrounded?`Knowledge base (${kbCount} chunks) — Jaccard ≥ 0.12`:"LLM panel consensus — Jaccard ≥ 0.15" },
                { label:"Verdict Rule",     val:`Majority vote (≥ 2 of ${panelSize>0?panelSize:3} judges). Tie = Disputed & excluded.` },
                { label:"Formula",          val:"correct_rows ÷ (judged_rows − disputed_rows)" },
                { label:"Parallelism",      val:"All judges run concurrently via ThreadPoolExecutor." },
              ].map((m,i) => (
                <div key={i} style={{ padding:"10px 12px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E2E8F0" }}>
                  <div style={{ fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.5px", marginBottom:4 }}>{m.label}</div>
                  <div style={{ fontSize:12.5, color:"#374151", fontFamily:m.label==="Formula"?"monospace":"inherit" }}>{m.val}</div>
                </div>
              ))}
            </div>
            {(llm.warnings??[]).length > 0 && (
              <div style={{ marginTop:14, padding:"12px 14px", borderRadius:0, background:"#FFFBEB", border:"1px solid #FDE68A" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#D97706", textTransform:"uppercase" as const, letterSpacing:"0.5px", marginBottom:6 }}>Warnings</div>
                {(llm.warnings??[]).map((w: string, i: number) => (
                  <div key={i} style={{ fontSize:12, color:"#92400E", lineHeight:1.6 }}>• {w}</div>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* Panel Deliberation — per-row, per-judge votes/reasons/latency */}
        <div className="la-card" style={{ padding:"22px 24px", marginTop:20 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:4 }}>
            <div style={{ fontSize:14, fontWeight:800, color:"#0F172A" }}>Panel Deliberation</div>
            {panelRows && <div style={{ fontSize:11, color:"#94A3B8" }}>{panelRows.length} rows</div>}
          </div>
          <div style={{ fontSize:12, color:"#94A3B8", marginBottom:16 }}>What each judge actually said about each response, including their individual reply latency</div>

          {panelLoading && <div style={{ fontSize:12.5, color:"#64748B" }}>Loading panel deliberation…</div>}
          {!panelLoading && (!panelRows || panelRows.length === 0) && (
            <div style={{ fontSize:12.5, color:"#94A3B8" }}>No per-row panel deliberation is available for this report.</div>
          )}

          {!panelLoading && panelRows && panelRows.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {panelRows.map((row: any, i: number) => {
                const isOpen = panelExpanded === i;
                const vColor = row.final_correct ? "#059669" : "#DC2626";
                const vBg    = row.final_correct ? "#F0FDF4" : "#FEF2F2";
                return (
                  <div key={i} style={{ border:"1px solid #E2E8F0", borderRadius:0 }}>
                    <div
                      onClick={() => setPanelExpanded(isOpen ? null : i)}
                      style={{ padding:"12px 14px", display:"flex", alignItems:"center", gap:10, cursor:"pointer", background: isOpen ? "#F8FAFC" : "white" }}
                    >
                      <span style={{ fontSize:10, padding:"2px 8px", borderRadius:0, background:vBg, color:vColor, fontWeight:700, border:`1px solid ${vColor}30` }}>
                        {row.final_correct ? "Correct" : "Incorrect"}
                      </span>
                      {row.disputed && <span style={{ fontSize:10, padding:"2px 8px", borderRadius:0, background:"#EFF6FF", color:"#2563EB", fontWeight:700 }}>Disputed</span>}
                      {row.kb_used && <span style={{ fontSize:10, padding:"2px 8px", borderRadius:0, background:"#F0FDF4", color:"#059669", fontWeight:700 }}>KB-grounded</span>}
                      <span style={{ fontSize:12.5, color:"#334155", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {row.input || `Row ${row.row_index}`}
                      </span>
                      <span style={{ fontSize:11, color:"#94A3B8" }}>{isOpen ? "▲" : "▼"}</span>
                    </div>
                    {isOpen && (
                      <div style={{ padding:"4px 14px 14px", borderTop:"1px solid #E2E8F0" }}>
                        {row.input && (
                          <div style={{ margin:"10px 0 6px", fontSize:12, color:"#475569" }}>
                            <span style={{ fontWeight:700 }}>Input: </span>{row.input}
                          </div>
                        )}
                        {row.output && (
                          <div style={{ margin:"0 0 12px", fontSize:12, color:"#475569" }}>
                            <span style={{ fontWeight:700 }}>Output: </span>{row.output}
                          </div>
                        )}
                        <div style={{ display:"grid", gridTemplateColumns:`repeat(${Math.max(row.judges?.length || 1, 1)}, 1fr)`, gap:10 }}>
                          {(row.judges || []).map((j: any, ji: number) => (
                            <div key={ji} style={{ padding:"10px 12px", background: j.vote ? "#F0FDF4" : "#FEF2F2", border:`1px solid ${j.vote ? "#05966930" : "#DC262630"}` }}>
                              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                                <span style={{ fontSize:11.5, fontWeight:700, color:"#1E293B" }}>{j.judge_name}</span>
                                <span style={{ fontSize:10, fontWeight:700, color: j.vote ? "#059669" : "#DC2626" }}>{j.vote ? "Correct" : "Incorrect"}</span>
                              </div>
                              {j.reason && <div style={{ fontSize:11.5, color:"#475569", lineHeight:1.5, marginBottom:6 }}>{j.reason}</div>}
                              {j.latency_ms != null && (
                                <div style={{ fontSize:10.5, color:"#94A3B8" }}>{Math.round(j.latency_ms)} ms round-trip</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

    <LensFooter data={raw} />
    </div>
  );
}