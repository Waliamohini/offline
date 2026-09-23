/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import AuditContextBar, { LensFooter } from "../components/AuditContextBar";
import { useLocation, useNavigate } from "react-router-dom";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";

const M = "#005EB8";
const FF = "'Plus Jakarta Sans', system-ui, sans-serif";
const sc   = (s: number) => s >= 75 ? "#059669" : s >= 50 ? "#2563EB" : "#64748B";
const sbg  = (s: number) => s >= 75 ? "#F0FDF4" : s >= 50 ? "#EFF6FF" : "#F1F5F9";
const band = (s: number) => s >= 75 ? "Strong"  : s >= 50 ? "Watch"   : "Weak";

const CONF_COLOR: Record<string, string> = { high:"#059669", medium:"#D97706", low:"#DC2626", none:"#94A3B8" };
const CONF_TIP: Record<string, string> = {
  high:   "Strong evidence — multiple probes ran cleanly with consistent results.",
  medium: "Reasonable evidence — likely accurate but based on fewer probes.",
  low:    "Weak evidence — treat as a starting point. Worth a manual check.",
  none:   "No usable evidence collected for this check.",
};
const TIER_LABEL: Record<string, string> = {
  llm_judged:"Judged by AI", regex:"Pattern scan", structural:"Structural check",
  conversational_signal:"Conversational signal", low_confidence_conversational:"Low-confidence signal",
};
const TIER_TIP: Record<string, string> = {
  llm_judged:"An AI judge reviewed the system responses.",
  regex:"Responses scanned for unsafe patterns (keys, stack traces, etc.).",
  structural:"Inferred from system configuration, not individual responses.",
  conversational_signal:"Detected from how the system responded to probing questions.",
  low_confidence_conversational:"Signal from conversation only — cannot confirm without source access.",
};

const CSS = `
*{box-sizing:border-box;margin:0;padding:0;}body{background:#F8FAFC;}
.cbr-card{background:#fff;border-radius:0px;border:1px solid #E2E8F0;box-shadow:0 1px 3px rgba(0,0,0,0.05),0 4px 12px rgba(0,0,0,0.04);}
@keyframes cbrIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.cbr-in{animation:cbrIn 0.32s cubic-bezier(.22,1,.36,1) both;}
`;

function InfoTooltip({ text, width=220 }: { text:string; width?:number }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position:"relative", display:"inline-flex", alignItems:"center", verticalAlign:"middle", marginLeft:5, cursor:"help" }}
      onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
      {show && (
        <div style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)",
          background:"#0F172A", color:"white", fontSize:11.5, lineHeight:1.5, padding:"8px 12px",
          width, pointerEvents:"none", boxShadow:"0 4px 16px rgba(0,0,0,0.25)", zIndex:200, whiteSpace:"normal" as const }}>
          {text}
          <div style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", borderWidth:5, borderStyle:"solid", borderColor:"#0F172A transparent transparent transparent" }}/>
        </div>
      )}
    </span>
  );
}

function StatusDot({ score, unavailable }: { score:number; unavailable:boolean }) {
  const color = unavailable ? "#CBD5E1" : sc(score);
  return (
    <div style={{ width:28, height:28, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", background: unavailable ? "#F1F5F9" : sbg(score), border:`2px solid ${color}` }}>
      {unavailable ? <span style={{ fontSize:13, color:"#94A3B8", fontWeight:700 }}>–</span>
        : score>=75 ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        : score>=50 ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16.5" x2="12.01" y2="16.5"/></svg>
        : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      }
    </div>
  );
}

function CheckCard({ c }: { c:any }) {
  const [open, setOpen] = useState(false);
  const unavailable = c.status !== "evaluated";
  const color = unavailable ? "#94A3B8" : sc(c.score);
  return (
    <div style={{ borderBottom:"1px solid #F1F5F9" }}>
      <div onClick={()=>!unavailable&&setOpen(o=>!o)}
        style={{ display:"flex", alignItems:"center", gap:14, cursor:unavailable?"default":"pointer", padding:"14px 18px", transition:"background 0.12s" }}
        onMouseEnter={e=>{if(!unavailable)(e.currentTarget as HTMLElement).style.background="#F8FAFC";}}
        onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="transparent";}}>
        <StatusDot score={c.score} unavailable={unavailable} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:700, color:"#0F172A" }}>{c.title}</div>
          <div style={{ fontSize:12, color:"#64748B", marginTop:3, lineHeight:1.45 }}>{c.ai_summary||c.plain||c.summary}</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
          {unavailable
            ? <span style={{ fontSize:11, fontWeight:700, color:"#64748B", background:"#F1F5F9", padding:"3px 10px" }}>Not run</span>
            : <span style={{ fontSize:12, fontWeight:800, color, background:sbg(c.score), padding:"3px 10px" }}>{band(c.score)} · {c.score}</span>
          }
          {!unavailable && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform:open?"rotate(90deg)":"none", transition:"transform 0.18s" }}>
              <polyline points="9 6 15 12 9 18"/>
            </svg>
          )}
        </div>
      </div>
      {open && !unavailable && (
        <div style={{ padding:"14px 18px 16px 60px", background:"#FAFBFD", borderTop:"1px solid #F1F5F9" }}>
          {c.ai_summary && c.plain && c.ai_summary!==c.plain && (
            <div style={{ padding:"10px 14px", background:"#EFF6FF", borderLeft:`3px solid ${M}`, fontSize:12.5, color:"#1E3A5F", lineHeight:1.7, marginBottom:12 }}>
              <div style={{ fontSize:10, fontWeight:700, color:M, letterSpacing:"0.8px", textTransform:"uppercase" as const, marginBottom:4 }}>AI Assessment</div>
              {c.ai_summary}
            </div>
          )}
          <div style={{ display:"grid", gap:10 }}>
            {[{k:"How we tested",v:c.how,col:"#64748B"},{k:"Why it matters",v:c.why,col:"#64748B"},{k:"A good result",v:c.good,col:"#059669"}]
              .filter(r=>r.v).map((row,i)=>(
              <div key={i} style={{ display:"grid", gridTemplateColumns:"130px 1fr", gap:12, alignItems:"start" }}>
                <div style={{ fontSize:11, fontWeight:700, color:row.col, textTransform:"uppercase" as const, letterSpacing:"0.5px", paddingTop:1 }}>{row.k}</div>
                <div style={{ fontSize:12.5, color:"#475569", lineHeight:1.6 }}>{row.v}</div>
              </div>
            ))}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" as const, marginTop:12, paddingTop:12, borderTop:"1px solid #EEF2F7" }}>
            {c.evidence_tier && <span style={{ fontSize:10.5, fontWeight:700, color:"#475569", background:"#F1F5F9", padding:"3px 9px", display:"inline-flex", alignItems:"center" }}>{TIER_LABEL[c.evidence_tier]||c.evidence_tier}<InfoTooltip text={TIER_TIP[c.evidence_tier]||"How evidence was gathered."}/></span>}
            <span style={{ fontSize:10.5, fontWeight:700, color:"#475569", background:"#F1F5F9", padding:"3px 9px" }}>{c.probes_run} probe{c.probes_run!==1?"s":""} run</span>
            <span style={{ fontSize:10.5, fontWeight:700, color:CONF_COLOR[c.confidence]||"#94A3B8", background:"#F8FAFC", padding:"3px 9px", border:`1px solid ${(CONF_COLOR[c.confidence]||"#94A3B8")}22`, display:"inline-flex", alignItems:"center" }}>
              {c.confidence} confidence<InfoTooltip text={CONF_TIP[c.confidence]||"Evidence reliability."}/>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CodeBuildRisk() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const raw = location.state?.data || (()=>{ try{ const s=sessionStorage.getItem("lastReportData"); return s?JSON.parse(s):null; }catch{ return null; }})();
  const [ctxOpen, setCtxOpen] = useState(false);
  const [, setAnim] = useState(false);
  useEffect(()=>{ setTimeout(()=>setAnim(true),100); },[]);

  if (!raw) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", fontFamily:FF }}>
      <button onClick={()=>navigate("/dashboard")} style={{ padding:"10px 24px", background:M, border:"none", color:"white", fontWeight:700, cursor:"pointer" }}>← Back</button>
    </div>
  );

  const cbr = raw.code_build_risk;
  if (!cbr) return (
    <div style={{ minHeight:"100vh", background:"#F8FAFC", fontFamily:FF }}>
      <style>{CSS}</style>
      <AuditContextBar data={raw}/>
      <div style={{ padding:"60px 40px", textAlign:"center" }}>
        <div style={{ fontSize:15, fontWeight:700, color:"#64748B" }}>No build risk data for this report. Re-run the audit to generate it.</div>
      </div>
      <LensFooter data={raw} currentPath="/code-build-risk"/>
    </div>
  );

  const checks: any[]  = cbr.checks || [];
  const overall        = cbr.overall_score;
  const probeMode      = cbr.probe_mode || (cbr.applicable ? "full" : "conversational");
  const isFullMode     = probeMode === "full";
  const aiNarrative    = cbr.ai_narrative || "";

  const groups: { name:string; items:any[] }[] = [];
  for (const c of checks) {
    let g = groups.find(x=>x.name===c.group);
    if (!g) { g={name:c.group,items:[]}; groups.push(g); }
    g.items.push(c);
  }

  const evaluated = checks.filter(c=>c.status==="evaluated");
  const strong    = evaluated.filter(c=>c.score>=75).length;
  const watch     = evaluated.filter(c=>c.score>=50&&c.score<75).length;
  const weak      = evaluated.filter(c=>c.score<50).length;
  const weakest   = [...evaluated].sort((a,b)=>a.score-b.score).slice(0,3);

  const radarData = groups.map(g=>{
    const ev=g.items.filter(c=>c.status==="evaluated");
    const avg=ev.length?Math.round(ev.reduce((s,c)=>s+c.score,0)/ev.length):0;
    return { group:g.name.replace(" flaws","").replace("Web security config","Web sec").replace(" handling","").replace("Authorization flaws","Auth").replace("Output encoding","XSS/Encoding").replace("Supply chain","Supply chain").replace("Holds its ground","Persona"), score:avg, fullMark:100 };
  });

  const barData=[...evaluated].sort((a,b)=>a.score-b.score).slice(0,8)
    .map(c=>({ name:c.title.length>22?c.title.slice(0,20)+"…":c.title, score:c.score, full:c.title }));

  const verdict = overall==null
    ? { headline:"Not enough probes ran to score this build.", detail:"Signals below still give useful context.", color:"#94A3B8", bg:"#F1F5F9", icon:"–" }
    : overall>=75 ? { headline:"No significant vulnerabilities detected.", detail:`${strong} of ${evaluated.length} checks passed${watch>0?`, ${watch} worth monitoring`:"."}.`, color:"#059669", bg:"#F0FDF4", icon:"✓" }
    : overall>=50 ? { headline:`${watch+weak} of ${evaluated.length} checks need attention.`, detail:weakest.length?`Prioritise: ${weakest.map(c=>c.title).join(", ")}.`:"Review checks below.", color:"#D97706", bg:"#FFFBEB", icon:"!" }
    : { headline:`${weak} vulnerabilit${weak===1?"y":"ies"} found.`, detail:weakest.length?`Start with: ${weakest.slice(0,2).map(c=>c.title).join(" and ")}.`:"Review checks below.", color:"#DC2626", bg:"#FEF2F2", icon:"✗" };

  return (
    <div style={{ minHeight:"100vh", background:"#F8FAFC", fontFamily:FF, color:"#0F172A" }}>
      <style>{CSS}</style>
      <AuditContextBar data={raw}/>
      <div style={{ padding:"24px 40px 64px", maxWidth:1100, margin:"0 auto" }}>

        {/* Header */}
        <div className="cbr-in" style={{ marginBottom:18 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ fontSize:22, fontWeight:900, color:"#0F172A", letterSpacing:"-0.5px" }}>Build Vulnerabilities</div>
            <InfoTooltip width={270} text="Security posture of the app layer around the AI — injection, auth, config, output encoding. Assessed by probing the live system; no source code needed."/>
          </div>
          <div style={{ fontSize:13.5, color:"#64748B", marginTop:4, lineHeight:1.55 }}>
            Assessed through {isFullMode?"targeted adversarial probing":"conversational probing"}
            {!isFullMode&&" — register as AI-built for full adversarial mode"}.
          </div>
        </div>

        {/* Evidence mode notice */}
        {!isFullMode && (
          <div className="cbr-in" style={{ display:"flex", gap:10, alignItems:"flex-start", background:"#FFF7ED", border:"1px solid #FED7AA", padding:"12px 16px", marginBottom:16 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, marginTop:1 }}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span style={{ fontSize:12.5, color:"#92400E", lineHeight:1.6 }}>
              <strong>Conversational mode</strong> — probes test security posture through conversation.
              {" "}<strong>Set "Was AI used to write the code?"</strong> at registration to unlock full adversarial injection testing.
            </span>
          </div>
        )}

        {/* Verdict */}
        <div className="cbr-card cbr-in" style={{ padding:"20px 24px", marginBottom:14, background:verdict.bg, border:`1px solid ${verdict.color}30` }}>
          <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" as const }}>
            <div style={{ width:44, height:44, borderRadius:"50%", background:verdict.color, display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontSize:20, fontWeight:900, flexShrink:0 }}>
              {verdict.icon}
            </div>
            <div style={{ flex:1, minWidth:200 }}>
              {aiNarrative
                ? <div style={{ fontSize:14, color:"#1E293B", lineHeight:1.75 }}>{aiNarrative}</div>
                : <><div style={{ fontSize:15, fontWeight:800, color:verdict.color, marginBottom:3 }}>{verdict.headline}</div>
                    <div style={{ fontSize:12.5, color:"#475569", lineHeight:1.6 }}>{verdict.detail}</div></>
              }
            </div>
            {overall!=null && (
              <div style={{ textAlign:"center" as const, flexShrink:0 }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.6px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  Build score<InfoTooltip text="Average across evaluated checks. Display-only."/>
                </div>
                <div style={{ fontSize:36, fontWeight:900, color:sc(overall), lineHeight:1 }}>{overall}</div>
                <span style={{ fontSize:11, fontWeight:800, color:sc(overall), background:"white", padding:"2px 10px" }}>{band(overall)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Display-only notice */}
        <div className="cbr-in" style={{ display:"flex", gap:9, alignItems:"center", background:"#EFF6FF", border:"1px solid #BFDBFE", padding:"10px 14px", marginBottom:20 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={M} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
          <span style={{ fontSize:12, color:"#1E40AF", lineHeight:1.5 }}>
            Shown for awareness only — does <strong>not</strong> affect the governance score.
          </span>
        </div>

        {/* Charts */}
        {evaluated.length>0 && (
          <div className="cbr-in" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:18 }}>
            <div className="cbr-card" style={{ padding:"18px 20px" }}>
              <div style={{ fontSize:13, fontWeight:800, color:"#0F172A", marginBottom:2 }}>Security posture by group</div>
              <div style={{ fontSize:11.5, color:"#94A3B8", marginBottom:10 }}>Average score per check category</div>
              {radarData.length>=3 ? (
                <div style={{ height:220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="#E2E8F0"/>
                      <PolarAngleAxis dataKey="group" tick={{ fontSize:10, fill:"#64748B", fontWeight:600 }}/>
                      <Radar dataKey="score" stroke={M} fill={M} fillOpacity={0.15} strokeWidth={2} dot={{ fill:M, r:3 }}/>
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div style={{ height:220, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span style={{ fontSize:12, color:"#94A3B8" }}>Need ≥ 3 groups</span>
                </div>
              )}
            </div>
            <div className="cbr-card" style={{ padding:"18px 20px" }}>
              <div style={{ fontSize:13, fontWeight:800, color:"#0F172A", marginBottom:2 }}>
                {barData.length<evaluated.length?`${barData.length} weakest checks`:"All checks"}
              </div>
              <div style={{ fontSize:11.5, color:"#94A3B8", marginBottom:10 }}>Score per check (lowest first)</div>
              <div style={{ height:220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} layout="vertical" margin={{ left:4, right:20, top:2, bottom:2 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F7" horizontal={false}/>
                    <XAxis type="number" domain={[0,100]} tick={{ fontSize:10, fill:"#94A3B8" }}/>
                    <YAxis type="category" dataKey="name" width={118} tick={{ fontSize:10, fill:"#475569" }}/>
                    <Tooltip cursor={{ fill:"#F8FAFC" }} contentStyle={{ fontSize:12, border:"1px solid #E2E8F0" }}
                      formatter={(val:any,_:any,props:any)=>[val+"/100", props.payload.full||props.payload.name]}/>
                    <Bar dataKey="score" barSize={13} radius={[0,3,3,0]}>
                      {barData.map((d,i)=><Cell key={i} fill={sc(d.score)}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* Tally strip */}
        {evaluated.length>0 && (
          <div className="cbr-in" style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:20 }}>
            {[
              { label:"Strong", n:strong, col:"#059669", bg:"#F0FDF4", tip:"Scored 75+. No action needed.", sub:"No action needed" },
              { label:"Watch",  n:watch,  col:"#D97706", bg:"#FFFBEB", tip:"Scored 50–74. Worth reviewing.", sub:"Review recommended" },
              { label:"Weak",   n:weak,   col:"#DC2626", bg:"#FEF2F2", tip:"Below 50 — fix before production.", sub:"Fix before production" },
            ].map((t,i)=>(
              <div key={i} className="cbr-card" style={{ padding:"14px 18px", background:t.bg, border:`1px solid ${t.col}20` }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:t.col, textTransform:"uppercase" as const, letterSpacing:"0.5px", display:"flex", alignItems:"center" }}>
                      {t.label}<InfoTooltip text={t.tip} width={160}/>
                    </div>
                    <div style={{ fontSize:11, color:"#94A3B8", marginTop:2 }}>{t.sub}</div>
                  </div>
                  <div style={{ fontSize:32, fontWeight:900, color:t.col, lineHeight:1 }}>{t.n}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Check groups */}
        {groups.map((g,gi)=>{
          const gEval=g.items.filter(c=>c.status==="evaluated");
          const gAvg=gEval.length?Math.round(gEval.reduce((s,c)=>s+c.score,0)/gEval.length):null;
          return (
            <div key={gi} className="cbr-in" style={{ marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                <div style={{ fontSize:11.5, fontWeight:800, color:"#64748B", textTransform:"uppercase" as const, letterSpacing:"0.8px" }}>
                  {g.name}<span style={{ fontWeight:500, textTransform:"none" as const, letterSpacing:0, marginLeft:6, color:"#94A3B8" }}>{g.items.length} check{g.items.length!==1?"s":""}</span>
                </div>
                {gAvg!=null && <span style={{ fontSize:11, fontWeight:800, color:sc(gAvg), background:sbg(gAvg), padding:"2px 10px" }}>avg {gAvg}</span>}
              </div>
              <div className="cbr-card" style={{ overflow:"hidden" }}>
                {g.items.map((c,ci)=><CheckCard key={ci} c={c}/>)}
              </div>
            </div>
          );
        })}

        {/* Additional context — collapsible */}
        {cbr.context && (
          <div className="cbr-in" style={{ marginTop:22 }}>
            <button onClick={()=>setCtxOpen(o=>!o)}
              style={{ display:"flex", alignItems:"center", gap:8, background:"none", border:"none", cursor:"pointer", fontFamily:FF, padding:"8px 0", color:"#64748B", fontSize:12.5, fontWeight:600 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform:ctxOpen?"rotate(90deg)":"none", transition:"transform 0.18s" }}>
                <polyline points="9 6 15 12 9 18"/>
              </svg>
              Additional context (from registration — not verified by probes)
            </button>
            {ctxOpen && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginTop:10 }}>
                {[
                  { label:"Built with", val:cbr.context.built_with, warn:false, tip:"Declared at registration. Used as additional probe context — not audited." },
                  { label:"Human review before deploy", val:cbr.context.human_review_gate, warn:/no|unknown/i.test(cbr.context.human_review_gate||""), tip:"Whether a human reviewed the code before deployment, as declared. Not verified." },
                  { label:"Self-report consistency", val:cbr.context.reconciliation, warn:/conflict/i.test(cbr.context.reconciliation||""), tip:"Whether the live system's self-report matches registration. A conflict may affect check accuracy." },
                ].map((s,i)=>(
                  <div key={i} className="cbr-card" style={{ padding:"12px 14px", background:s.warn?"#FFF7ED":"#FAFBFD" }}>
                    <div style={{ fontSize:10.5, color:"#94A3B8", fontWeight:600, display:"flex", alignItems:"center", marginBottom:4 }}>
                      {s.label}<InfoTooltip text={s.tip}/>
                    </div>
                    <div style={{ fontSize:13.5, fontWeight:700, color:s.warn?"#D97706":"#0F172A" }}>{s.val||"—"}</div>
                    <div style={{ fontSize:10.5, color:"#94A3B8", marginTop:3 }}>From registration · not verified by probes</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footnote */}
        <div style={{ display:"flex", gap:8, alignItems:"flex-start", marginTop:24, paddingTop:14, borderTop:"1px solid #E2E8F0" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, marginTop:1 }}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span style={{ fontSize:11, color:"#94A3B8", lineHeight:1.55 }}>
            All tests use the same authorization, rate, and scope as the rest of the audit.
            Conversational signals cannot substitute for a proper security scan — treat findings as starting points for deeper investigation.
          </span>
        </div>

        <LensFooter data={raw} currentPath="/code-build-risk"/>
      </div>
    </div>
  );
}