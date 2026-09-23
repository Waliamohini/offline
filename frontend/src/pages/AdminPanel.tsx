/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const B = "#00338D", M = "#005EB8";
function ah() { return { Authorization: `Bearer ${localStorage.getItem("token")}` }; }
function fmt(d: string) { return d ? new Date(d).toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "—"; }
function sc(s: number) { return s>=75?"#059669":s>=50?"#2563EB":"#64748B"; }
function sb(s: number) { return s>=75?"#F0FDF4":s>=50?"#EFF6FF":"#F1F5F9"; }
function band(s: number) { return s>=75?"Strong":s>=50?"Watch":"Critical"; }

export default function AdminPanel() {
  const navigate = useNavigate();
  const [users, setUsers]     = useState<any[]>([]);
  const [audits, setAudits]   = useState<any[]>([]);
  const [tab, setTab]         = useState<"users"|"audits">("audits");
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [auditTab, setAuditTab] = useState<Record<string,"overview"|"principles"|"findings"|"formulas"|"data">>({});

  useEffect(() => {
    Promise.all([
      axios.get("http://localhost:8000/api/admin/users",  { headers: ah() }),
      axios.get("http://localhost:8000/api/admin/audits", { headers: ah() }),
    ]).then(([u, a]) => { setUsers(u.data); setAudits(a.data); })
      .catch(() => navigate("/login"))
      .finally(() => setLoading(false));
  }, [navigate]);

  const fu = users.filter(u => u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase()));
  const fa = audits.filter(a => a.ai_name?.toLowerCase().includes(search.toLowerCase()) || a.report_id?.toLowerCase().includes(search.toLowerCase()));

  const stats = [
    { label:"Total Users",  val:users.length,  color:M },
    { label:"Admins",       val:users.filter(u=>u.role==="admin").length, color:"#7C3AED" },
    { label:"Total Audits", val:audits.length, color:"#059669" },
    { label:"Avg Score",    val:audits.length?Math.round(audits.reduce((s:number,a:any)=>s+(a.overall_score||0),0)/audits.length):"—", color:"#D97706" },
    { label:"High Risk",    val:audits.filter((a:any)=>a.risk_level==="High").length, color:"#DC2626" },
    { label:"Compliant",    val:audits.filter((a:any)=>(a.overall_score||0)>=75).length, color:"#059669" },
  ];

  function getAuditTab(id: string) { return auditTab[id] || "overview"; }
  function setATab(id: string, t: "overview"|"principles"|"findings"|"formulas"|"data") {
    setAuditTab(prev => ({ ...prev, [id]: t }));
  }

  return (
    <div style={{ minHeight:"100vh", background:"#F4F7FB", fontFamily:"'Plus Jakarta Sans','Inter',sans-serif" }}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        .ac{background:white;border-radius: 0px;border:1px solid #E3EAF3;box-shadow:0 2px 10px rgba(0,51,141,0.05);}
        .ah:hover{background:#F8FAFF;}
        .ab{display:inline-flex;align-items:center;padding:3px 10px;border-radius: 0px;font-size:11px;font-weight:700;}
        .as{width:100%;padding:10px 14px 10px 38px;border-radius: 0px;border:1.5px solid #E3EAF3;font-size:13px;font-family:inherit;outline:none;transition:border 0.2s;}
        .as:focus{border-color:#005EB8;}
        .at{border:none;cursor:pointer;font-family:inherit;background:transparent;transition:all 0.18s;}
        .exp-row{cursor:pointer;transition:background 0.15s;}
        .exp-row:hover{background:#F0F6FF;}
        code{font-family:'Fira Mono','Courier New',monospace;font-size:11.5px;background:#F1F5F9;border:1px solid #E2E8F0;border-radius: 0px;padding:3px 8px;color:#1E293B;word-break:break-all;}
      `}</style>

      {/* NAV removed — sidebar handles navigation */}

      <div style={{ maxWidth:1300, margin:"0 auto", padding:"32px 40px 80px" }}>

        {/* Stats */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:12, marginBottom:28 }}>
          {stats.map(s => (
            <div key={s.label} className="ac" style={{ padding:"18px 16px", borderTop:`3px solid ${s.color}` }}>
              <div style={{ fontSize:28, fontWeight:900, color:s.color, lineHeight:1 }}>{s.val}</div>
              <div style={{ fontSize:11, color:"#6B7C93", fontWeight:600, marginTop:6 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Main card */}
        <div className="ac" style={{ overflow:"hidden" }}>
          {/* Tab bar + search */}
          <div style={{ padding:"0 24px", borderBottom:"1px solid #E3EAF3", display:"flex", alignItems:"center", justifyContent:"space-between", gap:16 }}>
            <div style={{ display:"flex" }}>
              {(["audits","users"] as const).map(t => (
                <button key={t} className="at" onClick={() => setTab(t)}
                  style={{ padding:"16px 20px", fontSize:13, fontWeight:tab===t?700:500, color:tab===t?B:"#6B7C93", borderBottom:tab===t?`2px solid ${B}`:"2px solid transparent", marginBottom:"-1px", textTransform:"capitalize" }}>
                  {t==="audits"?`Audits (${audits.length})`:`Users (${users.length})`}
                </button>
              ))}
            </div>
            <div style={{ position:"relative", width:280 }}>
              <svg style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"#94A3B8" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input className="as" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {loading ? (
            <div style={{ padding:"60px", textAlign:"center", color:"#94A3B8", fontSize:14 }}>Loading…</div>
          ) : tab === "users" ? (
            <UsersTable users={fu} />
          ) : (
            <AuditsTable audits={fa} expanded={expanded} setExpanded={setExpanded} getAuditTab={getAuditTab} setATab={setATab} />
          )}
        </div>
      </div>
    </div>
  );
}

function UsersTable({ users }: { users: any[] }) {
  return (
    <table style={{ width:"100%", borderCollapse:"collapse" }}>
      <thead>
        <tr style={{ background:"#F8FAFC" }}>
          {["Name","Email","Role","Audits","Joined","Last Login"].map(h => (
            <th key={h} style={{ padding:"12px 20px", textAlign:"left", fontSize:11, fontWeight:700, color:"#94A3B8", letterSpacing:"0.06em", textTransform:"uppercase", borderBottom:"1px solid #E3EAF3" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {users.map((u,i) => (
          <tr key={i} className="ah" style={{ borderBottom:"1px solid #F1F5F9" }}>
            <td style={{ padding:"14px 20px", fontSize:14, fontWeight:600, color:"#0B1F33" }}>{u.name}</td>
            <td style={{ padding:"14px 20px", fontSize:13, color:"#6B7C93" }}>{u.email}</td>
            <td style={{ padding:"14px 20px" }}>
              <span className="ab" style={{ background:u.role==="admin"?"#EDE9FE":"#EFF6FF", color:u.role==="admin"?"#7C3AED":"#005EB8" }}>{u.role}</span>
            </td>
            <td style={{ padding:"14px 20px", fontSize:13, fontWeight:700, color:"#374151" }}>{u.audit_count??0}</td>
            <td style={{ padding:"14px 20px", fontSize:12, color:"#94A3B8" }}>{u.created_at?new Date(u.created_at).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"—"}</td>
            <td style={{ padding:"14px 20px", fontSize:12, color:"#94A3B8" }}>{u.last_login?new Date(u.last_login).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"Never"}</td>
          </tr>
        ))}
        {users.length===0 && <tr><td colSpan={6} style={{ padding:"40px", textAlign:"center", color:"#94A3B8", fontSize:13 }}>No users found.</td></tr>}
      </tbody>
    </table>
  );
}

function AuditsTable({ audits, expanded, setExpanded, getAuditTab, setATab }: {
  audits: any[]; expanded: string|null; setExpanded: (id:string|null)=>void;
  getAuditTab: (id:string)=>"overview"|"principles"|"findings"|"formulas"|"data";
  setATab: (id:string, t:"overview"|"principles"|"findings"|"formulas"|"data")=>void;
}) {
  return (
    <div>
      {/* Header row */}
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1.2fr 80px 90px 90px 140px 40px", gap:0, padding:"10px 20px", background:"#F8FAFC", borderBottom:"1px solid #E3EAF3" }}>
        {["AI System","Model Type","Score","Risk","Findings","Evaluated",""].map(h => (
          <div key={h} style={{ fontSize:11, fontWeight:700, color:"#94A3B8", letterSpacing:"0.06em", textTransform:"uppercase" }}>{h}</div>
        ))}
      </div>
      {audits.length===0 && <div style={{ padding:"40px", textAlign:"center", color:"#94A3B8", fontSize:13 }}>No audits found.</div>}
      {audits.map((a,i) => {
        const id = a.id || a.report_id || String(i);
        const isOpen = expanded === id;
        const score = a.overall_score ?? 0;
        const findings = a.findings?.length ?? 0;
        const prn = a.trusted_ai_principles || {};
        const pkeys = Object.keys(prn);
        const compNotes = a.computation_notes ? Object.entries(a.computation_notes).filter(([k])=>k!=="_error") : [];
        const curTab = getAuditTab(id);

        return (
          <div key={id} style={{ borderBottom:"1px solid #F1F5F9" }}>
            {/* Summary row */}
            <div className="exp-row" onClick={() => setExpanded(isOpen ? null : id)}
              style={{ display:"grid", gridTemplateColumns:"2fr 1.2fr 80px 90px 90px 140px 40px", gap:0, padding:"14px 20px", alignItems:"center", background:isOpen?"#F8FAFF":"white" }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:"#0B1F33" }}>{a.ai_name||"—"}</div>
                <div style={{ fontSize:11, color:"#94A3B8", marginTop:2, fontFamily:"monospace" }}>#{(a.report_id||a.id||"").slice(0,12)}</div>
              </div>
              <div style={{ fontSize:13, color:"#6B7C93" }}>{a.model_label||a.model_type||"—"}</div>
              <div>
                <span className="ab" style={{ background:sb(score), color:sc(score) }}>{score}</span>
                <div style={{ fontSize:9, fontWeight:700, color:sc(score), marginTop:3, textTransform:"uppercase" }}>{band(score)}</div>
              </div>
              <div>
                <span className="ab" style={{ background:a.risk_level==="Low"?"#F0FDF4":a.risk_level==="Moderate"?"#FFFBEB":"#FEF2F2", color:a.risk_level==="Low"?"#059669":a.risk_level==="Moderate"?"#D97706":"#DC2626" }}>
                  {a.risk_level||"—"}
                </span>
              </div>
              <div style={{ fontSize:13, fontWeight:700, color:findings>0?"#DC2626":"#059669" }}>{findings}</div>
              <div style={{ fontSize:12, color:"#94A3B8" }}>{fmt(a.evaluated_at||a.created_at||"")}</div>
              <div style={{ fontSize:16, color:"#94A3B8", textAlign:"center", transition:"transform 0.2s", transform:isOpen?"rotate(180deg)":"rotate(0deg)" }}>▾</div>
            </div>

            {/* Expanded detail */}
            {isOpen && (
              <div style={{ background:"#F8FAFC", borderTop:"1px solid #E3EAF3", padding:"0" }}>
                {/* Inner tab bar */}
                <div style={{ display:"flex", gap:0, padding:"0 24px", borderBottom:"1px solid #E3EAF3", background:"white" }}>
                  {(["overview","principles","findings","formulas","data"] as const).map(t => (
                    <button key={t} className="at" onClick={e=>{e.stopPropagation();setATab(id,t);}}
                      style={{ padding:"12px 18px", fontSize:12, fontWeight:curTab===t?700:500, color:curTab===t?"#00338D":"#6B7C93", borderBottom:curTab===t?"2px solid #00338D":"2px solid transparent", marginBottom:"-1px", textTransform:"capitalize" }}>
                      {t==="principles"?`Principles (${pkeys.length})`:t==="findings"?`Findings (${findings})`:t==="formulas"?"Formulas & Calc":t==="data"?"Data Metrics":t.charAt(0).toUpperCase()+t.slice(1)}
                    </button>
                  ))}
                </div>

                <div style={{ padding:"24px" }}>
                  {curTab==="overview" && <AuditOverview a={a} pkeys={pkeys} prn={prn} />}
                  {curTab==="principles" && <AuditPrinciples prn={prn} />}
                  {curTab==="findings" && <AuditFindings findings={a.findings||[]} />}
                  {curTab==="formulas" && <AuditFormulas prn={prn} compNotes={compNotes} a={a} />}
                  {curTab==="data" && <AuditData a={a} />}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AuditOverview({ a, pkeys, prn }: { a:any; pkeys:string[]; prn:any }) {
  const avgScore = pkeys.length ? Math.round(pkeys.reduce((s,k)=>s+(prn[k]?.score||0),0)/pkeys.length) : 0;
  const fw = a.framework_compliance || {};
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      {/* Key metrics */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:12 }}>
        {[
          { label:"Overall Score",    val:a.overall_score??0,    color:sc(a.overall_score??0), suffix:"/100" },
          { label:"Risk Level",       val:a.risk_level||"—",     color:a.risk_level==="Low"?"#059669":a.risk_level==="Moderate"?"#D97706":"#DC2626" },
          { label:"Avg Principle",    val:avgScore,              color:sc(avgScore), suffix:"/100" },
          { label:"Logs Evaluated",   val:a.logs_evaluated??0,   color:"#005EB8" },
          { label:"Data Quality",     val:`${a.data_quality_score??0}%`, color:"#059669" },
          { label:"Structural Risk",  val:a.structural_risk||"—", color:a.structural_risk==="Low"?"#059669":a.structural_risk==="Moderate"?"#D97706":"#DC2626" },
        ].map(s => (
          <div key={s.label} style={{ background:"white", borderRadius:0, border:"1px solid #E3EAF3", padding:"14px 16px", borderTop:`3px solid ${s.color}` }}>
            <div style={{ fontSize:22, fontWeight:900, color:s.color, lineHeight:1 }}>{s.val}<span style={{ fontSize:11, opacity:0.6 }}>{(s as any).suffix||""}</span></div>
            <div style={{ fontSize:11, color:"#6B7C93", fontWeight:600, marginTop:5 }}>{s.label}</div>
          </div>
        ))}
      </div>
      {/* Framework compliance */}
      {Object.keys(fw).length>0 && (
        <div style={{ background:"white", borderRadius:0, border:"1px solid #E3EAF3", padding:"18px 20px" }}>
          <div style={{ fontSize:12, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12 }}>Framework Compliance</div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            {Object.entries(fw).map(([k,v]:any) => (
              <div key={k} style={{ padding:"8px 14px", borderRadius:0, background:v==="Compliant"?"#F0FDF4":v==="Conditional"?"#FFFBEB":"#FEF2F2", border:`1px solid ${v==="Compliant"?"#86EFAC":v==="Conditional"?"#FCD34D":"#FECACA"}` }}>
                <div style={{ fontSize:11, fontWeight:800, color:"#0B1F33" }}>{k.replace(/_/g," ")}</div>
                <div style={{ fontSize:11, fontWeight:700, color:v==="Compliant"?"#059669":v==="Conditional"?"#D97706":"#DC2626", marginTop:2 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Recommendation */}
      {a.recommendation && (
        <div style={{ background:"white", borderRadius:0, border:"1px solid #E3EAF3", padding:"18px 20px", borderLeft:"4px solid #005EB8" }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#005EB8", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Overall Recommendation</div>
          <p style={{ fontSize:13, color:"#1E293B", lineHeight:1.8, margin:0 }}>{a.recommendation}</p>
        </div>
      )}
    </div>
  );
}

function AuditPrinciples({ prn }: { prn: any }) {
  const [sel, setSel] = useState<string|null>(null);
  const pkeys = Object.keys(prn);
  if (!pkeys.length) return <div style={{ color:"#94A3B8", fontSize:13, padding:"20px 0" }}>No principle data.</div>;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {pkeys.map(k => {
        const p = prn[k]; const s = p.score||0; const params = Object.entries(p.parameters||{});
        const isOpen = sel===k;
        return (
          <div key={k} style={{ background:"white", borderRadius:0, border:"1px solid #E3EAF3", overflow:"hidden" }}>
            <div onClick={()=>setSel(isOpen?null:k)} style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 18px", cursor:"pointer", background:isOpen?"#F8FAFF":"white" }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#0B1F33" }}>{k}</div>
                <div style={{ height:4, background:"#F1F5F9", borderRadius:0, marginTop:6, width:"100%" }}>
                  <div style={{ width:`${s}%`, height:"100%", borderRadius:0, background:sc(s), transition:"width 0.6s" }} />
                </div>
              </div>
              <div style={{ textAlign:"right", flexShrink:0 }}>
                <div style={{ fontSize:22, fontWeight:900, color:sc(s) }}>{s}</div>
                <div style={{ fontSize:9, fontWeight:700, color:sc(s), textTransform:"uppercase" }}>{band(s)}</div>
              </div>
              <div style={{ fontSize:14, color:"#94A3B8", transition:"transform 0.2s", transform:isOpen?"rotate(180deg)":"rotate(0)" }}>▾</div>
            </div>
            {isOpen && params.length>0 && (
              <div style={{ padding:"0 18px 16px", borderTop:"1px solid #F1F5F9" }}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:8, marginTop:12 }}>
                  {params.map(([param, val]:any) => (
                    <div key={param} style={{ padding:"10px 12px", borderRadius:0, background:sb(val), border:`1px solid ${sc(val)}18` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:"#0B1F33", marginBottom:4 }}>{param}</div>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ flex:1, height:3, background:"#E3EAF3", borderRadius:0 }}>
                          <div style={{ width:`${val}%`, height:"100%", borderRadius:0, background:sc(val) }} />
                        </div>
                        <span style={{ fontSize:13, fontWeight:800, color:sc(val), flexShrink:0 }}>{val}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AuditFindings({ findings }: { findings: any[] }) {
  if (!findings.length) return (
    <div style={{ padding:"20px 24px", background:"#F0FDF4", border:"1px solid #86EFAC", borderRadius:0, color:"#166534", fontWeight:600, fontSize:13 }}>
      ✓ No findings — this audit passed all checks.
    </div>
  );
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {findings.map((f,i) => {
        const sev = f.severity==="High"?"#DC2626":f.severity==="Medium"?"#D97706":"#059669";
        const sevBg = f.severity==="High"?"#FEF2F2":f.severity==="Medium"?"#FFFBEB":"#F0FDF4";
        return (
          <div key={i} style={{ background:"white", borderRadius:0, border:`1.5px solid ${sev}18`, overflow:"hidden" }}>
            <div style={{ padding:"10px 16px", background:sevBg, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:13, fontWeight:700, color:"#0B1F33" }}>{f.category}</span>
              <span style={{ fontSize:11, fontWeight:700, color:sev, background:"white", padding:"2px 10px", borderRadius:0, border:`1px solid ${sev}28` }}>{f.severity}</span>
            </div>
            <div style={{ padding:"12px 16px" }}>
              <p style={{ fontSize:13, color:"#1E293B", lineHeight:1.7, margin:"0 0 10px" }}>{f.issue}</p>
              <div style={{ padding:"10px 14px", borderRadius:0, background:"#EFF6FF", border:"1px solid #BFDBFE" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#005EB8", textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:4 }}>Recommendation</div>
                <p style={{ fontSize:12, color:"#1E40AF", lineHeight:1.65, margin:0 }}>{f.recommendation}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// SUB_PARAM_META mirror for admin panel — key formulas
const ADMIN_FORMULAS: Record<string,{formula:string;why:string}> = {
  "Schema Confidence":        { formula:"schema_confidence × 100", why:"A well-defined schema ensures data is consistently typed and interpretable." },
  "Field Documentation":      { formula:"clamp(io_bonus × 4 + schema_score × 0.2)", why:"Documented fields enable traceability of model decisions back to specific inputs." },
  "Data Completeness":        { formula:"(1 − missing_ratio) × 100", why:"Missing data reduces the statistical reliability of all downstream governance scores." },
  "Duplicate-Free Rate":      { formula:"clamp(100 − (duplicates / logs) × 500)", why:"Duplicate records inflate metrics and distort fairness assessments." },
  "Audit Log Volume":         { formula:"min(logs_evaluated / 100 × 100, 100)", why:"Sufficient log volume is required for statistically meaningful assessments." },
  "Timestamp Coverage":       { formula:"100 if timestamp/date detected, else 20", why:"Timestamps enable temporal auditing and drift detection." },
  "User Attribution":         { formula:"100 if user/session ID detected, else 25", why:"User attribution is required for accountability and GDPR requests." },
  "Safety Flagging":          { formula:"100 if safety/moderation fields detected, else 25", why:"Safety flags are the primary signal for detecting harmful outputs." },
  "PII Detection":            { formula:"100 if PII-related fields detected, else 20", why:"PII detection is a GDPR and data protection requirement." },
  "Harmful Content Rate":     { formula:"1 − (0.6 × toxicity_rate + 0.4 × keyword_rate) × 100", why:"Blends LLM judge verdict with text-level heuristics." },
  "Hallucination Containment":{ formula:"1 − (0.6 × hallucination_rate + 0.4 × heuristic_score) × 100", why:"A hallucinating AI is dangerous in medical, legal, or financial contexts." },
  "Safety Pass Rate":         { formula:"correct_responses / rows_judged (LLM Judge Panel)", why:"Three independent AI judges vote on each response." },
  "Response Consistency":     { formula:"Wasserstein(length_dist_A, length_dist_B) + TTR_consistency + format_consistency", why:"A reliable AI should behave the same way in similar situations." },
  "Demographic Tone Equity":  { formula:"1 − (w₁·|Sent_A−Sent_B| + w₂·JS(P_A,P_B) + w₃·|AvgLen_A−AvgLen_B|)", why:"Measures whether the AI responds with equal tone regardless of demographic group." },
  "Uncertainty Disclosure":   { formula:"0.7 × bell_curve(H, ideal_rate) + 0.3 × bonus_if_hedging_near_facts", why:"An AI that says 'I'm not sure' when it isn't is more trustworthy." },
  "Faithfulness Stability":   { formula:"faithfulness × provenance_penalty × 100", why:"Faithfulness = semantic similarity between summary and source document." },
};

function AuditFormulas({ prn, compNotes }: { prn:any; compNotes:any[]; a:any }) {
  const pkeys = Object.keys(prn);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

      {/* How scoring works — methodology */}
      <div style={{ background:"white", borderRadius:0, border:"1px solid #E3EAF3", padding:"20px 22px" }}>
        <div style={{ fontSize:13, fontWeight:800, color:"#0B1F33", marginBottom:12, display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:16 }}>⚙️</span> Audit Methodology
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          {[
            { step:"1", title:"Data Ingestion", desc:"CSV/log file is parsed. Schema confidence, column types, missing ratio, and duplicate rate are computed." },
            { step:"2", title:"Signal Extraction", desc:"Structural signals (io_bonus, schema_score, column_diversity) are derived from the dataset shape and column names." },
            { step:"3", title:"Sub-parameter Scoring", desc:"Each sub-parameter formula runs against the extracted signals. Scores are clamped to [0–100]." },
            { step:"4", title:"Principle Aggregation", desc:"Sub-parameter scores are averaged (weighted) to produce each of the 10 KPMG TAF principle scores." },
            { step:"5", title:"Overall Score", desc:"Weighted average of all principle scores. Risk level is derived: ≥75 = Low, ≥50 = Moderate, <50 = High." },
            { step:"6", title:"LLM Judge Panel", desc:"For accuracy/safety: Groq + OpenRouter + Together AI independently judge each input/output pair." },
          ].map(s => (
            <div key={s.step} style={{ display:"flex", gap:12, padding:"12px 14px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E3EAF3" }}>
              <div style={{ width:24, height:24, borderRadius:"50%", background:"#00338D", color:"white", display:"grid", placeItems:"center", fontSize:11, fontWeight:800, flexShrink:0 }}>{s.step}</div>
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:"#0B1F33", marginBottom:3 }}>{s.title}</div>
                <div style={{ fontSize:11, color:"#6B7C93", lineHeight:1.6 }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Per-principle sub-parameter formulas */}
      {pkeys.length>0 && (
        <div style={{ background:"white", borderRadius:0, border:"1px solid #E3EAF3", padding:"20px 22px" }}>
          <div style={{ fontSize:13, fontWeight:800, color:"#0B1F33", marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:16 }}>∑</span> Sub-parameter Formulas
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {pkeys.map(k => {
              const params = Object.entries(prn[k]?.parameters||{});
              return params.map(([param, val]:any) => {
                const f = ADMIN_FORMULAS[param];
                return (
                  <div key={`${k}-${param}`} style={{ padding:"12px 14px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E3EAF3" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, marginBottom:6 }}>
                      <div>
                        <span style={{ fontSize:11, fontWeight:700, color:"#7C3AED", background:"#EDE9FE", padding:"1px 7px", borderRadius:0, marginRight:8 }}>{k}</span>
                        <span style={{ fontSize:12, fontWeight:700, color:"#0B1F33" }}>{param}</span>
                      </div>
                      <span style={{ fontSize:13, fontWeight:900, color:sc(val), flexShrink:0 }}>{val}/100</span>
                    </div>
                    {f ? (
                      <>
                        <code>{f.formula}</code>
                        <p style={{ fontSize:11, color:"#6B7C93", lineHeight:1.6, margin:"6px 0 0" }}>{f.why}</p>
                      </>
                    ) : (
                      <div style={{ fontSize:11, color:"#94A3B8" }}>Formula derived from dataset signals at runtime.</div>
                    )}
                  </div>
                );
              });
            })}
          </div>
        </div>
      )}

      {/* Computation notes */}
      {compNotes.length>0 && (
        <div style={{ background:"white", borderRadius:0, border:"1px solid #E3EAF3", padding:"20px 22px" }}>
          <div style={{ fontSize:13, fontWeight:800, color:"#0B1F33", marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:16 }}>🔬</span> Metric Computation Log
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:8 }}>
            {compNotes.map(([key, note]:any) => {
              const ok = note.status==="computed";
              return (
                <div key={key} style={{ padding:"10px 12px", borderRadius:0, background:ok?"#F0FDF4":"#EFF6FF", border:`1px solid ${ok?"#86EFAC":"#BFDBFE"}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                    <span style={{ fontSize:11, fontWeight:700, color:"#0B1F33" }}>{key.replace(/_/g," ").replace(/\b\w/g,(c:string)=>c.toUpperCase())}</span>
                    <span style={{ fontSize:9, fontWeight:700, color:ok?"#059669":"#005EB8", background:"white", padding:"1px 6px", borderRadius:0 }}>{ok?"✓":"—"}</span>
                  </div>
                  <div style={{ fontSize:16, fontWeight:900, color:ok?"#059669":"#94A3B8" }}>{note.value!==null&&note.value!==undefined?Number(note.value).toFixed(3):"N/A"}</div>
                  {note.library && <div style={{ fontSize:9, color:"#94A3B8", marginTop:3 }}>{note.library}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AuditData({ a }: { a: any }) {
  const diag = a.diagnostics || {};
  const mm = a.model_metrics ? Object.entries(a.model_metrics).filter(([,m]:any)=>m.value!==null) : [];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* Diagnostics */}
      <div style={{ background:"white", borderRadius:0, border:"1px solid #E3EAF3", padding:"18px 20px" }}>
        <div style={{ fontSize:12, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12 }}>Dataset Diagnostics</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10 }}>
          {[
            { label:"Total Columns",   val:diag.total_columns??a.logs_evaluated??0 },
            { label:"Numeric Columns", val:diag.numeric_columns??"—" },
            { label:"Text Columns",    val:diag.text_columns??"—" },
            { label:"Missing Ratio",   val:diag.missing_ratio!=null?`${(diag.missing_ratio*100).toFixed(1)}%`:"—" },
            { label:"Duplicates",      val:diag.duplicates??0 },
            { label:"Schema Conf.",    val:diag.schema_confidence!=null?`${(diag.schema_confidence*100).toFixed(0)}%`:"—" },
          ].map(s => (
            <div key={s.label} style={{ padding:"10px 12px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E3EAF3" }}>
              <div style={{ fontSize:18, fontWeight:800, color:"#0B1F33" }}>{s.val}</div>
              <div style={{ fontSize:11, color:"#6B7C93", marginTop:3 }}>{s.label}</div>
            </div>
          ))}
        </div>
        {diag.column_names?.length>0 && (
          <div style={{ marginTop:12 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Detected Columns</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {diag.column_names.map((c:string) => (
                <code key={c}>{c}</code>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Model metrics */}
      {mm.length>0 && (
        <div style={{ background:"white", borderRadius:0, border:"1px solid #E3EAF3", padding:"18px 20px" }}>
          <div style={{ fontSize:12, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12 }}>Model-Specific Metrics</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:10 }}>
            {mm.map(([key, m]:any) => {
              const mc = m.risk_level==="Low"?"#059669":m.risk_level==="Moderate"?"#D97706":"#DC2626";
              return (
                <div key={key} style={{ padding:"12px 14px", borderRadius:0, background:sb(m.risk_level==="Low"?80:m.risk_level==="Moderate"?60:30), border:`1px solid ${mc}18` }}>
                  <div style={{ fontSize:11, color:"#6B7C93", textTransform:"uppercase", letterSpacing:"0.05em", fontWeight:600, marginBottom:4 }}>{key.replace(/_/g," ")}</div>
                  <div style={{ fontSize:20, fontWeight:800, color:mc }}>{m.unit==="ms"?`${Math.round(m.value)}ms`:m.value.toFixed(3)}</div>
                  <div style={{ fontSize:10, color:mc, marginTop:3, fontWeight:700 }}>{m.risk_level}</div>
                  {m.description && <div style={{ fontSize:10, color:"#94A3B8", marginTop:4, lineHeight:1.5 }}>{m.description}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* LLM Judge */}
      {a.llm_judge && (
        <div style={{ background:"white", borderRadius:0, border:"1px solid #E3EAF3", padding:"18px 20px" }}>
          <div style={{ fontSize:12, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12 }}>LLM Judge Results</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:10 }}>
            {[
              { label:"Accuracy",    val:a.llm_judge.accuracy!=null?`${Math.round(a.llm_judge.accuracy*100)}%`:"—" },
              { label:"Rows Judged", val:a.llm_judge.rows_judged??0 },
              { label:"Correct",     val:a.llm_judge.correct??0 },
              { label:"Model",       val:a.llm_judge.model||"—" },
            ].map(s => (
              <div key={s.label} style={{ padding:"10px 12px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E3EAF3" }}>
                <div style={{ fontSize:18, fontWeight:800, color:"#0B1F33" }}>{s.val}</div>
                <div style={{ fontSize:11, color:"#6B7C93", marginTop:3 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}