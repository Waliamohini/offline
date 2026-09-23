export default function Report() {
  const location = useLocation();
  const navigate = useNavigate();
  const raw = location.state?.data;

  const r: ReportData = (() => {
    if (!raw) return null as any;
    if (raw.report_id || raw.trusted_ai_principles) return raw as ReportData;
    const catScores: Record<string, number> = raw.category_scores || {};
    const trusted_ai_principles: Record<string, { score: number; parameters: Record<string, number> }> = {};
    for (const [cat, score] of Object.entries(catScores)) {
      trusted_ai_principles[cat] = { score: score as number, parameters: { Score: score as number } };
    }
    const findings = (raw.findings || []).map((f: any) => ({
      category: f.category || "Unknown", severity: f.severity || "Medium",
      issue: f.issue || f.note || "See probe response", recommendation: f.recommendation || "Review model behaviour",
    }));
    const s = raw.overall_score || 0;
    const complianceStatus = s >= 75 ? "Compliant" : s >= 50 ? "Conditional" : "Partial";
    return {
      report_id: raw.audit_id || "N/A", ai_name: raw.ai_name || "External AI",
      model_type: raw.mode ? `BlackBox (${raw.mode.toUpperCase()})` : "BlackBox",
      evaluated_at: raw.completed_at || raw.created_at || new Date().toISOString(),
      overall_score: raw.overall_score || 0, risk_level: raw.risk_level || "Unknown",
      structural_risk: raw.risk_level || "Unknown", logs_evaluated: raw.probes_run || 0,
      data_quality_score: raw.overall_score || 0, trusted_ai_principles,
      diagnostics: { missing_ratio: 0, duplicates: 0, schema_confidence: 1, total_columns: 0, text_columns: 0, numeric_columns: 0, column_names: [] },
      findings, recommendation: "",
      framework_compliance: { EU_AI_Act: complianceStatus, ISO_42001: complianceStatus, NIST_AI_RMF: complianceStatus, KPMG_TAF: complianceStatus },
      probe_results: raw.probe_results || [],
    } as ReportData;
  })();

  const [activeTab, setActiveTab] = useState<"overview"|"principles"|"findings"|"data"|"accuracy"|"probes">("overview");
  const [sel, setSel] = useState<string | null>(null);
  const [hoveredParam, setHoveredParam] = useState<string | null>(null);
  const [anim, setAnim] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => { setTimeout(() => setAnim(true), 150); }, []);
  useEffect(() => { setHoveredParam(null); }, [sel]);

  if (!r) {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100vh", background:"#F4F7FB", gap:20 }}>
        <p style={{ color:"#64748B", fontSize:18 }}>No report data found.</p>
        <button style={{ padding:"14px 32px", background:"white", border:"1px solid #E2E8F0", color:"#374151", borderRadius:0, cursor:"pointer", fontSize:15, fontWeight:600 }} onClick={() => navigate("/dashboard")}>Back to Dashboard</button>
      </div>
    );
  }

  const prn = r.trusted_ai_principles || {};
  const pkeys = Object.keys(prn);
  const hasPrn = pkeys.length > 0;
  const rc = r.risk_level === "Low" ? "#059669" : r.risk_level === "Moderate" ? KPMG_MID : "#DC2626";
  const rcBg = r.risk_level === "Low" ? "#DCFCE7" : r.risk_level === "Moderate" ? "#E6F2FB" : "#FEE2E2";
  const fmt = (d: string) => new Date(d).toLocaleString("en-GB", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
  const selData = sel ? prn[sel] : null;
  const selectedEntries = selData ? Object.entries(selData.parameters || {}) : [];
  const activeParam = hoveredParam && selData?.parameters?.[hoveredParam] !== undefined ? hoveredParam : (selData ? Object.keys(selData.parameters || {})[0] || null : null);
  const activeInsight = activeParam ? getParameterInsight(activeParam, r, selData) : null;
  const strongestParam = selectedEntries.length ? selectedEntries.reduce((best, e) => ((e[1] as number) > (best[1] as number) ? e : best)) : null;
  const weakestParam = selectedEntries.length ? selectedEntries.reduce((worst, e) => ((e[1] as number) < (worst[1] as number) ? e : worst)) : null;
  const toolRecommendation = generateToolRecommendation(r);

  const fade = (delay: number): React.CSSProperties => ({
    opacity: anim ? 1 : 0, transform: anim ? "translateY(0)" : "translateY(16px)",
    transition: `all 0.6s cubic-bezier(0.22,1,0.36,1) ${delay}s`,
  });

  const handleDownloadPDF = async () => {
    setPdfLoading(true);
    try {
      const token = localStorage.getItem("token");
      if (!token) { alert("You need to be logged in to download reports."); navigate("/login"); return; }
      if (!r.report_id) { alert("No report ID found."); return; }
      const response = await fetch(`http://localhost:8000/reports/${r.report_id}/pdf`, {
        method: "GET", headers: { "Authorization": `Bearer ${token}`, "Accept": "application/pdf" },
      });
      if (!response.ok) {
        let errorDetail = "Unknown error";
        try { const errJson = await response.json(); errorDetail = errJson.detail || errorDetail; } catch {}
        throw new Error(`Download failed: ${response.status} - ${errorDetail}`);
      }
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `Audit_Report_${r.report_id || "Unknown"}_${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(link); link.click(); link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err: any) { alert(err.message || "Failed to download PDF."); }
    finally { setPdfLoading(false); }
  };

  const TABS = [
    { id: "overview",   label: "Overview" },
    { id: "principles", label: "Principles" },
    { id: "findings",   label: "Findings",    badge: r.findings?.length || 0 },
    { id: "data",       label: "Data & Metrics" },
    { id: "accuracy",   label: "Accuracy" },
    { id: "probes",     label: "Probes",      badge: (r.probe_results || []).length },
  ] as const;

  return (
    <div style={{ minHeight:"100vh", background:"#F4F7FB", fontFamily:"'Plus Jakarta Sans','Inter',system-ui,sans-serif", color:"#0B1F33" }}>
      <style>{`
        * { box-sizing:border-box; margin:0; padding:0; }
        .rpt-card { background:white; border-radius: 0px; border:1px solid #E3EAF3; box-shadow:0 2px 12px rgba(0,51,141,0.05); }
        .rpt-hover { transition:transform 0.22s cubic-bezier(.16,1,.3,1),box-shadow 0.22s; }
        .rpt-hover:hover { transform:translateY(-3px); box-shadow:0 8px 28px rgba(0,51,141,0.10) !important; }
        .rpt-tab { border:none; cursor:pointer; font-family:inherit; transition:all 0.18s; white-space:nowrap; }
        .rpt-tab:hover { background:#EEF4FF !important; color:#005EB8 !important; }
        .param-row { transition:all 0.18s ease; }
        .param-row:hover { background:rgba(0,94,184,0.04) !important; border-color:rgba(0,94,184,0.22) !important; }
      `}</style>

      {/* NAV */}
      <div style={{ background:"white", borderBottom:"1px solid #E3EAF3", padding:"0 40px", display:"flex", alignItems:"center", justifyContent:"space-between", height:64, boxShadow:"0 1px 8px rgba(0,51,141,0.06)", position:"sticky", top:0, zIndex:200 }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <span style={{ fontSize:17, fontWeight:900, letterSpacing:"-0.03em", background:`linear-gradient(135deg,${KPMG_BLUE},${KPMG_MID})`, WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>TrustShield AI</span>
          <div style={{ width:1, height:18, background:"#E3EAF3" }} />
          <span style={{ fontSize:11, fontWeight:700, padding:"3px 10px", background:"#E6F2FB", color:KPMG_MID, borderRadius:0, border:`1px solid ${KPMG_MID}30`, letterSpacing:"0.05em", textTransform:"uppercase" }}>Governance Report</span>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <button onClick={handleDownloadPDF} disabled={pdfLoading}
            style={{ padding:"8px 20px", background:pdfLoading?"#F1F5F9":`linear-gradient(135deg,${KPMG_BLUE},${KPMG_MID})`, border:"none", borderRadius:0, color:pdfLoading?KPMG_MID:"white", cursor:pdfLoading?"not-allowed":"pointer", fontSize:13, fontWeight:700, letterSpacing:"0.01em", boxShadow:pdfLoading?"none":`0 4px 14px ${KPMG_BLUE}28` }}>
            {pdfLoading ? "Generating..." : "Download PDF"}
          </button>
          <button style={{ padding:"8px 20px", background:"white", border:"1px solid #E3EAF3", color:"#6B7C93", borderRadius:0, cursor:"pointer", fontSize:13, fontWeight:600 }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor=KPMG_MID; (e.currentTarget as HTMLButtonElement).style.color=KPMG_MID; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor="#E3EAF3"; (e.currentTarget as HTMLButtonElement).style.color="#6B7C93"; }}
            onClick={() => navigate("/dashboard")}>Back to Dashboard</button>
        </div>
      </div>

      {/* HERO */}
      <div style={{ background:`linear-gradient(135deg,${KPMG_BLUE} 0%,${KPMG_MID} 100%)`, padding:"36px 40px 0", ...fade(0) }}>
        <div style={{ maxWidth:1280, margin:"0 auto" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:24, paddingBottom:28 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"rgba(255,255,255,0.5)", marginBottom:10 }}>KPMG Trusted AI Framework — Governance Audit</div>
              <h1 style={{ fontSize:30, fontWeight:900, letterSpacing:"-0.02em", color:"white", marginBottom:12, lineHeight:1.1 }}>{r.ai_name}</h1>
              <div style={{ display:"flex", gap:20, flexWrap:"wrap", fontSize:13, color:"rgba(255,255,255,0.65)" }}>
                <span>{r.model_label || r.model_type}</span>
                <span style={{ opacity:0.4 }}>|</span>
                <span>{fmt(r.evaluated_at)}</span>
                <span style={{ opacity:0.4 }}>|</span>
                <span>ID: {r.report_id?.slice(0,14)}...</span>
              </div>
            </div>
            <div style={{ textAlign:"center", background:"rgba(255,255,255,0.1)", borderRadius:0, padding:"18px 28px", backdropFilter:"blur(8px)", border:"1px solid rgba(255,255,255,0.12)" }}>
              <div style={{ fontSize:56, fontWeight:900, lineHeight:1, color:"white", letterSpacing:"-0.04em" }}>{r.overall_score}</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2, letterSpacing:"0.08em", textTransform:"uppercase" }}>/ 100 Overall</div>
              <div style={{ marginTop:10, display:"inline-block", padding:"5px 16px", borderRadius:0, fontSize:12, fontWeight:700, background:rcBg, color:rc, border:`1px solid ${rc}40` }}>{r.risk_level} Risk</div>
            </div>
          </div>
          {/* TAB BAR */}
          <div style={{ display:"flex", gap:2, overflowX:"auto" }}>
            {TABS.map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button key={tab.id} className="rpt-tab"
                  onClick={() => { setActiveTab(tab.id as any); setSel(null); }}
                  style={{ padding:"12px 22px", borderRadius:"10px 10px 0 0", fontSize:13, fontWeight:isActive?700:500, color:isActive?KPMG_BLUE:"rgba(255,255,255,0.72)", background:isActive?"white":"transparent", display:"flex", alignItems:"center", gap:8, flexShrink:0, letterSpacing:"0.01em" }}>
                  {tab.label}
                  {"badge" in tab && (tab as any).badge > 0 && (
                    <span style={{ fontSize:10, fontWeight:800, padding:"1px 7px", borderRadius:0, background:isActive?"#FEE2E2":"rgba(255,255,255,0.18)", color:isActive?"#DC2626":"white", minWidth:18, textAlign:"center" }}>
                      {(tab as any).badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* TAB CONTENT */}
      <div style={{ maxWidth:1280, margin:"0 auto", padding:"28px 40px 80px" }}>

        {/* OVERVIEW */}
        {activeTab === "overview" && (
          <div style={{ display:"flex", flexDirection:"column", gap:22, ...fade(0) }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:14 }}>
              {[
                { label:"Logs Evaluated", val:r.logs_evaluated, color:KPMG_MID },
                { label:"Data Quality", val:`${r.data_quality_score}%`, color:"#059669" },
                { label:"Structural Risk", val:r.structural_risk, color:r.structural_risk==="Low"?"#059669":r.structural_risk==="Moderate"?KPMG_MID:"#DC2626" },
                { label:"Principles", val:pkeys.length, color:KPMG_BLUE },
                { label:"Findings", val:r.findings?.length||0, color:(r.findings?.length||0)>0?"#DC2626":"#059669" },
                ...(r.llm_judge?.accuracy!=null?[{ label:"Response Accuracy", val:`${Math.round(r.llm_judge.accuracy*100)}%`, color:Math.round(r.llm_judge.accuracy*100)>=80?"#059669":KPMG_MID }]:[]),
              ].map((s,i) => (
                <div key={i} className="rpt-card rpt-hover" style={{ padding:"20px 18px", textAlign:"center" }}>
                  <div style={{ fontSize:28, fontWeight:900, color:s.color, lineHeight:1, marginBottom:8 }}>{s.val}</div>
                  <div style={{ fontSize:11, color:"#6B7C93", fontWeight:600, letterSpacing:"0.03em" }}>{s.label}</div>
                </div>
              ))}
            </div>
            {/* AI Registration Profile */}
            <div className="rpt-card" style={{ padding:"28px 32px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
                <div style={{ width:36, height:36, borderRadius:0, background:"#EFF6FF", display:"grid", placeItems:"center", color:KPMG_MID }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                </div>
                <div>
                  <h2 style={{ fontSize:17, fontWeight:800, color:"#0B1F33" }}>Registered AI Profile</h2>
                  <p style={{ fontSize:12, color:"#94A3B8", marginTop:2 }}>System identity and registration context used for this audit</p>
                </div>
              </div>
              {/* Profile data grid — show identity + any richer context that came through on raw */}
              {(() => {
                const profileItems: { label: string; val: string }[] = [
                  { label:"AI Name",         val: r.ai_name || "—" },
                  { label:"Model Type",      val: r.model_label || r.model_type || "—" },
                  { label:"Domain",          val: (raw as any)?.domain || "—" },
                  { label:"Description",     val: ((raw as any)?.description || "").slice(0,120) || "—" },
                  { label:"Report ID",       val: (r.report_id || "").slice(0,20) || "—" },
                  { label:"Evaluated At",    val: fmt(r.evaluated_at) },
                  ...(r.detection_confidence ? [{ label:"Detection Confidence", val: `${Math.round(r.detection_confidence*100)}%` }] : []),
                ].filter(p => p.val && p.val !== "—");
                return (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))", gap:14 }}>
                    {profileItems.map((item, i) => (
                      <div key={i} style={{ padding:"14px 16px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E3EAF3", display:"flex", flexDirection:"column", gap:4 }}>
                        <div style={{ fontSize:10, fontWeight:700, color:"#94A3B8", letterSpacing:"0.06em", textTransform:"uppercase" }}>{item.label}</div>
                        <div style={{ fontSize:14, fontWeight:700, color:"#0B1F33", lineHeight:1.3, wordBreak:"break-all" }}>{item.val}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {r.column_warnings && r.column_warnings.length > 0 && (
              <div style={{ padding:"14px 20px", borderRadius:0, background:"#EFF6FF", border:`1px solid ${KPMG_MID}30`, display:"flex", flexDirection:"column", gap:6 }}>
                {r.column_warnings.map((w,i) => (
                  <div key={i} style={{ display:"flex", gap:10, fontSize:13, color:KPMG_BLUE, lineHeight:1.5 }}>
                    <span style={{ fontWeight:700, flexShrink:0, fontSize:11, letterSpacing:"0.04em", textTransform:"uppercase", paddingTop:1 }}>Note</span>
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="rpt-card" style={{ padding:"28px 32px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:22 }}>
                <div style={{ width:36, height:36, borderRadius:0, background:"#EFF6FF", display:"grid", placeItems:"center", color:KPMG_MID }}><SvgBuilding /></div>
                <div>
                  <h2 style={{ fontSize:17, fontWeight:800, color:"#0B1F33" }}>Regulatory &amp; Framework Alignment</h2>
                  <p style={{ fontSize:12, color:"#94A3B8", marginTop:2 }}>Alignment with major AI governance standards based on overall audit score</p>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:14 }}>
                {Object.entries(r.framework_compliance||{}).map(([key,status]) => {
                  const fw = FW[key]||{ label:key, icon:SvgComply, desc:"" };
                  const { label:alLabel, color:alColor } = alignmentLabel(status as string, r.overall_score);
                  const alBg = alColor==="#059669"?"#F0FDF4":alColor===KPMG_MID?"#EFF6FF":"#FEF2F2";
                  const FwIcon = fw.icon;
                  const FW_FOCUS: Record<string,string> = { EU_AI_Act:"Risk classification, human oversight & prohibited practices", ISO_42001:"AI management system requirements & continual improvement", NIST_AI_RMF:"Govern, Map, Measure & Manage across the AI lifecycle", KPMG_TAF:"10-principle assessment across all governance dimensions" };
                  return (
                    <div key={key} className="rpt-hover" style={{ padding:"20px", borderRadius:0, background:alBg, border:`1.5px solid ${alColor}22`, textAlign:"center" }}>
                      <div style={{ display:"flex", justifyContent:"center", marginBottom:10, color:alColor }}><FwIcon /></div>
                      <div style={{ fontWeight:800, fontSize:14, color:"#0B1F33", marginBottom:4 }}>{fw.label}</div>
                      <div style={{ fontSize:10, color:"#6B7C93", marginBottom:12, lineHeight:1.5 }}>{FW_FOCUS[key]||fw.desc}</div>
                      <div style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"5px 14px", borderRadius:0, fontSize:12, fontWeight:700, color:alColor, background:"white", border:`1.5px solid ${alColor}35` }}>
                        <span style={{ width:6, height:6, borderRadius:"50%", background:alColor, flexShrink:0 }} />{alLabel}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {(r.recommendation||toolRecommendation) && (
              <div className="rpt-card" style={{ padding:"28px 32px" }}>
                <h2 style={{ fontSize:17, fontWeight:800, color:"#0B1F33", marginBottom:16 }}>Overall Recommendation</h2>
                <div style={{ padding:"18px 22px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E3EAF3", borderLeft:`4px solid ${KPMG_MID}` }}>
                  <p style={{ fontSize:14, color:"#1E293B", lineHeight:1.8 }}>{r.recommendation||toolRecommendation}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* PRINCIPLES */}
        {activeTab === "principles" && (
          <div style={{ display:"flex", flexDirection:"column", gap:22, ...fade(0) }}>
            {hasPrn ? (
              <>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14 }}>
                  {[
                    { label:"Avg. Principle Score", value:`${Math.round(Object.values(prn).reduce((s,v)=>s+v.score,0)/Math.max(pkeys.length,1))}`, color:KPMG_MID },
                    { label:"Strong Principles", value:`${Object.values(prn).filter(v=>v.score>=75).length} / ${pkeys.length}`, color:"#059669" },
                    { label:"Needs Attention", value:`${Object.values(prn).filter(v=>v.score<60).length}`, color:"#DC2626" },
                  ].map(item => (
                    <div key={item.label} className="rpt-card" style={{ padding:"20px 22px", borderLeft:`4px solid ${item.color}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:item.color, letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:8 }}>{item.label}</div>
                      <div style={{ fontSize:32, fontWeight:900, color:item.color }}>{item.value}</div>
                    </div>
                  ))}
                </div>
                <div className="rpt-card" style={{ padding:"28px 32px" }}>
                  <h2 style={{ fontSize:17, fontWeight:800, color:"#0B1F33", marginBottom:4 }}>Principle Radar</h2>
                  <p style={{ fontSize:12, color:"#94A3B8", marginBottom:20 }}>Click any principle to drill into sub-parameters</p>
                  <div style={{ width:"100%", maxWidth:680, margin:"0 auto" }}><Spider principles={prn} onSelect={setSel} selected={sel} /></div>
                </div>
                <div className="rpt-card" style={{ padding:"28px 32px" }}>
                  <h2 style={{ fontSize:17, fontWeight:800, color:"#0B1F33", marginBottom:4 }}>Score Distribution</h2>
                  <p style={{ fontSize:12, color:"#94A3B8", marginBottom:4 }}>Green 75+ &nbsp;·&nbsp; Amber 50–74 &nbsp;·&nbsp; Red below 50</p>
                  <ImprovedBarChart principles={prn} />
                </div>
                <div className="rpt-card" style={{ padding:"28px 32px" }}>
                  {!sel ? (
                    <>
                      <h2 style={{ fontSize:17, fontWeight:800, color:"#0B1F33", marginBottom:4 }}>All Principles</h2>
                      <p style={{ fontSize:12, color:"#94A3B8", marginBottom:20 }}>Click any card to inspect sub-parameters</p>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:12 }}>
                        {pkeys.map(k => {
                          const c = COLORS[k]||KPMG_MID; const sc = prn[k].score; const IC = ICONS[k];
                          return (
                            <div key={k} className="rpt-hover" onClick={() => setSel(k)}
                              style={{ display:"flex", alignItems:"center", gap:12, padding:"16px", borderRadius:0, background:"white", border:"1.5px solid #E3EAF3", cursor:"pointer", borderTop:`3px solid ${c}` }}>
                              <div style={{ width:40, height:40, borderRadius:0, flexShrink:0, background:`${c}10`, border:`1px solid ${c}22`, display:"grid", placeItems:"center", color:c }}>{IC?<IC />:<SvgClip />}</div>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:13, fontWeight:700, color:"#0B1F33", marginBottom:6 }}>{k}</div>
                                <div style={{ height:4, background:"#F1F5F9", borderRadius:0 }}>
                                  <div style={{ width:`${sc}%`, height:"100%", background:bandColor(sc), borderRadius:0, transition:"width 0.8s ease" }} />
                                </div>
                              </div>
                              <div style={{ textAlign:"right", flexShrink:0 }}>
                                <div style={{ fontSize:22, fontWeight:900, color:bandColor(sc), lineHeight:1 }}>{sc}</div>
                                <div style={{ fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:0, background:bandBg(sc), color:bandColor(sc), marginTop:4, textTransform:"uppercase", letterSpacing:"0.04em" }}>{band(sc)}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : selData ? (
                    <div>
                      <button onClick={() => setSel(null)} style={{ marginBottom:20, padding:"8px 16px", background:"#EFF6FF", border:`1px solid ${KPMG_MID}30`, color:KPMG_MID, borderRadius:0, cursor:"pointer", fontSize:13, fontWeight:700 }}>All Principles</button>
                      <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20, padding:"20px 22px", borderRadius:0, background:`linear-gradient(135deg,${(COLORS[sel]||KPMG_MID)}08,${(COLORS[sel]||KPMG_MID)}03)`, border:`1.5px solid ${(COLORS[sel]||KPMG_MID)}22` }}>
                        <div style={{ width:50, height:50, borderRadius:0, flexShrink:0, display:"grid", placeItems:"center", background:`${COLORS[sel]||KPMG_MID}12`, border:`1px solid ${(COLORS[sel]||KPMG_MID)}22` }}>{(()=>{ const IC=ICONS[sel]; return IC?<IC />:<SvgClip />; })()}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:20, fontWeight:800, color:"#0B1F33" }}>{sel}</div>
                          {selData.description && <div style={{ fontSize:12, color:"#6B7C93", marginTop:3, lineHeight:1.5 }}>{selData.description}</div>}
                          {PRINCIPLE_CONTEXT[sel] && <div style={{ fontSize:13, color:"#374151", marginTop:8, lineHeight:1.7 }}>{PRINCIPLE_CONTEXT[sel].definition}</div>}
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontSize:44, fontWeight:900, color:COLORS[sel]||KPMG_MID, lineHeight:1 }}>{selData.score}</div>
                          <div style={{ fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:0, background:bandBg(selData.score), color:bandColor(selData.score), marginTop:6, textTransform:"uppercase", letterSpacing:"0.04em" }}>{band(selData.score)}</div>
                        </div>
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 }}>
                        {[
                          { label:"Strongest sub-parameter", val:strongestParam?.[0]||"—", score:strongestParam?.[1]??0, color:"#059669", bg:"#F0FDF4" },
                          { label:"Weakest sub-parameter", val:weakestParam?.[0]||"—", score:weakestParam?.[1]??0, color:"#DC2626", bg:"#FEF2F2" },
                        ].map(s => (
                          <div key={s.label} style={{ padding:"14px 16px", borderRadius:0, background:s.bg, border:`1px solid ${s.color}18` }}>
                            <div style={{ fontSize:10, color:s.color, textTransform:"uppercase", letterSpacing:"0.07em", fontWeight:700, marginBottom:6 }}>{s.label}</div>
                            <div style={{ fontSize:14, fontWeight:800, color:s.color, lineHeight:1.3 }}>{s.val}</div>
                            {typeof s.score==="number" && <div style={{ fontSize:12, color:s.color, marginTop:3, fontWeight:700 }}>{s.score} / 100</div>}
                          </div>
                        ))}
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, alignItems:"start" }}>
                        <div>
                          <div style={{ fontSize:11, fontWeight:700, color:KPMG_MID, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12, padding:"8px 12px", background:"#EFF6FF", borderRadius:0 }}>Sub-parameters — hover to inspect</div>
                          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                            {Object.entries(selData.parameters).map(([param,val]) => {
                              const v = val as number; const c = COLORS[sel]||KPMG_MID; const sc2 = bandColor(v); const isActive = activeParam===param; const meta = SUB_PARAM_META[param];
                              return (
                                <div key={param} className="param-row"
                                  style={{ padding:"14px 16px", borderRadius:0, background:isActive?`${c}05`:"#F8FAFC", border:isActive?`2px solid ${c}35`:"1.5px solid #E3EAF3", cursor:"pointer" }}
                                  onMouseEnter={() => setHoveredParam(param)} onMouseLeave={() => setHoveredParam(null)}>
                                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                                    <div style={{ flex:1, marginRight:8 }}>
                                      <div style={{ fontSize:13, fontWeight:isActive?700:600, color:isActive?"#0B1F33":"#374151", lineHeight:1.3 }}>{param}</div>
                                      {meta && <div style={{ fontSize:11, color:"#94A3B8", marginTop:3, lineHeight:1.4 }}>{meta.what}</div>}
                                    </div>
                                    <div style={{ textAlign:"right", flexShrink:0 }}>
                                      <div style={{ fontSize:20, fontWeight:900, color:sc2 }}>{v}</div>
                                      <div style={{ fontSize:9, fontWeight:700, padding:"1px 6px", borderRadius:0, background:bandBg(v), color:sc2, textTransform:"uppercase", letterSpacing:"0.04em" }}>{band(v)}</div>
                                    </div>
                                  </div>
                                  <div style={{ height:4, background:"#E3EAF3", borderRadius:0 }}>
                                    <div style={{ width:`${v}%`, height:"100%", borderRadius:0, background:`linear-gradient(90deg,${c},${sc2})`, transition:"width 0.5s ease" }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div style={{ position:"sticky", top:80, padding:"24px", borderRadius:0, background:"white", border:`2px solid ${(COLORS[sel]||KPMG_MID)}15`, minHeight:280, boxShadow:"0 4px 24px rgba(0,51,141,0.06)" }}>
                          {activeParam && activeInsight ? (
                            <>
                              <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:18, paddingBottom:16, borderBottom:"1px solid #F1F5F9" }}>
                                <Radial score={selData.parameters[activeParam] as number} label="" color={COLORS[sel]||KPMG_MID} size={72} />
                                <div style={{ flex:1 }}>
                                  <div style={{ fontSize:15, fontWeight:800, color:"#0B1F33", lineHeight:1.3, marginBottom:5 }}>{activeParam}</div>
                                  <div style={{ display:"inline-flex", alignItems:"center", fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:0, color:bandColor(selData.parameters[activeParam] as number), background:bandBg(selData.parameters[activeParam] as number), textTransform:"uppercase", letterSpacing:"0.04em" }}>{band(selData.parameters[activeParam] as number)} posture</div>
                                </div>
                              </div>
                              <div style={{ marginBottom:12, padding:"12px 14px", borderRadius:0, background:bandBg(selData.parameters[activeParam] as number), border:`1px solid ${bandColor(selData.parameters[activeParam] as number)}15` }}>
                                <div style={{ fontSize:10, fontWeight:700, color:bandColor(selData.parameters[activeParam] as number), textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>What this means</div>
                                <div style={{ fontSize:13, lineHeight:1.7, color:"#1E293B" }}>{activeInsight.detail}</div>
                              </div>
                              {(()=>{ const meta=SUB_PARAM_META[activeParam]; const formulaText=meta?.formula||activeInsight.formula; const whyText=meta?.why; if(!formulaText) return null; return (
                                <div style={{ marginBottom:12, borderRadius:0, overflow:"hidden", border:"1px solid #E3EAF3" }}>
                                  <div style={{ padding:"8px 14px", background:"#EFF6FF" }}>
                                    <span style={{ fontSize:11, fontWeight:700, color:KPMG_MID, textTransform:"uppercase" as const, letterSpacing:"0.07em" }}>How this is calculated</span>
                                  </div>
                                  <div style={{ padding:"12px 14px", background:"white" }}>
                                    <div style={{ padding:"8px 12px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E3EAF3", fontSize:12, color:"#1E293B", lineHeight:1.7 }}>{formulaText}</div>
                                    {whyText && <p style={{ margin:"8px 0 0", fontSize:11, color:"#6B7C93", lineHeight:1.6 }}>{whyText}</p>}
                                  </div>
                                </div>
                              ); })()}
                              {(selData.parameters[activeParam] as number)<60 && (
                                <div style={{ padding:"10px 14px", borderRadius:0, background:"#FEF2F2", border:"1px solid #FECACA" }}>
                                  <div style={{ fontSize:10, fontWeight:700, color:"#DC2626", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Low Score Alert</div>
                                  <div style={{ fontSize:11, lineHeight:1.6, color:"#7F1D1D" }}>{(selData.parameters[activeParam] as number)<30?`${activeParam} is critically low. Add the relevant data column to your logs.`:`${activeParam} is below threshold. Enriching your dataset logs will improve this score.`}</div>
                                </div>
                              )}
                            </>
                          ) : (
                            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", minHeight:240, gap:12 }}>
                              <div style={{ width:32, height:32, borderRadius:"50%", border:"2px solid #E3EAF3", display:"grid", placeItems:"center" }}>
                                <div style={{ width:10, height:10, borderRadius:"50%", background:"#E3EAF3" }} />
                              </div>
                              <div style={{ fontSize:13, color:"#94A3B8", textAlign:"center", lineHeight:1.6 }}>Hover a sub-parameter<br/>to see how it is scored</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : <div className="rpt-card" style={{ padding:"48px", textAlign:"center", color:"#94A3B8" }}>No principle data available.</div>}
          </div>
        )}

        {/* FINDINGS */}
        {activeTab === "findings" && (
          <div style={{ display:"flex", flexDirection:"column", gap:22, ...fade(0) }}>
            {(r.findings?.length||0)>0 && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14 }}>
                {[
                  { label:"High Severity", count:r.findings.filter(f=>f.severity==="High").length, color:"#DC2626" },
                  { label:"Medium Severity", count:r.findings.filter(f=>f.severity==="Medium").length, color:"#D97706" },
                  { label:"Low Severity", count:r.findings.filter(f=>f.severity==="Low").length, color:"#059669" },
                  { label:"Total Findings", count:r.findings.length, color:KPMG_BLUE },
                ].map(s => (
                  <div key={s.label} className="rpt-card" style={{ padding:"18px", textAlign:"center", borderTop:`3px solid ${s.color}` }}>
                    <div style={{ fontSize:32, fontWeight:900, color:s.color, lineHeight:1 }}>{s.count}</div>
                    <div style={{ fontSize:11, color:"#6B7C93", fontWeight:600, marginTop:6, letterSpacing:"0.03em" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="rpt-card" style={{ padding:"28px 32px" }}>
              <h2 style={{ fontSize:17, fontWeight:800, color:"#0B1F33", marginBottom:4 }}>Audit Findings</h2>
              <p style={{ fontSize:12, color:"#94A3B8", marginBottom:22 }}>Identified issues with targeted remediation recommendations</p>
              {!r.findings?.length ? (
                <div style={{ padding:"20px 24px", background:"#F0FDF4", border:"1px solid #86EFAC", borderRadius:0, color:"#166534", fontWeight:600, display:"flex", alignItems:"center", gap:10 }}>
                  <SvgCheck /><span>No findings. Dataset aligns well with Trusted AI standards.</span>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  {r.findings.map((f,i) => {
                    const sc = f.severity==="High"?"#DC2626":f.severity==="Medium"?"#D97706":"#059669";
                    const scBg = f.severity==="High"?"#FEF2F2":f.severity==="Medium"?"#FFFBEB":"#F0FDF4";
                    return (
                      <div key={i} style={{ borderRadius:0, background:"white", border:`1.5px solid ${sc}18`, overflow:"hidden" }}>
                        <div style={{ padding:"12px 20px", background:scBg, borderBottom:`1px solid ${sc}15`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <span style={{ color:COLORS[f.category]||KPMG_MID }}>{(()=>{ const IC=ICONS[f.category]; return IC?<IC />:<SvgAlert />; })()}</span>
                            <span style={{ fontWeight:700, fontSize:14, color:"#0B1F33" }}>{f.category}</span>
                            {f.type && <span style={{ fontSize:11, color:"#94A3B8", background:"white", padding:"2px 8px", borderRadius:0, border:"1px solid #E3EAF3" }}>{f.type}</span>}
                          </div>
                          <span style={{ color:sc, fontWeight:700, background:"white", padding:"4px 14px", borderRadius:0, fontSize:12, border:`1px solid ${sc}28` }}>{f.severity}</span>
                        </div>
                        <div style={{ padding:"16px 20px" }}>
                          <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Issue Identified</div>
                          <p style={{ margin:"0 0 14px", color:"#1E293B", lineHeight:1.7, fontSize:14 }}>{f.issue}</p>
                          <div style={{ padding:"12px 16px", borderRadius:0, background:"#EFF6FF", border:`1px solid ${KPMG_MID}25` }}>
                            <div style={{ fontSize:11, fontWeight:700, color:KPMG_MID, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:5 }}>Recommended Action</div>
                            <p style={{ margin:0, color:KPMG_BLUE, lineHeight:1.65, fontSize:13 }}>{f.recommendation}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {(r.recommendation||toolRecommendation) && (
              <div className="rpt-card" style={{ padding:"28px 32px" }}>
                <h2 style={{ fontSize:17, fontWeight:800, color:"#0B1F33", marginBottom:16 }}>Overall Recommendation</h2>
                <div style={{ padding:"18px 22px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E3EAF3", borderLeft:`4px solid ${KPMG_MID}` }}>
                  <p style={{ fontSize:14, color:"#1E293B", lineHeight:1.8 }}>{r.recommendation||toolRecommendation}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* DATA & METRICS */}
        {activeTab === "data" && (
          <div style={{ display:"flex", flexDirection:"column", gap:22, ...fade(0) }}>
            <DataStructuralIntegritySection report={r} />
            {r.model_metrics && Object.values(r.model_metrics).some(m=>m.value!==null) && (
              <div className="rpt-card" style={{ padding:"28px 32px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
                  <div style={{ width:36, height:36, borderRadius:0, background:"#EFF6FF", display:"grid", placeItems:"center", color:KPMG_MID }}><SvgGear /></div>
                  <div>
                    <h2 style={{ fontSize:17, fontWeight:800, color:"#0B1F33" }}>Model-Specific Metrics</h2>
                    <p style={{ fontSize:12, color:"#94A3B8", marginTop:2 }}>Measured for <strong style={{ color:"#0B1F33" }}>{r.model_label||r.model_type}</strong></p>
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:14 }}>
                  {Object.entries(r.model_metrics).filter(([,m])=>m.value!==null).map(([key,m]) => {
                    const mc = m.risk_level==="Low"?"#059669":m.risk_level==="Moderate"?KPMG_MID:"#DC2626";
                    const mcBg = m.risk_level==="Low"?"#F0FDF4":m.risk_level==="Moderate"?"#EFF6FF":"#FEF2F2";
                    const displayVal = m.unit==="ms"?`${Math.round(m.value!)}ms`:m.value!.toFixed(3);
                    const displayKey = key.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
                    return (
                      <div key={key} className="rpt-hover" style={{ padding:"18px 16px", borderRadius:0, background:mcBg, border:`1px solid ${mc}18`, display:"flex", flexDirection:"column", gap:8 }}>
                        <div style={{ fontSize:11, color:"#6B7C93", textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:600 }}>{displayKey}</div>
                        <div style={{ fontSize:26, fontWeight:800, color:mc }}>{displayVal}</div>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <span style={{ fontSize:11, color:mc, background:"white", border:`1px solid ${mc}35`, padding:"2px 8px", borderRadius:0, fontWeight:700 }}>{m.risk_level}</span>
                          {m.threshold_low!==undefined && <span style={{ fontSize:10, color:"#94A3B8" }}>threshold: {m.threshold_low}{m.unit?` ${m.unit}`:""}</span>}
                        </div>
                        <div style={{ fontSize:11, color:"#6B7C93", lineHeight:1.5 }}>{m.description}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {r.computation_notes && Object.keys(r.computation_notes).filter(k=>k!=="_error").length>0 && (()=>{
              const notes = Object.entries(r.computation_notes!).filter(([k])=>k!=="_error");
              const computed = notes.filter(([,n])=>n.status==="computed");
              const unavailable = notes.filter(([,n])=>n.status!=="computed");
              return (
                <div className="rpt-card" style={{ padding:"28px 32px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
                    <div style={{ width:36, height:36, borderRadius:0, background:"#F0FDF4", display:"grid", placeItems:"center", color:"#059669" }}><SvgSearch /></div>
                    <div>
                      <h2 style={{ fontSize:17, fontWeight:800, color:"#0B1F33" }}>Metric Computation Transparency</h2>
                      <p style={{ fontSize:12, color:"#94A3B8", marginTop:2 }}>Every metric computed directly from your input/output data</p>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:14, flexWrap:"wrap", marginBottom:20 }}>
                    {[{ label:"Computed", count:computed.length, color:"#059669" },{ label:"Unavailable", count:unavailable.length, color:KPMG_MID },{ label:"Total", count:notes.length, color:KPMG_BLUE }].map(({ label,count,color }) => (
                      <div key={label} style={{ padding:"12px 20px", borderRadius:0, background:"#F8FAFC", border:`1px solid ${color}18`, textAlign:"center", minWidth:110 }}>
                        <div style={{ fontSize:24, fontWeight:900, color }}>{count}</div>
                        <div style={{ fontSize:11, color:"#6B7C93", marginTop:4 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:12 }}>
                    {notes.map(([key,note]) => {
                      const ok = note.status==="computed"; const nc = ok?"#059669":KPMG_MID; const ncBg = ok?"#F0FDF4":"#EFF6FF";
                      const displayKey = key.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
                      return (
                        <div key={key} className="rpt-hover" style={{ padding:"14px", borderRadius:0, background:ncBg, border:`1px solid ${nc}15`, display:"flex", flexDirection:"column", gap:6 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                            <span style={{ fontSize:12, fontWeight:700, color:"#0B1F33" }}>{displayKey}</span>
                            <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:0, color:nc, background:"white", border:`1px solid ${nc}28` }}>{ok?"Computed":"Unavailable"}</span>
                          </div>
                          <div style={{ fontSize:22, fontWeight:900, color:nc }}>{note.value!==null?note.value.toFixed(4):"—"}</div>
                          <div style={{ fontSize:10, color:"#94A3B8", lineHeight:1.5 }}>{note.library}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ACCURACY */}
        {activeTab === "accuracy" && (
          <div style={{ display:"flex", flexDirection:"column", gap:22, ...fade(0) }}>
            {r.llm_judge ? (
              <LLMAccuracySection llmJudge={r.llm_judge} modelLabel={r.model_label||r.model_type} />
            ) : (
              <div className="rpt-card" style={{ padding:"60px 48px", textAlign:"center" }}>
                <div style={{ width:48, height:48, borderRadius:"50%", border:"2px solid #E3EAF3", display:"grid", placeItems:"center", margin:"0 auto 16px" }}>
                  <div style={{ width:16, height:16, borderRadius:"50%", border:"2px solid #CBD5E1" }} />
                </div>
                <p style={{ color:"#6B7C93", fontSize:15, fontWeight:600, marginBottom:8 }}>No accuracy data available</p>
                <p style={{ color:"#94A3B8", fontSize:13 }}>Accuracy evaluation requires input/output columns and at least one configured judge API key.</p>
              </div>
            )}
          </div>
        )}

        {/* PROBES */}
        {activeTab === "probes" && (
          <div style={{ display:"flex", flexDirection:"column", gap:22, ...fade(0) }}>
            {(()=>{
              const allFindings = r.findings||[];
              const allProbes = r.probe_results||[];
              const principleKeys = Array.from(new Set([...allFindings.map(f=>f.category),...allProbes.map((p:any)=>p.category)])).filter(Boolean);
              if(!principleKeys.length) return (
                <div className="rpt-card" style={{ padding:"60px 48px", textAlign:"center" }}>
                  <div style={{ padding:"20px 24px", background:"#F0FDF4", border:"1px solid #86EFAC", borderRadius:0, color:"#166534", fontWeight:600, display:"flex", alignItems:"center", gap:10, justifyContent:"center" }}>
                    <SvgCheck /><span>No probe findings. All probes passed.</span>
                  </div>
                </div>
              );
              const sevOrder: Record<string,number> = { High:0, Medium:1, Low:2, Pass:3 };
              const worstSev = (items:{severity:string}[]) => items.reduce((w,x)=>(sevOrder[x.severity]??4)<(sevOrder[w.severity]??4)?x:w,items[0])?.severity||"Pass";
              const totalPassed = allProbes.filter((p:any)=>p.passed).length;
              const totalFailed = allProbes.filter((p:any)=>!p.passed).length;
              const overallPassRate = allProbes.length?Math.round((totalPassed/allProbes.length)*100):null;
              return (
                <>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:14 }}>
                    {[
                      { label:"Principles Tested", val:principleKeys.length, color:KPMG_BLUE },
                      { label:"Total Probes", val:allProbes.length, color:KPMG_MID },
                      { label:"Passed", val:totalPassed, color:"#059669" },
                      { label:"Failed", val:totalFailed, color:"#DC2626" },
                      ...(overallPassRate!==null?[{ label:"Pass Rate", val:`${overallPassRate}%`, color:overallPassRate>=75?"#059669":overallPassRate>=50?"#D97706":"#DC2626" }]:[]),
                    ].map(s => (
                      <div key={s.label} className="rpt-card" style={{ padding:"18px", textAlign:"center", borderTop:`3px solid ${s.color}` }}>
                        <div style={{ fontSize:28, fontWeight:900, color:s.color, lineHeight:1 }}>{s.val}</div>
                        <div style={{ fontSize:11, color:"#6B7C93", fontWeight:600, marginTop:6, letterSpacing:"0.03em" }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding:"12px 18px", borderRadius:0, background:"#FFFBEB", border:"1px solid #FDE68A" }}>
                    <p style={{ margin:0, fontSize:12, color:"#92400E", lineHeight:1.6 }}>
                      <span style={{ fontWeight:700 }}>Why do these scores differ from the principle scores?</span> Principle scores analyse statistical patterns in your production logs. Probe results are behavioural tests — adversarial prompts sent directly to your AI's API. Both measure the same principles from different angles.
                    </p>
                  </div>
                  {principleKeys.map(pkey => {
                    const pFindings = allFindings.filter(f=>f.category===pkey);
                    const pProbes = allProbes.filter((p:any)=>p.category===pkey);
                    const failedProbes = pProbes.filter((p:any)=>!p.passed);
                    const passedProbes = pProbes.filter((p:any)=>p.passed);
                    const allItems = [...pFindings.map(f=>({severity:f.severity})),...failedProbes.map((p:any)=>({severity:p.severity}))];
                    const worst = allItems.length?worstSev(allItems):"Pass";
                    const wc = worst==="High"?"#DC2626":worst==="Medium"?"#D97706":worst==="Low"?"#059669":"#059669";
                    const wBg = worst==="High"?"#FEF2F2":worst==="Medium"?"#FFFBEB":"#F0FDF4";
                    const passRate = pProbes.length?Math.round((passedProbes.length/pProbes.length)*100):null;
                    const pColor = COLORS[pkey]||KPMG_MID;
                    const IC = ICONS[pkey];
                    return (
                      <div key={pkey} className="rpt-card" style={{ overflow:"hidden" }}>
                        <div style={{ padding:"16px 24px", background:`${pColor}06`, borderBottom:"1px solid #E3EAF3", display:"flex", alignItems:"center", gap:12 }}>
                          <div style={{ width:36, height:36, borderRadius:0, background:`${pColor}12`, display:"grid", placeItems:"center", color:pColor, flexShrink:0 }}>{IC?<IC />:<SvgClip />}</div>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:800, fontSize:15, color:"#0B1F33" }}>{pkey}</div>
                            <div style={{ fontSize:12, color:"#6B7C93", marginTop:2 }}>{pProbes.length} probe{pProbes.length!==1?"s":""} &nbsp;·&nbsp; {pFindings.length} finding{pFindings.length!==1?"s":""}{passRate!==null?` &nbsp;·&nbsp; ${passRate}% pass rate`:""}</div>
                          </div>
                          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                            {passRate!==null && (
                              <div style={{ textAlign:"center", padding:"6px 14px", borderRadius:0, background:passRate>=75?"#F0FDF4":passRate>=50?"#FFFBEB":"#FEF2F2", border:`1px solid ${passRate>=75?"#86EFAC":passRate>=50?"#FCD34D":"#FECACA"}` }}>
                                <div style={{ fontSize:18, fontWeight:900, color:passRate>=75?"#059669":passRate>=50?"#D97706":"#DC2626" }}>{passRate}%</div>
                                <div style={{ fontSize:9, color:"#6B7C93", fontWeight:600, letterSpacing:"0.05em" }}>PASS RATE</div>
                              </div>
                            )}
                            <span style={{ padding:"4px 12px", borderRadius:0, fontSize:11, fontWeight:700, color:wc, background:wBg, border:`1px solid ${wc}28` }}>{worst}</span>
                          </div>
                        </div>
                        <div style={{ padding:"16px 24px", display:"flex", flexDirection:"column", gap:10 }}>
                          {pFindings.map((f,fi) => (
                            <div key={`f-${fi}`} style={{ padding:"12px 16px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E3EAF3", borderLeft:`3px solid ${f.severity==="High"?"#DC2626":f.severity==="Medium"?"#D97706":"#059669"}` }}>
                              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                                <span style={{ fontSize:11, fontWeight:700, color:"#6B7C93", textTransform:"uppercase", letterSpacing:"0.06em" }}>Finding</span>
                                <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:0, color:f.severity==="High"?"#DC2626":f.severity==="Medium"?"#D97706":"#059669", background:f.severity==="High"?"#FEF2F2":f.severity==="Medium"?"#FFFBEB":"#F0FDF4" }}>{f.severity}</span>
                              </div>
                              <p style={{ margin:"0 0 8px", fontSize:13, color:"#374151", lineHeight:1.6 }}>{f.issue}</p>
                              <p style={{ margin:0, fontSize:12, color:KPMG_BLUE, lineHeight:1.5 }}>{f.recommendation}</p>
                            </div>
                          ))}
                          {pProbes.slice(0,6).map((p:any,pi:number) => (
                            <div key={`p-${pi}`} style={{ padding:"12px 16px", borderRadius:0, background:p.passed?"#F0FDF4":"#FEF2F2", border:`1px solid ${p.passed?"#86EFAC":"#FECACA"}` }}>
                              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                                <span style={{ fontSize:11, fontWeight:700, color:"#6B7C93", textTransform:"uppercase", letterSpacing:"0.06em" }}>Probe {pi+1}</span>
                                <span style={{ fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:0, color:p.passed?"#059669":"#DC2626", background:p.passed?"#DCFCE7":"#FEE2E2" }}>{p.passed?"Pass":"Fail"}</span>
                              </div>
                              <p style={{ margin:"0 0 6px", fontSize:12, color:"#374151", lineHeight:1.5 }}><strong>Prompt:</strong> {p.prompt?.slice(0,120)}{p.prompt?.length>120?"...":""}</p>
                              {p.note && <p style={{ margin:0, fontSize:11, color:"#6B7C93", lineHeight:1.5 }}>{p.note}</p>}
                            </div>
                          ))}
                          {pProbes.length>6 && <div style={{ fontSize:12, color:"#94A3B8", textAlign:"center", padding:"8px" }}>+{pProbes.length-6} more probes not shown</div>}
                        </div>
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        )}

      </div>
    </div>
  );
}
