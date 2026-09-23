/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const M = "#005EB8", B = "#00338D";

export default function DownloadReport() {
  const location = useLocation();
  const navigate = useNavigate();
  const raw = location.state?.data || (() => { try { const s = sessionStorage.getItem("lastReportData"); return s ? JSON.parse(s) : null; } catch { return null; } })();
  const [pdfLoading, setPdfLoading] = useState(false);
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
  const fmt = (d: string) => new Date(d).toLocaleString("en-GB", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });

  const handleDownload = async () => {
    setPdfLoading(true);
    try {
      const token = localStorage.getItem("token");
      if (!token) { alert("You need to be logged in to download reports."); navigate("/login"); return; }
      if (!r.report_id) { alert("No report ID found."); return; }
      const response = await fetch(`http://localhost:8000/reports/${r.report_id}/pdf`, {
        method:"GET",
        headers:{ "Authorization":`Bearer ${token}`, "Accept":"application/pdf" },
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
      link.download = `Audit_Report_${r.report_id||"Unknown"}_${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(link); link.click(); link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err: any) {
      alert(err.message || "Failed to download PDF.");
    } finally { setPdfLoading(false); }
  };

  const Icon = ({ path, viewBox = "0 0 24 24" }: { path: ReactNode; viewBox?: string }) => (
    <svg width="18" height="18" viewBox={viewBox} fill="none" stroke={M} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );

  const SECTIONS = [
    { icon:<Icon path={<><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx="0.5"/><rect x="12.5" y="8" width="3" height="10" rx="0.5"/><rect x="18" y="5" width="3" height="13" rx="0.5"/></>}/>,
      title:"Executive Summary",        desc:"Overall governance score, risk level, AI system metadata, model type, detection confidence, and deployment readiness assessment." },
    { icon:<Icon path={<><path d="M12 3 4 6.5v5c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10v-5L12 3z"/><path d="m9.5 12 1.8 1.8L15 10"/></>}/>,
      title:"Regulatory Alignment",     desc:"Alignment with EU AI Act, ISO 42001, NIST AI RMF, and KPMG Trusted AI Framework — with sub-parameter policy mapping." },
    { icon:<Icon path={<><path d="m12 3 9.5 17H2.5L12 3z"/><line x1="12" y1="10" x2="12" y2="14.5"/><line x1="12" y1="17" x2="12" y2="17.01"/></>}/>,
      title:"Risk Intelligence",        desc:"Complete findings breakdown by severity (High/Medium/Low), deployment blockers, governance exposure, and regulatory risk indicators." },
    { icon:<Icon path={<><path d="M12 2v3"/><path d="M12 19v3"/><path d="m5 6 3.5 2"/><path d="m15.5 16 3.5 2"/><path d="m5 18 3.5-2"/><path d="m15.5 8 3.5-2"/><circle cx="12" cy="12" r="3.2"/></>}/>,
      title:"LLM Judge Analysis",       desc:"Triple-judge accuracy panel results, confidence breakdown, KB groundedness, disputed rows, and evaluation methodology." },
    { icon:<Icon path={<polygon points="12 2 21 7 21 17 12 22 3 17 3 7 12 2"/>}/>,
      title:"Governance Principles",    desc:"10-dimension Trusted AI assessment with spider chart, principle scores, sub-parameter drill-down, and scoring formulas." },
    { icon:<Icon path={<><rect x="7" y="7" width="10" height="10" rx="1"/><rect x="10" y="10" width="4" height="4" rx="0.5"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></>}/>,
      title:"Agent Behaviour",          desc:"Model-specific metrics, data structural integrity, schema coverage, computation notes, and metric traceability." },
    { icon:<Icon path={<path d="m12 2 2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z"/>}/>,
      title:"Recommendations",          desc:"Per-principle remediation guidance for all 10 Trusted AI dimensions with prioritised action plans and implementation roadmap." },
    { icon:<Icon path={<><rect x="3" y="12" width="4" height="9" rx="0.5"/><rect x="10" y="7" width="4" height="14" rx="0.5"/><rect x="17" y="3" width="4" height="18" rx="0.5"/></>}/>,
      title:"Framework Compliance",     desc:"Detailed compliance status across all four governance frameworks with alignment scores and maturity indicators." },
  ];

  return (
    <div style={{ minHeight:"100vh", background:"#F4F7FB", fontFamily:"'Plus Jakarta Sans',sans-serif", color:"#0F172A", paddingBottom:80 }}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0;}.dl-card{background:white;border-radius: 0px;border:1px solid #E2E8F0;box-shadow:0 1px 4px rgba(0,0,0,0.05),0 4px 16px rgba(0,0,0,0.04);}`}</style>

      {/* Header */}
      <div style={{ background:"linear-gradient(135deg,#00338D,#005EB8)", padding:"28px 36px 24px", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", inset:0, backgroundImage:"linear-gradient(rgba(255,255,255,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.04) 1px,transparent 1px)", backgroundSize:"32px 32px", pointerEvents:"none" }}/>
        <div style={{ position:"relative", maxWidth:1000, margin:"0 auto" }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"1.5px", textTransform:"uppercase", color:"rgba(255,255,255,0.5)", marginBottom:10 }}>Download Center · {r.ai_name}</div>
          <h1 style={{ fontSize:24, fontWeight:900, color:"white", letterSpacing:"-0.4px", marginBottom:6 }}>Download Governance Report</h1>
          <p style={{ fontSize:13, color:"rgba(255,255,255,0.65)" }}>Export a comprehensive PDF audit report with full evidence, scoring breakdown, and improvement roadmap</p>
        </div>
      </div>

      <div style={{ maxWidth:1000, margin:"0 auto", padding:"28px 24px" }}>

        {/* Report preview card */}
        <div className="dl-card" style={{ padding:"32px", marginBottom:20, background:`linear-gradient(135deg,${B}06,${M}04)`, border:`1.5px solid ${M}20` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:20, marginBottom:24 }}>
            <div>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:"1.5px", textTransform:"uppercase" as const, color:"#94A3B8", marginBottom:8 }}>Governance Audit Report</div>
              <div style={{ fontSize:22, fontWeight:900, color:"#0F172A", letterSpacing:"-0.4px", marginBottom:6 }}>{r.ai_name}</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:12, fontSize:12, color:"#64748B" }}>
                <span>Model: <strong style={{ color:"#374151" }}>{r.model_label||r.model_type}</strong></span>
                <span>Evaluated: <strong style={{ color:"#374151" }}>{fmt(r.evaluated_at)}</strong></span>
                <span>ID: <strong style={{ color:"#374151", fontFamily:"monospace" }}>{r.report_id?.slice(0,14)}…</strong></span>
              </div>
            </div>
            <div style={{ display:"flex", gap:16, alignItems:"center" }}>
              <div style={{ textAlign:"center", padding:"16px 20px", borderRadius:0, background:"white", border:"1px solid #E2E8F0" }}>
                <div style={{ fontSize:36, fontWeight:900, color:r.overall_score>=75?"#059669":r.overall_score>=50?M:"#64748B", lineHeight:1 }}>{r.overall_score}</div>
                <div style={{ fontSize:10, color:"#94A3B8", marginTop:4 }}>/ 100 OVERALL</div>
              </div>
              <div style={{ textAlign:"center", padding:"16px 20px", borderRadius:0, background:"white", border:"1px solid #E2E8F0" }}>
                <div style={{ fontSize:16, fontWeight:800, color:r.risk_level==="Low"?"#059669":r.risk_level==="Moderate"?M:"#64748B" }}>{r.risk_level}</div>
                <div style={{ fontSize:10, color:"#94A3B8", marginTop:4 }}>RISK LEVEL</div>
              </div>
            </div>
          </div>

          {/* Coverage stats */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12, marginBottom:24 }}>
            {[
              { label:"Principles Assessed", val:pkeys.length },
              { label:"Findings",            val:(r.findings||[]).length },
              { label:"Logs Evaluated",      val:r.logs_evaluated||0 },
              { label:"Data Quality",        val:`${r.data_quality_score||0}%` },
              ...(r.llm_judge?.accuracy != null ? [{ label:"LLM Accuracy", val:`${Math.round(r.llm_judge.accuracy*100)}%` }] : []),
            ].map((s,i) => (
              <div key={i} style={{ padding:"12px 14px", borderRadius:0, background:"white", border:"1px solid #E2E8F0", textAlign:"center" }}>
                <div style={{ fontSize:20, fontWeight:900, color:B, lineHeight:1 }}>{s.val}</div>
                <div style={{ fontSize:10, color:"#94A3B8", marginTop:4, fontWeight:600 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Download button */}
          <div style={{ textAlign:"center" }}>
            <button
              onClick={handleDownload}
              disabled={pdfLoading}
              style={{
                display:"inline-flex", alignItems:"center", gap:10,
                padding:"16px 48px", borderRadius:0, border:"none",
                background:pdfLoading?"#E2E8F0":`linear-gradient(135deg,${B},${M})`,
                color:pdfLoading?"#94A3B8":"white", fontSize:15, fontWeight:800,
                cursor:pdfLoading?"not-allowed":"pointer",
                boxShadow:pdfLoading?"none":`0 8px 28px ${B}35`,
                transition:"all 0.2s", fontFamily:"inherit",
              }}
              onMouseEnter={e => { if(!pdfLoading)(e.currentTarget as HTMLButtonElement).style.transform="translateY(-2px)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform="translateY(0)"; }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {pdfLoading ? "Generating PDF…" : "Download Full PDF Report"}
            </button>
            <div style={{ fontSize:12, color:"#94A3B8", marginTop:10 }}>
              Comprehensive governance audit report · PDF format · Includes all sections below
            </div>
          </div>
        </div>

        {/* What's included */}
        <div className="dl-card" style={{ padding:"28px 32px", marginBottom:20 }}>
          <div style={{ fontSize:16, fontWeight:800, color:"#0F172A", marginBottom:4 }}>What's Included in This Report</div>
          <div style={{ fontSize:12, color:"#94A3B8", marginBottom:20 }}>The PDF contains all sections of this governance audit workspace</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 }}>
            {SECTIONS.map((s, i) => (
              <div key={i} style={{ display:"flex", gap:12, padding:"14px 16px", borderRadius:0, background:"#F8FAFC", border:"1px solid #E2E8F0" }}>
                <div style={{ width:32, height:32, borderRadius:0, background:"#EEF4FF", display:"grid", placeItems:"center", fontSize:16, flexShrink:0 }}>{s.icon}</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:"#0F172A", marginBottom:3 }}>{s.title}</div>
                  <div style={{ fontSize:11.5, color:"#64748B", lineHeight:1.55 }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Governance archive note */}
        <div className="dl-card" style={{ padding:"24px 28px", background:"#EEF4FF", border:`1.5px solid ${M}25` }}>
          <div style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
            <div style={{ width:36, height:36, borderRadius:0, background:M, display:"grid", placeItems:"center", flexShrink:0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div>
              <div style={{ fontSize:14, fontWeight:800, color:B, marginBottom:6 }}>Governance Archive &amp; Audit Evidence</div>
              <div style={{ fontSize:13, color:"#1E3A5F", lineHeight:1.75 }}>
                This report serves as a formal governance audit record for {r.ai_name}. It documents the evaluation methodology, scoring rationale, regulatory alignment, and remediation recommendations in a format suitable for internal governance reviews, regulatory submissions, and third-party audits. Store this report as part of your AI governance documentation archive.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}