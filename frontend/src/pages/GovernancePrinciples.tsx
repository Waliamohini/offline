/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from "react";
import AuditContextBar, { LensFooter } from "../components/AuditContextBar";
import { useLocation, useNavigate } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { getSubParameters } from "../services/api";

const M = "#005EB8", B = "#00338D", L = "#0091DA";
const sc = (s: number) => s >= 75 ? "#059669" : s >= 50 ? M : "#64748B";
const sb = (s: number) => s >= 75 ? "#F0FDF4" : s >= 50 ? "#EFF6FF" : "#F1F5F9";
const band = (s: number) => s >= 75 ? "Strong" : s >= 50 ? "Watch" : "Critical";

const COLORS: Record<string, string> = {
  Transparency:"#0091DA", Explainability:M, Fairness:"#0078C8",
  Accountability:B, "Data Integrity":"#004F9F", Reliability:L,
  Security:"#003087", Privacy:M, Sustainability:"#006B8F", Safety:B,
};

// SVG icons per principle — matches screenshot icons
const PRINCIPLE_ICON: Record<string, React.ReactElement> = {
  "Fairness": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="3" x2="12" y2="20"/><path d="M3 6l9 4 9-4"/><path d="M5 10l-2 5h4z"/><path d="M19 10l-2 5h4z"/><line x1="5" y1="20" x2="19" y2="20"/>
    </svg>
  ),
  "Explainability": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  "Data Integrity": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
    </svg>
  ),
  "Security": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  "Privacy": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
    </svg>
  ),
  "Transparency": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  "Accountability": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
    </svg>
  ),
  "Reliability": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  "Safety": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
    </svg>
  ),
  "Sustainability": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
    </svg>
  ),
};

const PRINCIPLE_CONTEXT: Record<string, string> = {
  Fairness:"Measures whether the AI treats all users and demographic groups equally — consistent quality, tone, and length regardless of who is asking.",
  Transparency:"Measures whether the AI is open about what it knows, what it doesn't know, and how it arrived at its answers.",
  Explainability:"Measures whether the AI's outputs can be understood, interpreted, and verified by humans.",
  Accountability:"Measures whether there is a clear, auditable chain of responsibility for the AI's decisions.",
  "Data Integrity":"Measures the quality, completeness, and trustworthiness of the data used for evaluation.",
  Reliability:"Measures how consistently and predictably the AI performs.",
  Security:"Measures whether the AI system is protected against adversarial attacks, misuse, and data exposure.",
  Safety:"Measures whether the AI avoids generating harmful, dangerous, or misleading outputs.",
  Privacy:"Measures whether the AI handles personal data responsibly.",
  Sustainability:"Measures the environmental and computational efficiency of the AI system.",
};

const SUB_META: Record<string, string> = {
  "Demographic Tone Equity":"Tone and quality consistency across demographic groups",
  "Output Length Equity":"Consistency of response length across all queries",
  "Vocabulary Diversity":"Breadth and variety of the input evaluation dataset",
  "Uncertainty Disclosure":"How appropriately the AI communicates uncertainty",
  "Input Coverage in Response":"How well the AI addresses what was actually asked",
  "Causal Reasoning Language":"How often the AI explains the 'why' behind its answers",
  "Step-by-Step Reasoning":"Whether the AI breaks its thinking into followable steps",
  "Confidence Expression":"Whether the AI signals certainty vs. uncertainty appropriately",
  "Source Citation Rate":"How often the AI cites sources for its claims",
  "Flesch Readability Score":"How easy the AI's responses are to read",
  "Human Escalation Signals":"How often the AI appropriately flags situations for human review",
  "Governance Language Rate":"How often the AI references regulatory and compliance frameworks",
  "Error Acknowledgment Rate":"How often the AI admits errors and guides users to alternatives",
  "Audit Log Adequacy":"Whether logs are sufficient to reconstruct what happened",
  "Response Substance Rate":"Whether responses add real information beyond repeating the question",
  "Output Format Consistency":"How structurally consistent responses are across queries",
  "Coherence Score":"How logically connected each response is from start to finish",
  "Deduplication Quality":"How many duplicate records exist in the evaluation dataset",
  "Output Coherence":"Internal logical consistency of each response",
  "Response Consistency":"Whether the AI gives similar answers to similar queries",
  "Token Efficiency":"Whether response length is appropriate for query complexity",
  "Error Rate Control":"How rarely the AI fails to answer or acknowledges limitations",
  "Prompt Injection Resistance":"Whether adversarial inputs trying to override the AI are detected",
  "Harmful Content Rate":"Whether the AI's outputs contain harmful or dangerous content",
  "Input Anomaly Rate":"Whether inputs are well-formed or show signs of abuse",
  "PII Leakage in Outputs":"Whether personal information appears in the AI's outputs",
  "Harmful Output Prevention":"Whether the AI's safety controls prevent harmful content",
  "Hallucination Containment":"Whether the AI avoids fabricating facts or making ungrounded claims",
  "Human Override Readiness":"Whether the AI can hand control to a human when needed",
  "Safety Pass Rate":"Proportion of responses rated safe by the LLM Judge Panel",
  "PII Leakage Rate":"Rate of personal data appearing in outputs",
  "Data Minimisation":"Whether the AI gives concise, focused answers",
  "Output Anonymisation":"Whether personal identifiers are absent from outputs",
  "Retention Signal Coverage":"Whether the AI mentions data rights and retention obligations",
  "Token Economy Score":"Whether responses are concise and information-dense",
  "Response Redundancy Rate":"How often the AI repeats itself within a single response",
  "Cross-Output Deduplication":"How many near-identical responses appear across different queries",
  "Lexical Complexity Proxy":"How complex and jargon-heavy the AI's language is",
};

function Spider({ principles, onSelect, selected }: { principles: Record<string, any>; onSelect: (k: string | null) => void; selected: string | null }) {
  const keys = Object.keys(principles);
  const N = keys.length;
  if (N === 0) return null;
  const cx = 300, cy = 300, R = 180, W = 600, H = 600;
  const ang = (i: number) => (Math.PI * 2 * i) / N - Math.PI / 2;
  const pt = (i: number, v: number) => ({ x: cx + (v / 100) * R * Math.cos(ang(i)), y: cy + (v / 100) * R * Math.sin(ang(i)) });
  const labelPos = (i: number) => {
    const a = ang(i), x = cx + (R + 70) * Math.cos(a), y = cy + (R + 70) * Math.sin(a);
    return { x, y, anchor: (Math.cos(a) > 0.3 ? "start" : Math.cos(a) < -0.3 ? "end" : "middle") as "start"|"end"|"middle" };
  };
  const poly = keys.map((k, i) => pt(i, principles[k].score));
  const polyStr = poly.map(p => `${p.x},${p.y}`).join(" ");
  const avg = Math.round(keys.reduce((s, k) => s + principles[k].score, 0) / N);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", maxWidth:W, display:"block", margin:"0 auto" }}>
      {[20,40,60,80,100].map(lvl => (
        <polygon key={lvl} points={keys.map((_,i)=>{ const p=pt(i,lvl); return `${p.x},${p.y}`; }).join(" ")}
          fill={lvl%40===0?"rgba(0,51,141,0.04)":"none"} stroke={lvl===100?"rgba(0,51,141,0.25)":"rgba(0,51,141,0.12)"} strokeWidth={lvl===100?1.5:1}/>
      ))}
      {keys.map((_,i)=>{ const e=pt(i,100); return <line key={i} x1={cx} y1={cy} x2={e.x} y2={e.y} stroke="rgba(0,51,141,0.12)" strokeWidth="1"/>; })}
      <polygon points={polyStr} fill="rgba(0,94,184,0.08)" stroke="none"/>
      <polygon points={polyStr} fill="none" stroke="rgba(0,94,184,0.7)" strokeWidth="2.5" strokeLinejoin="round" style={{ filter:"drop-shadow(0 0 6px rgba(0,94,184,0.3))" }}/>
      {poly.map((p,i)=>{ const k=keys[i]; const c=COLORS[k]||M; const sel=selected===k; return (
        <circle key={i} cx={p.x} cy={p.y} r={sel?12:6} fill={sel?c:"rgba(0,94,184,0.85)"} stroke={sel?"#fff":c} strokeWidth={sel?3:1.5}
          style={{ cursor:"pointer", transition:"all 0.25s ease", filter:sel?`drop-shadow(0 0 10px ${c})`:"none" }}
          onClick={()=>onSelect(sel?null:k)} onMouseEnter={()=>onSelect(k)} onMouseLeave={()=>{ if(!sel)onSelect(null); }}/>
      ); })}
      {keys.map((k,i)=>{ const {x,y,anchor}=labelPos(i); const c=COLORS[k]||M; const sel=selected===k; const sc2=principles[k].score; const parts=k.split(" "); const lh=14; const sy=y-parts.length*lh/2; return (
        <g key={k} style={{ cursor:"pointer" }} onClick={()=>onSelect(sel?null:k)} onMouseEnter={()=>onSelect(k)} onMouseLeave={()=>{ if(!sel)onSelect(null); }}>
          {parts.map((w,pi)=>(<text key={pi} x={x} y={sy+pi*lh} textAnchor={anchor} fill={sel?c:"#374151"} fontSize={sel?"12":"10.5"} fontWeight={sel?"700":"500"} fontFamily="'Plus Jakarta Sans',sans-serif" style={{ transition:"fill 0.2s" }}>{w}</text>))}
          <text x={x} y={sy+parts.length*lh+3} textAnchor={anchor} fill={sel?c:"#6B7280"} fontSize="11" fontWeight="800" fontFamily="'Plus Jakarta Sans',sans-serif">{sc2}</text>
        </g>
      ); })}
      <circle cx={cx} cy={cy} r={42} fill="white" stroke="rgba(0,51,141,0.2)" strokeWidth="1.5" style={{ filter:"drop-shadow(0 4px 12px rgba(0,51,141,0.12))" }}/>
      <text x={cx} y={cy-5} textAnchor="middle" fill={B} fontSize="26" fontWeight="900" fontFamily="'Plus Jakarta Sans',sans-serif">{avg}</text>
      <text x={cx} y={cy+13} textAnchor="middle" fill="#94A3B8" fontSize="8" fontFamily="'Plus Jakarta Sans',sans-serif" letterSpacing="1.5">OVERALL</text>
    </svg>
  );
}

export default function GovernancePrinciples() {
  const location = useLocation();
  const navigate = useNavigate();
  const raw = location.state?.data || (() => { try { const s = sessionStorage.getItem("lastReportData"); return s ? JSON.parse(s) : null; } catch { return null; } })();
  const [sel, setSel] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [, setAnim] = useState(false);
  useEffect(() => { setTimeout(() => setAnim(true), 100); }, []);
  useEffect(() => { setHovered(null); }, [sel]);

  // Engine-tier disclosure (ml vs heuristic) per sub-parameter — this only
  // exists in the normalized report_sub_parameters table, not in the
  // embedded trusted_ai_principles JSONB, so it's fetched separately.
  const [engineMap, setEngineMap] = useState<Record<string, string>>({});
  const reportIdForParams = raw?.report_id;
  useEffect(() => {
    if (!reportIdForParams) return;
    getSubParameters(reportIdForParams)
      .then((res) => {
        const map: Record<string, string> = {};
        for (const row of res.data?.rows ?? []) {
          if (row.engine) map[row.sub_parameter] = row.engine;
        }
        setEngineMap(map);
      })
      .catch(() => setEngineMap({}));
  }, [reportIdForParams]);

  if (!raw) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", fontFamily:"'Plus Jakarta Sans',sans-serif" }}>
      <button onClick={() => navigate("/dashboard")} style={{ padding:"10px 24px", background:M, border:"none", borderRadius:0, color:"white", fontWeight:700, cursor:"pointer" }}>← Back</button>
    </div>
  );

  const r = raw;
  const prn = r.trusted_ai_principles || {};
  const pkeys = Object.keys(prn);
  const selData = sel ? prn[sel] : null;
  const params = selData ? Object.entries(selData.parameters || {}) : [];
  const activeParam = hovered && selData?.parameters?.[hovered] !== undefined ? hovered : (selData ? Object.keys(selData.parameters||{})[0]||null : null);

  const barData = pkeys.map(k => ({ name:k, score:prn[k].score, color:COLORS[k]||M }));

  return (
    <div style={{ minHeight:"100vh", background:"#F4F7FB", fontFamily:"'Plus Jakarta Sans',sans-serif", color:"#0F172A", paddingBottom:80 }}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0;}.gp-card{background:white;border-radius: 0px;border:1px solid #E2E8F0;box-shadow:0 1px 4px rgba(0,0,0,0.05),0 4px 16px rgba(0,0,0,0.04);}.param-row{transition:all 0.18s ease;}.param-row:hover{background:rgba(0,94,184,0.06)!important;border-color:rgba(0,94,184,0.3)!important;}`}</style>

      <AuditContextBar data={raw} />


      <div style={{ maxWidth:1160, margin:"0 auto", padding:"28px 24px" }}>

        {/* Summary tiles */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:14, marginBottom:24 }}>
          {[
            { label:"Avg Principle Score", val:`${Math.round(pkeys.reduce((s,k)=>s+prn[k].score,0)/Math.max(pkeys.length,1))}`, color:M },
            { label:"Strong (≥75)",        val:`${pkeys.filter(k=>prn[k].score>=75).length}/${pkeys.length}`, color:"#059669" },
            { label:"Watch (50–74)",       val:`${pkeys.filter(k=>prn[k].score>=50&&prn[k].score<75).length}`, color:"#D97706" },
            { label:"Critical (<50)",      val:`${pkeys.filter(k=>prn[k].score<50).length}`, color:"#64748B" },
          ].map((t,i) => (
            <div key={i} style={{ background:"white", borderRadius:0, border:"1px solid #E2E8F0", padding:"18px 16px", borderTop:`3px solid ${t.color}` }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.6px", marginBottom:8 }}>{t.label}</div>
              <div style={{ fontSize:26, fontWeight:900, color:t.color }}>{t.val}</div>
            </div>
          ))}
        </div>

        {/* Spider chart */}
        <div className="gp-card" style={{ padding:"28px 32px", marginBottom:20 }}>
          <div style={{ fontSize:15, fontWeight:800, color:"#0F172A", marginBottom:4 }}>Governance Radar</div>
          <div style={{ fontSize:12, color:"#94A3B8", marginBottom:20 }}>Click any principle node to drill into sub-parameters</div>
          <div style={{ maxWidth:600, margin:"0 auto" }}>
            <Spider principles={prn} onSelect={setSel} selected={sel} />
          </div>
        </div>

        {/* Bar chart */}
        <div className="gp-card" style={{ padding:"28px 32px", marginBottom:20 }}>
          <div style={{ fontSize:15, fontWeight:800, color:"#0F172A", marginBottom:20 }}>Principle Score Distribution</div>
          <ResponsiveContainer width="100%" height={Math.max(pkeys.length*60+60,260)}>
            <BarChart data={barData} layout="vertical" margin={{ top:10, right:50, left:150, bottom:10 }}>
              <CartesianGrid strokeDasharray="5 5" stroke="rgba(0,0,0,0.06)" horizontal={false}/>
              <XAxis type="number" domain={[0,100]} tick={{ fill:"#94A3B8", fontSize:12 }}/>
              <YAxis type="category" dataKey="name" tick={{ fill:"#374151", fontSize:12.5, fontWeight:500 }} width={145} axisLine={false} tickLine={false}/>
              <Tooltip cursor={{ fill:"rgba(0,51,141,0.05)" }} contentStyle={{ background:"white", border:"1px solid #E2E8F0", borderRadius:0, padding:"12px 16px" }} formatter={(v: any) => [`${v}/100`,"Score"]}/>
              <Bar dataKey="score" radius={[0,10,10,0]} barSize={24} animationDuration={1400}>
                {barData.map((e,i) => <Cell key={i} fill={e.color} fillOpacity={0.85}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Principle grid or drill-down */}
        {!sel ? (
          <div className="gp-card" style={{ padding:"28px 32px" }}>
            <div style={{ fontSize:15, fontWeight:800, color:"#0F172A", marginBottom:4 }}>All Principles</div>
            <div style={{ fontSize:12, color:"#94A3B8", marginBottom:20 }}>Click any card to inspect sub-parameters</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:12 }}>
              {pkeys.map(k => {
                const c = COLORS[k]||M; const s = prn[k].score;
                return (
                  <div key={k} onClick={() => setSel(k)} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", borderRadius:0, background:"white", border:"1px solid #E2E8F0", cursor:"pointer", transition:"all 0.15s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform="translateY(-2px)"; (e.currentTarget as HTMLDivElement).style.boxShadow=`0 6px 20px ${c}18`; (e.currentTarget as HTMLDivElement).style.borderColor=`${c}40`; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform="translateY(0)"; (e.currentTarget as HTMLDivElement).style.boxShadow="none"; (e.currentTarget as HTMLDivElement).style.borderColor="#E2E8F0"; }}
                  >
                    <div style={{ width:40, height:40, borderRadius:0, flexShrink:0, background:`${c}15`, border:`1px solid ${c}30`, display:"grid", placeItems:"center", color:c }}>
                      {PRINCIPLE_ICON[k] || <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:"#0F172A", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{k}</div>
                      <div style={{ height:5, background:"#F1F5F9", borderRadius:0, marginTop:6 }}>
                        <div style={{ width:`${s}%`, height:"100%", background:sc(s), borderRadius:0, transition:"width 0.8s ease" }}/>
                      </div>
                    </div>
                    <div style={{ textAlign:"right", flexShrink:0 }}>
                      <div style={{ fontSize:20, fontWeight:900, color:sc(s) }}>{s}</div>
                      <div style={{ fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:0, background:sb(s), color:sc(s), textTransform:"uppercase" as const }}>{band(s)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : selData ? (
          <div className="gp-card" style={{ padding:"28px 32px" }}>
            {/* Principle header */}
            <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:16, padding:"18px 22px", borderRadius:0, background:`linear-gradient(135deg,${(COLORS[sel]||M)}10,${(COLORS[sel]||M)}05)`, border:`1.5px solid ${(COLORS[sel]||M)}30` }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:18, fontWeight:800, color:"#0F172A" }}>{sel}</div>
                {PRINCIPLE_CONTEXT[sel] && <div style={{ fontSize:12, color:"#64748B", marginTop:4, lineHeight:1.6 }}>{PRINCIPLE_CONTEXT[sel]}</div>}
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:40, fontWeight:900, color:COLORS[sel]||M, lineHeight:1 }}>{selData.score}</div>
                <div style={{ fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:0, background:sb(selData.score), color:sc(selData.score), marginTop:6, textTransform:"uppercase" as const }}>{band(selData.score)}</div>
              </div>
            </div>
            <button onClick={() => setSel(null)} style={{ marginBottom:20, padding:"8px 16px", background:"#EEF4FF", border:`1px solid ${M}30`, borderRadius:0, color:M, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>← All Principles</button>

            {/* Sub-params + insight */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, alignItems:"start" }}>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:M, textTransform:"uppercase" as const, letterSpacing:"0.08em", marginBottom:12, padding:"8px 12px", background:"#EEF4FF", borderRadius:0 }}>Sub-parameters — hover to inspect</div>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {params.map(([param, val]) => {
                    const v = val as number; const c = COLORS[sel]||M; const isAct = activeParam===param;
                    return (
                      <div key={param} className="param-row" style={{ padding:"14px 16px", borderRadius:0, background:isAct?`${c}08`:"#F8FAFC", border:isAct?`2px solid ${c}50`:"1.5px solid #E2E8F0", cursor:"pointer" }}
                        onMouseEnter={() => setHovered(param)} onMouseLeave={() => setHovered(null)}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                          <div style={{ flex:1, marginRight:8 }}>
                            <div style={{ fontSize:12.5, fontWeight:isAct?700:600, color:"#0F172A", lineHeight:1.3 }}>{SUB_META[param] || param}</div>
                            <div style={{ fontSize:10.5, color:"#94A3B8", marginTop:2, fontFamily:"monospace" }}>{param}</div>
                          </div>
                          <div style={{ textAlign:"right", flexShrink:0 }}>
                            <div style={{ fontSize:20, fontWeight:900, color:sc(v) }}>{v}</div>
                            <div style={{ fontSize:9, fontWeight:700, padding:"1px 6px", borderRadius:0, background:sb(v), color:sc(v), textTransform:"uppercase" as const }}>{band(v)}</div>
                          </div>
                        </div>
                        <div style={{ height:6, background:"#E2E8F0", borderRadius:0 }}>
                          <div style={{ width:`${v}%`, height:"100%", borderRadius:0, background:`linear-gradient(90deg,${c},${sc(v)})`, transition:"width 0.5s ease" }}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ position:"sticky", top:80, padding:"24px", borderRadius:0, background:"white", border:`2px solid ${(COLORS[sel]||M)}20`, minHeight:280, boxShadow:"0 4px 24px rgba(0,0,0,0.06)" }}>
                {activeParam && selData.parameters[activeParam] !== undefined ? (
                  <>
                    <div style={{ fontSize:14, fontWeight:800, color:"#0F172A", marginBottom:4, lineHeight:1.3, display:"flex", alignItems:"center", gap:8 }}>
                      {SUB_META[activeParam] || activeParam}
                      {engineMap[activeParam] && (
                        <span style={{ fontSize:9, fontWeight:700, padding:"2px 8px", borderRadius:0, textTransform:"uppercase" as const, letterSpacing:"0.05em", background: engineMap[activeParam]==="ml" ? "#F0FDF4" : "#F1F5F9", color: engineMap[activeParam]==="ml" ? "#059669" : "#64748B", border:`1px solid ${engineMap[activeParam]==="ml" ? "#05966930" : "#CBD5E130"}` }}>
                          {engineMap[activeParam]==="ml" ? "ML-based" : "Heuristic fallback"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize:10.5, color:"#94A3B8", marginBottom:14, fontFamily:"monospace" }}>{activeParam}</div>
                    <div style={{ padding:"12px 14px", borderRadius:0, background:sb(selData.parameters[activeParam] as number), border:`1px solid ${sc(selData.parameters[activeParam] as number)}18`, marginBottom:12 }}>
                      <div style={{ fontSize:10, fontWeight:700, color:sc(selData.parameters[activeParam] as number), textTransform:"uppercase" as const, letterSpacing:"0.08em", marginBottom:6 }}>
                        {(selData.parameters[activeParam] as number)>=75?"Strong posture":(selData.parameters[activeParam] as number)>=50?"Watch posture":"Needs attention"}
                      </div>
                      <div style={{ fontSize:13, lineHeight:1.7, color:"#1E293B" }}>
                        {(selData.parameters[activeParam] as number)>=75
                          ? `${SUB_META[activeParam] || activeParam} is performing well at ${selData.parameters[activeParam]}/100. This dimension meets enterprise governance standards.`
                          : (selData.parameters[activeParam] as number)>=50
                          ? `${activeParam} scored ${selData.parameters[activeParam]}/100. There is room for improvement — enriching your logs with relevant columns will raise this score.`
                          : `${SUB_META[activeParam] || activeParam} scored ${selData.parameters[activeParam]}/100. This dimension could not be computed or is critically low. Add the relevant log columns to enable this signal.`}
                      </div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:0, background:"#F8FAFC", border:"1px solid #F1F5F9" }}>
                      <div style={{ fontSize:26, fontWeight:900, color:sc(selData.parameters[activeParam] as number) }}>{selData.parameters[activeParam]}</div>
                      <div style={{ fontSize:12, color:"#94A3B8" }}>/ 100</div>
                      <div style={{ marginLeft:"auto", height:6, flex:1, background:"#E2E8F0", borderRadius:0, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${selData.parameters[activeParam]}%`, background:`linear-gradient(90deg,${COLORS[sel]||M},${sc(selData.parameters[activeParam] as number)})`, borderRadius:0, transition:"width 0.6s ease" }}/>
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", minHeight:240, gap:12, opacity:0.4 }}>
                    <div style={{ fontSize:28, color:"#CBD5E1" }}>↖</div>
                    <div style={{ fontSize:13, color:"#94A3B8", textAlign:"center", lineHeight:1.6 }}>Hover a sub-parameter<br/>to see its insight</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

    <LensFooter data={raw} />
    </div>
  );
}