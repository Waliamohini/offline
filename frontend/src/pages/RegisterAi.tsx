/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { registerAI } from "../services/api";

const B = "#00338D", M = "#005EB8", T = "#0091DA";
const FF = "'Plus Jakarta Sans', system-ui, sans-serif";

const OTHER_OPT = "Other (please specify)";

// ── Option lists ──────────────────────────────────────────────────────────────
const DOMAIN_OPTS = [
  "Healthcare & Life Sciences","Financial Services & Banking","Legal & Compliance",
  "Education & EdTech","Retail & E-Commerce","Manufacturing & Supply Chain",
  "Government & Public Sector","HR & Talent Management","Cybersecurity",
  "Agriculture & Environment","Other",
];

// Renamed: no more "Capabilities" — now called "Risk scope" internally
// Labels are plain English, not jargon
const RISK_SCOPE_OPTS: { code:string; label:string; sublabel:string }[] = [
  { code:"PAI", label:"Predicts outcomes",       sublabel:"Classifies, scores, or forecasts (e.g. fraud detection, credit scoring)" },
  { code:"PD",  label:"Finds patterns",          sublabel:"Clusters, segments, or spots anomalies (e.g. customer segmentation)" },
  { code:"DM",  label:"Acts autonomously",       sublabel:"Decides or routes without a human in the loop (e.g. booking agents)" },
  { code:"DP",  label:"Personalises content",    sublabel:"Adapts outputs per individual user (e.g. recommendation engines)" },
];

const END_USER_OPTS = [
  "Internal employees","External customers","Business clients (B2B)",
  "Healthcare professionals","Students","Government officials",
  "General public","Developers",
];
const DECISION_INFLUENCE_OPTS = [
  "Informational only",
  "Recommendations (human decides)",
  "Approvals (AI approves / denies)",
  "Fully automated actions",
];
const DEPLOYMENT_STATUS_OPTS = [
  "In development","Pilot (limited users)",
  "Production","Decommissioning",
];
const DATA_TYPE_OPTS = [
  "PII / personal data","Financial data","Medical records",
  "Legal documents","Proprietary IP","Biometric data",
  "No sensitive data",
];
const JURISDICTION_OPTS = [
  "EU (GDPR / AI Act)","United States (CCPA / HIPAA / NIST)",
  "United Kingdom (UK GDPR)","India (PDPB / IT Act)",
  "South Africa (POPIA)","Canada (PIPEDA)",
  "Australia (Privacy Act)","Global / multiple",
];
const OVERSIGHT_OPTS = [
  "Human approves every decision",
  "Human reviews high-risk outputs",
  "Human can override, but rarely does",
  "Fully automated — no human review",
];
const BIAS_TESTED_OPTS = [
  "Yes — formal audit done","Informal testing only",
  "Not tested","Not applicable",
];
const AI_GENERATED_OPTS = [
  "Yes — mostly AI-generated","Partly AI-generated",
  "No — hand-written","Unknown",
];
const REVIEW_GATE_OPTS = [
  "Yes — human reviews before deploy","No — ships without review","Unknown",
];

type FieldKey = "endUsers"|"dataTypes"|"jurisdictions"|"oversight";
const DOMAIN_SPECIFIC_OPTS: Record<string,Partial<Record<FieldKey,string[]>>> = {
  "Healthcare & Life Sciences":{ endUsers:["Patients & caregivers","Clinicians & care teams","Health insurers"], dataTypes:["Genetic / genomic data","Clinical trial data","Electronic Health Records"], jurisdictions:["US (HIPAA)","EU MDR"], oversight:["Clinician sign-off required"] },
  "Financial Services & Banking":{ endUsers:["Retail banking customers","Institutional / wealth clients","Loan & credit applicants"], dataTypes:["Transaction / account data","Credit history & scores","KYC / AML records"], jurisdictions:["US (SEC / FINRA / GLBA)","PCI-DSS"], oversight:["Compliance officer review"] },
  "Legal & Compliance":{ endUsers:["Attorneys & paralegals","Legal / compliance teams","Litigants"], dataTypes:["Attorney-client communications","Case files","Contract & IP docs"], jurisdictions:["Bar association rules","eDiscovery rules"], oversight:["Attorney review before client output"] },
  "Education & EdTech":{ endUsers:["K-12 students (minors)","Higher-ed students","Teachers & faculty","Parents / guardians"], dataTypes:["Student records (FERPA)","Minor / child data","Academic performance data"], jurisdictions:["US (FERPA / COPPA)","EU (GDPR minors)"], oversight:["Educator review for content to minors"] },
  "Retail & E-Commerce":{ endUsers:["Online shoppers","Loyalty members","Marketplace sellers"], dataTypes:["Purchase & browse history","Payment card data","Loyalty / behavioral profiles"], jurisdictions:["PCI-DSS","US state laws (CCPA)"], oversight:[] },
  "HR & Talent Management":{ endUsers:["Job applicants","Employees","HR & talent teams"], dataTypes:["Resume / screening data","Performance records","Compensation & benefits"], jurisdictions:["EEOC / anti-discrimination law","NYC Local Law 144","EU AI Act (employment)"], oversight:["HR reviewer sign-off"] },
  "Cybersecurity":{ endUsers:["Security analysts (SOC)","IT & infrastructure","Incident response"], dataTypes:["Threat intelligence","Network telemetry","Credentials & access data"], jurisdictions:["NIST CSF","Breach notification laws"], oversight:["Analyst confirmation before containment"] },
  "Government & Public Sector":{ endUsers:["Government officials","Citizens","Benefits applicants"], dataTypes:["Citizen identity records","Benefits / welfare data","Law enforcement data"], jurisdictions:["FOIA / public records law","EU AI Act (public sector)"], oversight:["Public official accountable"] },
};

const MAX_VISIBLE_OPTIONS = 8;
function buildOptions(domain:string, field:FieldKey, generic:string[]): string[] {
  const extra = DOMAIN_SPECIFIC_OPTS[domain]?.[field] ?? [];
  const seen = new Set<string>(); const ordered:string[] = [];
  for (const o of [...extra,...generic]) { if(!seen.has(o)){seen.add(o);ordered.push(o);} }
  const capped = ordered.slice(0,MAX_VISIBLE_OPTIONS);
  capped.push(OTHER_OPT); return capped;
}

// ── Steps (now 4 — capabilities merged into step 2) ───────────────────────────
const STEPS = [
  { id:1, label:"About the agent",    sub:"Name, domain & description"          },
  { id:2, label:"Users, data & scope",sub:"Who, what data, and what it does"    },
  { id:3, label:"Risk & oversight",   sub:"Controls, failures & build context"  },
  { id:4, label:"Review & register",  sub:"Confirm and submit"                  },
];

const SIDEBAR_CONTENT: Record<number,{heading:string;body:string;facts:string[]}> = {
  1:{
    heading:"Start with the basics",
    body:"The name and description travel through the whole audit — they show up on the final PDF report and help the AI judge panel understand what the system is supposed to do. The system prompt is optional but makes the judge meaningfully sharper.",
    facts:["Name appears on your final PDF report","Domain tailors which probes fire","System prompt boosts judge accuracy by ~20%"],
  },
  2:{
    heading:"Context shapes everything",
    body:"Who uses this AI, what data it touches, where it's deployed, and what it does beyond generating text — all of this determines which probes fire and how hard the thresholds are. A medical chatbot gets very different tests than an internal FAQ bot.",
    facts:["End-user type adjusts safety probe intensity","Data types activate privacy-specific probes","Each additional function adds its own TAF risk controls"],
  },
  3:{
    heading:"What's the worst that could happen?",
    body:"The oversight level and worst-case failure description let us target the exact risk scenarios that matter instead of running generic tests. The build provenance section powers the Code & Build Risk tab.",
    facts:["Oversight level affects 3 of 10 TAF principles","Failure description sharpens probe targeting","Build provenance enables Code & Build Risk checks"],
  },
  4:{
    heading:"Almost there",
    body:"Your agent gets added to the AI Register right away. To run the audit, head to the Dashboard — you'll enter your API key and endpoint there. Credentials are never stored here.",
    facts:["Appears in your AI Register immediately","Run the Black Box Audit from the Dashboard","Connection details entered fresh each time — never stored"],
  },
};

// ── Styles ────────────────────────────────────────────────────────────────────
const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}html,body{height:100%;}body{background:#F0F4FA;}
.rai-inp{width:100%;padding:12px 14px;border:1.5px solid #DDE5EF;font-size:14px;font-family:${FF};color:#0F172A;background:#FAFBFD;outline:none;transition:border 0.18s,box-shadow 0.18s,background 0.18s;border-radius:0;}
.rai-inp:focus{border-color:${M};box-shadow:0 0 0 4px rgba(0,94,184,0.1);background:#fff;}
.rai-inp::placeholder{color:#B0C0D4;}
.rai-ta{width:100%;padding:12px 14px;border:1.5px solid #DDE5EF;font-size:13.5px;font-family:${FF};color:#0F172A;background:#FAFBFD;outline:none;resize:vertical;min-height:96px;line-height:1.65;transition:border 0.18s,box-shadow 0.18s;border-radius:0;}
.rai-ta:focus{border-color:${M};box-shadow:0 0 0 4px rgba(0,94,184,0.1);background:#fff;}
.rai-ta::placeholder{color:#B0C0D4;}
.rai-sel-wrap{position:relative;}
.rai-sel{width:100%;padding:12px 38px 12px 14px;border:1.5px solid #DDE5EF;font-size:14px;font-family:${FF};background:#FAFBFD;outline:none;appearance:none;cursor:pointer;color:#0F172A;transition:border 0.18s,box-shadow 0.18s;border-radius:0;}
.rai-sel:focus{border-color:${M};box-shadow:0 0 0 4px rgba(0,94,184,0.1);background:#fff;}
.rai-label{display:block;font-size:11px;font-weight:700;color:#5A7090;letter-spacing:0.6px;margin-bottom:7px;text-transform:uppercase;}
.rai-hint{font-size:11.5px;color:#94A3B8;margin-top:5px;line-height:1.55;}
.rai-btn-p{display:inline-flex;align-items:center;gap:8px;padding:13px 26px;border:none;background:linear-gradient(135deg,${B},${M});color:#fff;font-size:14px;font-weight:800;font-family:${FF};cursor:pointer;transition:transform 0.18s,box-shadow 0.18s;box-shadow:0 4px 16px rgba(0,51,141,0.22);border-radius:0;}
.rai-btn-p:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 10px 28px rgba(0,51,141,0.3);}
.rai-btn-p:disabled{opacity:0.38;cursor:not-allowed;transform:none;box-shadow:none;}
.rai-btn-g{display:inline-flex;align-items:center;gap:8px;padding:13px 22px;border:1.5px solid #D0DCEA;background:#fff;color:#4A6080;font-size:14px;font-weight:700;font-family:${FF};cursor:pointer;transition:all 0.18s;border-radius:0;}
.rai-btn-g:hover{border-color:${M};color:${M};background:#F0F6FF;}
.rai-step-item{display:flex;align-items:flex-start;gap:14px;padding:14px 16px;cursor:default;transition:background 0.2s;border-radius:0;}
.rai-step-item.done{cursor:pointer;}.rai-step-item.done:hover{background:rgba(0,94,184,0.06);}
.rai-step-item.active{background:rgba(0,94,184,0.07);}
.rai-step-circle{width:34px;height:34px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;transition:all 0.22s;border:2px solid transparent;}
.rai-step-circle.done{background:${B};color:#fff;border-color:${B};}
.rai-step-circle.active{background:#fff;color:${M};border-color:${M};box-shadow:0 0 0 4px rgba(0,94,184,0.12);}
.rai-step-circle.future{background:#F1F5F9;color:#B0C0D4;border-color:#E2E8F0;}
.rai-step-connector{width:2px;height:28px;margin-left:16px;background:linear-gradient(to bottom,${M}60,#E2E8F0);transition:background 0.3s;}
.rai-step-connector.done{background:linear-gradient(to bottom,${B},${M});}
.rai-review-row{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid #F1F5F9;font-size:13.5px;}
.rai-review-row:last-child{border-bottom:none;}
@keyframes raiSlideIn{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
.rai-anim{animation:raiSlideIn 0.35s cubic-bezier(.22,1,.36,1) both;}
.rai-opt-card{display:flex;align-items:center;gap:12px;padding:11px 14px;min-height:42px;border:1.5px solid #DDE5EF;background:#FAFBFD;cursor:pointer;transition:all 0.18s;font-size:13px;font-family:${FF};text-align:left;color:#344054;width:100%;border-radius:0;}
.rai-opt-card:hover{border-color:${M};background:#F0F6FF;}
.rai-opt-card.selected{border-color:${M};background:rgba(0,94,184,0.06);color:${B};font-weight:700;}
.rai-opt-radio{width:16px;height:16px;border-radius:50%;border:2px solid #CBD5E1;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all 0.18s;}
.rai-opt-card.selected .rai-opt-radio{border-color:${M};background:${M};}
.rai-opt-radio-dot{width:6px;height:6px;border-radius:50%;background:#fff;}
.rai-chk-card{display:flex;align-items:center;gap:10px;padding:11px 13px;min-height:42px;border:1.5px solid #DDE5EF;background:#FAFBFD;cursor:pointer;transition:all 0.18s;font-size:13px;font-family:${FF};text-align:left;color:#344054;border-radius:0;}
.rai-chk-card:hover{border-color:${M};background:#F0F6FF;}
.rai-chk-card.checked{border-color:${M};background:rgba(0,94,184,0.06);color:${B};font-weight:600;}
.rai-chk-box{width:15px;height:15px;border-radius:50%;border:2px solid #CBD5E1;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all 0.18s;}
.rai-chk-card.checked .rai-chk-box{border-color:${M};background:${M};}
/* Capability cards — same visual language as rai-chk-card, sized for two lines of text plus a code chip */
.rai-cap-card{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1.5px solid #DDE5EF;background:#FAFBFD;cursor:pointer;transition:all 0.18s;font-family:${FF};text-align:left;width:100%;border-radius:0;}
.rai-cap-card:hover{border-color:${M};background:#F0F6FF;}
.rai-cap-card.checked{border-color:${M};background:rgba(0,94,184,0.06);}
.rai-cap-title{font-size:13px;font-weight:700;color:#1E293B;}
.rai-cap-card.checked .rai-cap-title{color:${B};}
.rai-cap-sub{font-size:11.5px;color:#64748B;margin-top:2px;line-height:1.45;}
.rai-cap-chip{padding:2px 8px;font-size:10px;font-weight:800;letter-spacing:0.4px;font-family:'Fira Code',monospace;color:#94A3B8;border:1.5px solid #E2E8F0;background:#F8FAFC;flex-shrink:0;transition:all 0.18s;}
.rai-cap-card.checked .rai-cap-chip{color:${M};border-color:${M};background:rgba(0,94,184,0.06);}
.rai-fact{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#3D5880;padding:8px 12px;background:rgba(0,94,184,0.06);border:1px solid rgba(0,94,184,0.12);border-radius:0;}
.rai-divider{height:1px;background:#EEF2F7;margin:24px 0;}
`;

// ── Sub-components ────────────────────────────────────────────────────────────
function Field({ label, required, hint, children }: { label:string; required?:boolean; hint?:string; children:React.ReactNode }) {
  return (
    <div style={{ marginBottom:20 }}>
      <label className="rai-label">{label}{required && <span style={{ color:"#64748B", marginLeft:3 }}>*</span>}</label>
      {children}
      {hint && <div className="rai-hint">{hint}</div>}
    </div>
  );
}

function OptionCards({ options, value, onChange }: { options:string[]; value:string; onChange:(v:string)=>void; compact?:boolean }) {
  const knownValues = options.filter(o=>o!==OTHER_OPT);
  const isCustomValue = value!==""&&!knownValues.includes(value);
  const [otherActive, setOtherActive] = useState(isCustomValue);
  const [otherText, setOtherText] = useState(isCustomValue?value:"");
  const selectOther = () => { setOtherActive(true); onChange(otherText); };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      {options.map(opt => {
        if (opt===OTHER_OPT) {
          const selected=otherActive||isCustomValue;
          return (
            <div key={opt} style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <button type="button" className={`rai-opt-card${selected?" selected":""}`} onClick={selectOther}>
                <div className="rai-opt-radio">{selected&&<div className="rai-opt-radio-dot"/>}</div>{opt}
              </button>
              {selected&&<input className="rai-inp" style={{ marginLeft:28, width:"calc(100% - 28px)" }} placeholder="Type your own answer…" value={otherText} onChange={e=>{setOtherText(e.target.value);onChange(e.target.value);}} autoFocus/>}
            </div>
          );
        }
        return (
          <button key={opt} type="button" className={`rai-opt-card${value===opt?" selected":""}`} onClick={()=>{setOtherActive(false);onChange(opt);}}>
            <div className="rai-opt-radio">{value===opt&&<div className="rai-opt-radio-dot"/>}</div>{opt}
          </button>
        );
      })}
    </div>
  );
}

function CheckCards({ options, values, onChange }: { options:string[]; values:string[]; onChange:(v:string[])=>void }) {
  const knownValues = options.filter(o=>o!==OTHER_OPT);
  const customValue = values.find(v=>!knownValues.includes(v))??"";
  const [otherActive, setOtherActive] = useState(Boolean(customValue));
  const [otherText, setOtherText] = useState(customValue);
  const toggle=(opt:string)=>onChange(values.includes(opt)?values.filter(v=>v!==opt):[...values,opt]);
  const toggleOther=()=>{ if(otherActive){setOtherActive(false);onChange(values.filter(v=>v!==otherText));setOtherText("");}else{setOtherActive(true);} };
  const updateOtherText=(text:string)=>{ onChange([...values.filter(v=>v!==otherText),...(text?[text]:[])]); setOtherText(text); };
  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, alignItems:"stretch" }}>
      {options.map(opt => {
        if (opt===OTHER_OPT) return (
          <div key={opt} style={{ gridColumn:"1 / -1", display:"flex", flexDirection:"column", gap:8 }}>
            <button type="button" className={`rai-chk-card${otherActive?" checked":""}`} onClick={toggleOther}>
              <div className="rai-chk-box">{otherActive&&<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}</div>{opt}
            </button>
            {otherActive&&<input className="rai-inp" placeholder="Type your own answer…" value={otherText} onChange={e=>updateOtherText(e.target.value)} autoFocus/>}
          </div>
        );
        return (
          <button key={opt} type="button" className={`rai-chk-card${values.includes(opt)?" checked":""}`} onClick={()=>toggle(opt)}>
            <div className="rai-chk-box">{values.includes(opt)&&<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}</div>{opt}
          </button>
        );
      })}
    </div>
  );
}

const ChevronDown = () => (
  <svg style={{ position:"absolute", right:13, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
);

// ── Main component ────────────────────────────────────────────────────────────
export default function RegisterAi() {
  const navigate = useNavigate();
  const [step, setStep]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  // Step 1
  const [name, setName]       = useState("");
  const [domain, setDomain]   = useState("");
  const [desc, setDesc]       = useState("");
  const [sysPrompt, setSysPr] = useState("");

  // Step 2 — users, data, AND risk scope (merged)
  const [endUsers, setEndUsers]                   = useState("");
  const [dataTypes, setDataTypes]                 = useState<string[]>([]);
  const [jurisdictions, setJurisdictions]         = useState<string[]>([]);
  const [deploymentStatus, setDeploymentStatus]   = useState("");
  const [agentCapabilities, setAgentCapabilities] = useState("");
  const [tafCategories, setTafCategories]         = useState<string[]>([]);

  // Step 3
  const [decisionInfluence, setDecisionInfl]  = useState("");
  const [oversight, setOversight]             = useState("");
  const [highestStakes, setHighestStakes]     = useState("");
  const [biasTested, setBiasTested]           = useState("");
  const [aiGenerated, setAiGenerated]         = useState("");
  const [aiCodegenTools, setAiCodegenTools]   = useState("");
  const [reviewGate, setReviewGate]           = useState("");

  const canNext = () => {
    if (step===1) return name.trim().length>1 && Boolean(domain);
    if (step===2) return Boolean(endUsers) && Boolean(deploymentStatus);
    if (step===3) return Boolean(oversight);
    return true;
  };

  const submit = async () => {
    setError(""); setLoading(true);
    try {
      await registerAI({
        name: name.trim(),
        description: desc.trim() || `${name} — ${domain} AI agent`,
        domain,
        connector: { type:"", endpoint:"", headers:{} },
        profile: {
          end_users:              endUsers,
          decision_influence:     decisionInfluence,
          data_types:             dataTypes,
          jurisdictions,
          deployment_status:      deploymentStatus,
          real_time_data:         agentCapabilities,
          autonomous_actions:     agentCapabilities,
          oversight_model:        oversight,
          output_visibility:      "",
          highest_stakes_failure: highestStakes,
          bias_tested:            biasTested,
          ai_generated:           aiGenerated.startsWith("Yes")?"Yes":aiGenerated.startsWith("Partly")?"Partially":aiGenerated.startsWith("No")?"No":"Unknown",
          ai_codegen_tools:       aiCodegenTools,
          human_review_gate:      reviewGate.startsWith("Yes")?"Yes":reviewGate.startsWith("No")?"No":"Unknown",
          taf_applicable_categories: tafCategories,
        },
      });
      localStorage.setItem("activeAI", name.trim());
      navigate("/dashboard");
    } catch(e:any) {
      const d = e?.response?.data?.detail;
      if (Array.isArray(d)) setError(d.map((x:any)=>`${x.loc?.slice(-1)[0]}: ${x.msg}`).join(" · "));
      else setError(typeof d==="string"?d:e.message||"Registration failed.");
    } finally { setLoading(false); }
  };

  const sidebar = SIDEBAR_CONTENT[step];

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight:"100vh", background:"#F0F4FA", fontFamily:FF, color:"#0F172A", display:"flex", flexDirection:"column" }}>

        {/* HEADER */}
        <div style={{ background:`linear-gradient(135deg,${B},${M})`, flexShrink:0, position:"relative", overflow:"hidden" }}>
          <div style={{ position:"absolute", inset:0, backgroundImage:"linear-gradient(rgba(255,255,255,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.04) 1px,transparent 1px)", backgroundSize:"28px 28px", pointerEvents:"none" }}/>
          <div style={{ maxWidth:1260, margin:"0 auto", padding:"22px 40px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"relative" }}>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <img src="/kpmg-logo-white.png" alt="KPMG" style={{ height:38 }}/>
              <div>
                <div style={{ fontSize:10, fontWeight:700, letterSpacing:"1.5px", textTransform:"uppercase" as const, color:"rgba(255,255,255,0.45)", marginBottom:2 }}>AI Register · New Agent</div>
                <div style={{ fontSize:18, fontWeight:900, color:"#fff", letterSpacing:"-0.3px" }}>Register AI Agent</div>
              </div>
            </div>
            <button onClick={()=>navigate("/dashboard")} style={{ padding:"8px 18px", border:"1.5px solid rgba(255,255,255,0.25)", background:"rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.85)", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:FF, transition:"all 0.2s", borderRadius:0 }}
              onMouseEnter={e=>(e.currentTarget.style.background="rgba(255,255,255,0.18)")}
              onMouseLeave={e=>(e.currentTarget.style.background="rgba(255,255,255,0.1)")}>← Back to Dashboard</button>
          </div>
        </div>

        {/* BODY */}
        <div style={{ flex:1, maxWidth:1260, margin:"0 auto", width:"100%", padding:"36px 40px 80px", display:"grid", gridTemplateColumns:"260px 1fr 260px", gap:28, alignItems:"start" }}>

          {/* LEFT nav */}
          <div style={{ position:"sticky", top:28 }}>
            <div style={{ background:"#fff", border:"1.5px solid #E2EAF4", padding:"24px 20px", boxShadow:"0 2px 12px rgba(0,51,141,0.06)" }}>
              <div style={{ fontSize:11, fontWeight:800, color:"#94A3B8", letterSpacing:"1.8px", textTransform:"uppercase" as const, marginBottom:18 }}>Progress</div>
              {STEPS.map((s,i) => (
                <div key={s.id}>
                  <div className={`rai-step-item${step===s.id?" active":""}${step>s.id?" done":""}`} onClick={()=>step>s.id&&setStep(s.id)}>
                    <div className={`rai-step-circle${step>s.id?" done":step===s.id?" active":" future"}`}>
                      {step>s.id?<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>:s.id}
                    </div>
                    <div>
                      <div style={{ fontSize:13.5, fontWeight:step===s.id?800:600, color:step===s.id?M:step>s.id?"#374151":"#B0C0D4", lineHeight:1.2, marginBottom:2 }}>{s.label}</div>
                      <div style={{ fontSize:11.5, color:step===s.id?"#5A7090":"#C4CFDA", fontWeight:500 }}>{s.sub}</div>
                    </div>
                  </div>
                  {i<STEPS.length-1&&<div className={`rai-step-connector${step>s.id?" done":""}`}/>}
                </div>
              ))}
            </div>
          </div>

          {/* MAIN FORM */}
          <div>
            <div key={step} className="rai-anim" style={{ background:"#fff", border:"1.5px solid #E2EAF4", padding:"36px 36px 32px", boxShadow:"0 2px 20px rgba(0,51,141,0.07)", minHeight:440 }}>

              {/* Step header */}
              <div style={{ marginBottom:28 }}>
                <div style={{ fontSize:11, fontWeight:800, color:M, letterSpacing:"2px", textTransform:"uppercase" as const, marginBottom:8 }}>Step {step} of {STEPS.length}</div>
                <div style={{ fontSize:22, fontWeight:900, color:"#0B1F33", letterSpacing:"-0.4px", marginBottom:6 }}>
                  {step===1&&"Tell us about the agent"}
                  {step===2&&"Users, data & scope"}
                  {step===3&&"Risk, oversight & build context"}
                  {step===4&&"Review & confirm"}
                </div>
                <div style={{ fontSize:14, color:"#7A90A8", lineHeight:1.6 }}>
                  {step===1&&"Name, industry, and description — this is the foundation of your audit record."}
                  {step===2&&"This shapes which probes fire and how hard the thresholds are. Be as specific as you can."}
                  {step===3&&"Oversight level, worst-case failure, and how the system was built — these directly affect scoring."}
                  {step===4&&"Everything looks good? Register and you're done."}
                </div>
              </div>

              {/* ── STEP 1: About the agent ── */}
              {step===1 && (
                <div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 20px" }}>
                    <Field label="Agent name" required hint="Appears on your audit report.">
                      <input className="rai-inp" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Acme Customer Support Bot"/>
                    </Field>
                    <Field label="Industry" required hint="Pick the sector this agent operates in.">
                      <div className="rai-sel-wrap">
                        <select className="rai-sel" value={domain} onChange={e=>setDomain(e.target.value)} style={{ color:domain?"#0F172A":"#B0C0D4" }}>
                          <option value="">Select industry…</option>
                          {DOMAIN_OPTS.map(o=><option key={o} value={o}>{o}</option>)}
                        </select>
                        <ChevronDown/>
                      </div>
                    </Field>
                  </div>

                  <Field label="What does it do?" hint="Plain English — one or two sentences. Goes into the audit record and helps the judge panel understand the agent's purpose.">
                    <textarea className="rai-ta" value={desc} onChange={e=>setDesc(e.target.value)} placeholder="e.g. Answers billing and returns questions for Acme's online store. Escalates to a human agent if it can't resolve the query."/>
                  </Field>

                  <Field label="System prompt" hint="Optional, but makes the AI judge panel noticeably more accurate. Paste the actual prompt if you have it.">
                    <textarea className="rai-ta" value={sysPrompt} onChange={e=>setSysPr(e.target.value)} placeholder="You are a helpful assistant for Acme Corp. You help customers with…" style={{ minHeight:80, fontFamily:"'Fira Code','JetBrains Mono',monospace", fontSize:12.5 }}/>
                  </Field>
                </div>
              )}

              {/* ── STEP 2: Users, data & scope ── */}
              {step===2 && (
                <div>
                  {/* Part 1 — users & deployment */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 28px" }}>
                    <Field label="Who uses it?" required>
                      <OptionCards options={buildOptions(domain,"endUsers",END_USER_OPTS)} value={endUsers} onChange={setEndUsers}/>
                    </Field>
                    <Field label="Where is it deployed?" required>
                      <OptionCards options={[...DEPLOYMENT_STATUS_OPTS,OTHER_OPT]} value={deploymentStatus} onChange={setDeploymentStatus}/>
                    </Field>
                  </div>

                  <div className="rai-divider"/>

                  {/* Part 2 — data & regulations */}
                  <Field label="What data does it handle?">
                    <CheckCards options={buildOptions(domain,"dataTypes",DATA_TYPE_OPTS)} values={dataTypes} onChange={setDataTypes}/>
                  </Field>
                  <Field label="Regulations & jurisdictions">
                    <CheckCards options={buildOptions(domain,"jurisdictions",JURISDICTION_OPTS)} values={jurisdictions} onChange={setJurisdictions}/>
                  </Field>
                  <Field label="Can it act on its own?" hint="e.g. send emails, query databases, book appointments. Leave blank if read-only.">
                    <input className="rai-inp" value={agentCapabilities} onChange={e=>setAgentCapabilities(e.target.value)} placeholder="e.g. Queries the CRM, sends confirmation emails, books appointments"/>
                  </Field>

                  <div className="rai-divider"/>

                  {/* Part 3 — key capabilities (was a separate step, now a sub-section) */}
                  <div style={{ marginBottom:12 }}>
                    <label className="rai-label">Key capabilities</label>
                    <div style={{ fontSize:12.5, color:"#64748B", lineHeight:1.55, marginBottom:12, marginTop:-2 }}>
                      Generative AI checks run for every audit by default. Select any of these that also apply — each unlocks its own set of controls.
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                      {RISK_SCOPE_OPTS.map(opt => {
                        const checked = tafCategories.includes(opt.code);
                        return (
                          <button key={opt.code} type="button"
                            className={`rai-cap-card${checked?" checked":""}`}
                            onClick={()=>setTafCategories(prev=>prev.includes(opt.code)?prev.filter(c=>c!==opt.code):[...prev,opt.code])}>
                            <div className="rai-chk-box">
                              {checked&&<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                            </div>
                            <div style={{ flex:1 }}>
                              <div className="rai-cap-title">{opt.label}</div>
                              <div className="rai-cap-sub">{opt.sublabel}</div>
                            </div>
                            <div className="rai-cap-chip">{opt.code}</div>
                          </button>
                        );
                      })}
                    </div>
                    {tafCategories.length===0&&(
                      <div style={{ marginTop:10, fontSize:11.5, color:"#94A3B8" }}>None selected — only the default Generative AI controls will run.</div>
                    )}
                    {tafCategories.length>0&&(
                      <div style={{ marginTop:10, padding:"8px 14px", background:"#F0FDF4", border:"1px solid #BBF7D0", fontSize:11.5, color:"#065F46" }}>
                        {tafCategories.length} additional {tafCategories.length===1?"capability":"capabilities"} selected.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── STEP 3: Risk & oversight ── */}
              {step===3 && (
                <div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 28px" }}>
                    <Field label="Human oversight level" required>
                      <OptionCards options={buildOptions(domain,"oversight",OVERSIGHT_OPTS)} value={oversight} onChange={setOversight}/>
                    </Field>
                    <Field label="How does it affect decisions?">
                      <OptionCards options={[...DECISION_INFLUENCE_OPTS,OTHER_OPT]} value={decisionInfluence} onChange={setDecisionInfl}/>
                    </Field>
                  </div>

                  <Field label="Worst-case failure?" hint="One sentence. The more specific the better.">
                    <textarea className="rai-ta" value={highestStakes} onChange={e=>setHighestStakes(e.target.value)} placeholder="e.g. Marks a legitimate transaction as fraud and locks a customer's account without human review" style={{ minHeight:80 }}/>
                  </Field>

                  <Field label="Bias testing done?">
                    <OptionCards options={[...BIAS_TESTED_OPTS,OTHER_OPT]} value={biasTested} onChange={setBiasTested}/>
                  </Field>

                  <div className="rai-divider"/>

                  <div style={{ fontSize:13, fontWeight:800, color:"#0B1F33", marginBottom:4 }}>How was this system built?</div>
                  <div style={{ fontSize:13, color:"#7A90A8", marginBottom:18, lineHeight:1.6 }}>Powers the Code &amp; Build Risk tab. Leave as Unknown if you're not sure.</div>

                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 28px" }}>
                    <Field label="Built with AI code tools?">
                      <OptionCards options={AI_GENERATED_OPTS} value={aiGenerated} onChange={setAiGenerated}/>
                    </Field>
                    <div>
                      <Field label="Which tools?" hint="Optional.">
                        <input className="rai-inp" value={aiCodegenTools} onChange={e=>setAiCodegenTools(e.target.value)} placeholder="e.g. Cursor + GitHub Copilot"/>
                      </Field>
                      <Field label="Code reviewed before deploy?">
                        <OptionCards options={REVIEW_GATE_OPTS} value={reviewGate} onChange={setReviewGate}/>
                      </Field>
                    </div>
                  </div>

                  <div style={{ display:"flex", gap:10, padding:"12px 16px", background:"#F0F6FF", border:"1.5px solid rgba(0,94,184,0.18)", fontSize:13, color:"#1E3A5F", lineHeight:1.7, marginTop:8 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={M} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, marginTop:2 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span><strong>API keys and endpoint URLs aren't stored here.</strong> You enter them each time you kick off a Black Box Audit from the Dashboard.</span>
                  </div>
                </div>
              )}

              {/* ── STEP 4: Review ── */}
              {step===4 && (
                <div>
                  <div style={{ border:"1.5px solid #E2EAF4", overflow:"hidden", marginBottom:20 }}>
                    <div style={{ background:B, padding:"12px 20px" }}>
                      <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.55)", letterSpacing:"1.5px", textTransform:"uppercase" as const }}>Agent Summary</div>
                      <div style={{ fontSize:17, fontWeight:900, color:"#fff", marginTop:2 }}>{name||"—"}</div>
                    </div>
                    <div style={{ padding:"4px 20px 12px", background:"#FAFBFD" }}>
                      {([
                        ["Industry",        domain],
                        ["Description",     desc||`${name} — ${domain} agent`],
                        ["Who uses it",     endUsers],
                        ["Deployed",        deploymentStatus],
                        ["Data processed",  dataTypes.join(", ")||"—"],
                        ["Regulations",     jurisdictions.join(", ")||"—"],
                        ["Agent actions",   agentCapabilities||"—"],
                        ["Key capabilities",["Generative AI (always)",...tafCategories.map(c=>RISK_SCOPE_OPTS.find(o=>o.code===c)?.label??c)].join(", ")],
                        ["Decision influence",decisionInfluence||"—"],
                        ["Human oversight", oversight],
                        ["Worst-case failure",highestStakes||"—"],
                        ["Bias testing",    biasTested||"—"],
                      ] as [string,string][]).map(([k,v])=>(
                        <div className="rai-review-row" key={k}>
                          <span style={{ color:"#64748B", fontWeight:500, flexShrink:0 }}>{k}</span>
                          <span style={{ color:"#0F172A", fontWeight:600, textAlign:"right", maxWidth:"60%", wordBreak:"break-word" }}>{v||"—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:10, padding:"12px 16px", background:"#F0F6FF", border:"1.5px solid rgba(0,94,184,0.18)", fontSize:13, color:"#1E3A5F", lineHeight:1.7 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={M} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, marginTop:2 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span>After registering, go to <strong style={{ color:B }}>Run Audit</strong> on the Dashboard to kick off the Black Box Audit.</span>
                  </div>
                </div>
              )}

              {error&&<div style={{ marginTop:16, padding:"12px 16px", background:"#FFF5F5", border:"1px solid #FED7D7", fontSize:13, color:"#C53030" }}>{error}</div>}
            </div>

            {/* NAV BUTTONS */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:16, gap:10 }}>
              {step>1?<button className="rai-btn-g" onClick={()=>setStep(step-1)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>Back</button>:<div/>}
              {step<4?(
                <button className="rai-btn-p" onClick={()=>canNext()&&setStep(step+1)} disabled={!canNext()}>Continue<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
              ):(
                <button className="rai-btn-p" onClick={submit} disabled={loading}>
                  {loading?<><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation:"spin 1s linear infinite" }}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Registering…</>:<>Register Agent<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></>}
                </button>
              )}
            </div>
          </div>

          {/* RIGHT SIDEBAR */}
          <div key={`help-${step}`} className="rai-anim" style={{ position:"sticky", top:28 }}>
            <div style={{ background:"#fff", border:"1.5px solid #E2EAF4", padding:"24px 22px", boxShadow:"0 2px 12px rgba(0,51,141,0.06)" }}>
              <div style={{ width:36, height:36, background:`linear-gradient(135deg,${B},${M})`, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:14 }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </div>
              <div style={{ fontSize:14, fontWeight:800, color:"#0B1F33", marginBottom:8, lineHeight:1.3 }}>{sidebar.heading}</div>
              <div style={{ fontSize:13, color:"#5A7090", lineHeight:1.72, marginBottom:16 }}>{sidebar.body}</div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {sidebar.facts.map((f,i)=>(
                  <div key={i} className="rai-fact">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={M} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><polyline points="20 6 9 17 4 12"/></svg>
                    {f}
                  </div>
                ))}
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ marginTop:14, padding:"12px 16px", background:"#fff", border:"1.5px solid #E2EAF4" }}>
              {(()=>{
                const answered=[
                  name.trim().length>1, Boolean(domain), desc.trim().length>0, sysPrompt.trim().length>0,
                  Boolean(endUsers), Boolean(deploymentStatus), dataTypes.length>0, jurisdictions.length>0,
                  agentCapabilities.trim().length>0, tafCategories.length>0,
                  Boolean(decisionInfluence), Boolean(oversight), highestStakes.trim().length>0, Boolean(biasTested),
                ].filter(Boolean).length;
                const total=14; const pct=Math.round((answered/total)*100);
                return (
                  <>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:7 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8" }}>{answered} of {total} answered</div>
                      <div style={{ fontSize:12, fontWeight:800, color:M }}>{pct}%</div>
                    </div>
                    <div style={{ height:5, background:"#EEF2F8", overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(90deg,${B},${T})`, transition:"width 0.35s cubic-bezier(.16,1,.3,1)" }}/>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </>
  );
}