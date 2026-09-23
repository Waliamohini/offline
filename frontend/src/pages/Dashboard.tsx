import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { sdccIngest, evaluateAI, runBlackBoxAudit, uploadKnowledgeBase, getKbChunks, ingestChatHistory, uploadTrainingData } from "../services/api";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BlackBoxFinding {
  category: string;
  severity: "High" | "Medium" | "Low" | "Pass";
  probe: string;
  response_preview: string;
  issue: string;
  recommendation: string;
}

interface BlackBoxResult {
  audit_id: string;
  ai_name: string;
  mode: string;
  status: string;
  overall_score: number;
  risk_level: string;
  probes_run: number;
  category_scores: Record<string, number>;
  findings: BlackBoxFinding[];
  message?: string;
}

interface ComputationNote {
  library: string;
  status: string;
  value: number | null;
}

interface SdccSummary {
  model_type: string;
  logs_ingested: number;
  data_quality_score: number;
  structural_risk: string;
  detection_confidence?: number;
  recommendation?: string;
  column_warnings?: string[];
  has_input_col?: boolean;
  has_output_col?: boolean;
  has_latency_col?: boolean;
  has_task_id_col?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// These phases map exactly to orchestrator.py's execution order:
// Unified pipeline phases (taxonomy-seeded, tier-scaled):
// Phase 1 — Fingerprint: synthesized self-report + behavioural elicitation probes -> LLM reconciliation
// Phase 2 — Control probes: probes synthesized per applicable TAF taxonomy control (batched, Groq-generated)
// Phase 3 — Adaptive follow-up: harder probes on weakest controls (standard/thorough only)
// Phase 4 — Build risk: injection, auth, config probes (only when AI-generated flag is set)
// Phase 5 — Scoring & saving
const BB_LOADER_PHASES: { label: string; detail: string; weight: number }[] = [
  { label: "Fingerprint",          detail: "Synthesizing & firing self-report probes — reconciling live AI vs registration", weight: 10 },
  { label: "Control probes",       detail: "Probing all applicable TAF taxonomy controls with Groq-synthesized adversarial prompts", weight: 60 },
  { label: "Adaptive follow-up",   detail: "Harder probes targeting the weakest controls found in phase 2", weight: 15 },
  { label: "Build risk checks",    detail: "Injection, authorization & config probes (runs when AI-generated flag is set)", weight: 10 },
  { label: "Scoring & saving",     detail: "Computing governance scores, building evidence store & TAF taxonomy mapping", weight: 5 },
];

// Cycled through live during Phase 1/2 to make the modal feel like it's actually
// doing distinct work per principle, not just idling on a growing bar.
const BB_LIVE_CATEGORIES = [
  "Fairness", "Transparency", "Explainability", "Accountability", "Data Integrity",
  "Reliability", "Security", "Safety", "Privacy", "Sustainability",
];

// Rough total-probe estimates per tier (see audit_config.py::expected_probe_count),
// used only to render a plausible live "Probe N of ~Total" counter.
const BB_TOTAL_PROBES: Record<"dev" | "standard" | "thorough", number> = {
  dev: 40, standard: 140, thorough: 260,
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{background:#F4F7FB;overflow:hidden;}
html,body{overflow:hidden;}
.db{font-family:'Plus Jakarta Sans',sans-serif;background:#F4F7FB;min-height:100vh;color:#0B1F33;}

/* ── Nav ── */
.db-nav{background:#fff;border-bottom:1px solid #E3EAF3;height:62px;display:flex;align-items:center;justify-content:space-between;padding:0 40px;position:sticky;top:0;z-index:100;box-shadow:0 1px 12px rgba(0,51,141,0.05);}
.db-brand{font-size:17px;font-weight:900;color:#00338D;letter-spacing:-0.4px;}
.db-ai-chip{background:#EEF4FF;border:1px solid #C7D9F5;color:#005EB8;font-size:11.5px;font-weight:700;padding:4px 12px;border-radius: 0px;}
.db-nav-r{display:flex;gap:8px;}
.db-nbtn{padding:7px 16px;border-radius: 0px;font-size:13px;font-weight:600;cursor:pointer;border:1.5px solid #E3EAF3;background:#fff;color:#5A7090;transition:all 0.2s;font-family:inherit;}
.db-nbtn:hover{border-color:#005EB8;color:#005EB8;}
.db-nbtn.red{border-color:#FED7D7;background:#FFF5F5;color:#C53030;}
.db-nbtn.red:hover{background:#FEE2E2;}

/* ── Body ── */
.db-body{max-width:820px;margin:0 auto;padding:40px 24px 80px;overflow-y:auto;max-height:calc(100vh - 62px);}
.db-body::-webkit-scrollbar{display:none;}
.db-body{-ms-overflow-style:none;scrollbar-width:none;}
.db-page-title{font-size:22px;font-weight:900;color:#00338D;letter-spacing:-0.5px;margin-bottom:4px;}
.db-page-sub{font-size:13.5px;color:#8FA3BF;margin-bottom:36px;line-height:1.5;}

/* ── Steps ── */
.db-steps{display:flex;flex-direction:column;gap:20px;}
.db-step{display:flex;flex-direction:column;gap:0;}
.db-step-left{display:none;}
.db-step-body{flex:1;padding:0;}
.db-step-eyebrow{display:none;}

/* ── Cards ── */
.db-card{background:#fff;border:1.5px solid #E3EAF3;border-radius: 0px;padding:22px;transition:all 0.25s;}
.db-card.active{border-color:#C7D9F5;box-shadow:0 4px 20px rgba(0,51,141,0.07);}
.db-card.done{border-color:#B2E8E6;background:#FAFFFE;}
.db-card.locked{opacity:0.4;pointer-events:none;user-select:none;}
.db-card-h{font-size:14px;font-weight:800;color:#00338D;margin-bottom:3px;}
.db-card-d{font-size:12.5px;color:#8FA3BF;margin-bottom:16px;line-height:1.55;}
.db-done-row{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:14px;}
.db-redo{font-size:12px;color:#8FA3BF;cursor:pointer;text-decoration:underline;border:none;background:none;font-family:inherit;padding:0;flex-shrink:0;margin-top:2px;}

/* ── Form elements ── */
.db-lbl{font-size:11px;font-weight:700;color:#5A7090;letter-spacing:0.5px;margin-bottom:5px;text-transform:uppercase;}
.db-inp{width:100%;padding:11px 13px;border-radius: 0px;border:1.5px solid #E3EAF3;font-size:13.5px;font-family:inherit;color:#0B1F33;background:#fff;outline:none;transition:all 0.2s;}
.db-inp:focus{border-color:#005EB8;box-shadow:0 0 0 3px rgba(0,94,184,0.09);}
.db-inp::placeholder{color:#B8C8D8;}
.db-ta{width:100%;padding:11px 13px;border-radius: 0px;border:1.5px solid #E3EAF3;font-size:13px;font-family:inherit;color:#0B1F33;background:#fff;outline:none;resize:vertical;min-height:100px;line-height:1.6;transition:all 0.2s;}
.db-ta:focus{border-color:#005EB8;box-shadow:0 0 0 3px rgba(0,94,184,0.09);}
.db-ta::placeholder{color:#B8C8D8;}
.db-field{margin-bottom:12px;}

/* ── Tabs ── */
.db-tabs{display:flex;gap:3px;background:#F0F4FA;padding:3px;border-radius: 0px;margin-bottom:16px;}
.db-tab{flex:1;padding:7px 8px;border-radius: 0px;font-size:12px;font-weight:600;cursor:pointer;border:none;background:transparent;color:#8FA3BF;transition:all 0.2s;font-family:inherit;}
.db-tab.on{background:#fff;color:#00338D;box-shadow:0 1px 5px rgba(0,51,141,0.1);}

/* ── File drop ── */
.db-drop{border:2px dashed #D0DCF0;border-radius: 0px;padding:18px;text-align:center;cursor:pointer;transition:all 0.2s;background:#F7FAFF;margin-bottom:12px;}
.db-drop:hover{border-color:#005EB8;background:#EEF4FF;}
.db-drop.has{border-color:#00A3A1;background:#F0FAFA;}
.db-drop-t{font-size:12.5px;color:#8FA3BF;}
.db-drop-t.has{color:#00A3A1;font-weight:600;}

/* ── Buttons ── */
.db-btn{width:100%;padding:12px;border-radius: 0px;border:none;background:linear-gradient(135deg,#00338D,#005EB8);color:#fff;font-size:13.5px;font-weight:700;font-family:inherit;cursor:pointer;transition:all 0.3s;box-shadow:0 4px 14px rgba(0,51,141,0.2);}
.db-btn:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 8px 22px rgba(0,51,141,0.28);}
.db-btn:disabled{opacity:0.4;cursor:not-allowed;transform:none;}
.db-btn.teal{background:linear-gradient(135deg,#00A3A1,#0091DA);}
.db-btn.big{padding:15px;font-size:15px;font-weight:800;border-radius: 0px;letter-spacing:-0.2px;box-shadow:0 6px 22px rgba(0,51,141,0.26);}
.db-btn.big:hover:not(:disabled){transform:translateY(-3px);box-shadow:0 14px 34px rgba(0,51,141,0.34);}
.db-btn.sm{width:auto;padding:8px 16px;font-size:12px;box-shadow:none;}

/* ── Alerts ── */
.db-err{margin-top:10px;padding:10px 14px;background:#F0F4FF;border:1.5px solid #C7D9F5;border-left:3px solid #005EB8;border-radius: 0px;font-size:12.5px;color:#00338D;}
.db-ok{margin-top:10px;padding:10px 13px;background:#F0FFF4;border:1px solid #C6F6D5;border-radius: 0px;font-size:12.5px;color:#276749;}
.db-info{padding:10px 13px;background:#EEF4FF;border:1px solid #C7D9F5;border-radius: 0px;font-size:12.5px;color:#005EB8;line-height:1.6;margin-bottom:12px;}
.db-warn{padding:10px 13px;background:#F5F8FF;border:1px solid #C7D9F5;border-radius: 0px;font-size:12.5px;color:#3D5A8A;line-height:1.6;margin-top:8px;}

/* ── Progress ── */
.db-prog{height:4px;background:#E3EAF3;border-radius: 0px;overflow:hidden;margin-top:10px;}
.db-prog-fill{height:100%;background:linear-gradient(to right,#00338D,#0091DA);border-radius: 0px;transition:width 0.4s;}
.db-prog-lbl{font-size:11px;color:#8FA3BF;margin-top:4px;text-align:center;}

/* ── Badges ── */
.db-badge{display:inline-block;padding:3px 9px;border-radius: 0px;font-size:11px;font-weight:700;}
.db-badge.low{color:#276749;background:#F0FFF4;border:1px solid #C6F6D5;}
.db-badge.med{color:#3D5A8A;background:#EEF4FF;border:1px solid #C7D9F5;}
.db-badge.high{color:#00338D;background:#E8EFFE;border:1px solid #A8BFEE;}

/* ── Misc ── */
.db-hr{height:1px;background:#E3EAF3;margin:14px 0;}
.db-section-lbl{font-size:10.5px;font-weight:800;color:#8FA3BF;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px;margin-top:16px;}

/* ── Score bar ── */
.db-score-bar-wrap{display:flex;align-items:center;gap:10px;margin-bottom:6px;}
.db-score-bar-track{flex:1;height:7px;background:#EDF1F7;border-radius: 0px;overflow:hidden;}
.db-score-bar-fill{height:100%;border-radius: 0px;transition:width 0.8s cubic-bezier(.16,1,.3,1);}
.db-score-bar-lbl{font-size:11.5px;font-weight:700;color:#00338D;min-width:32px;text-align:right;}
.db-score-bar-name{font-size:12px;color:#5A7090;min-width:110px;}

/* ── KV rows ── */
.db-kv{display:flex;flex-direction:column;gap:5px;}
.db-kv-row{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:#F7FAFF;border-radius: 0px;}
.db-kv-k{font-size:12.5px;color:#5A7090;}
.db-kv-v{font-size:12.5px;font-weight:700;color:#00338D;}
.db-kv-v.green{color:#276749;}
.db-kv-v.red{color:#3D5A8A;}
.db-kv-v.amber{color:#3D5A8A;}

/* ── Schema pills ── */
.db-schema{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
.db-schema-pill{padding:4px 10px;border-radius: 0px;font-size:11px;font-weight:700;}
.db-schema-pill.ok{background:#F0FFF4;color:#276749;border:1px solid #C6F6D5;}
.db-schema-pill.miss{background:#EEF4FF;color:#3D5A8A;border:1px solid #C7D9F5;}

/* ── Findings ── */
.db-finding{padding:12px 14px;border-radius: 0px;margin-top:8px;border-left:3px solid #005EB8;background:#F7FAFF;}
.db-finding.high{border-left-color:#00338D;background:#EEF4FF;}
.db-finding.med{border-left-color:#4A78C4;background:#F0F5FF;}
.db-finding-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;}
.db-finding-cat{font-size:12px;font-weight:800;color:#00338D;}
.db-finding.high .db-finding-cat{color:#00338D;}
.db-finding.med .db-finding-cat{color:#3D5A8A;}
.db-finding-sev{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius: 0px;}
.db-finding-sev.high{background:#D8E6FF;color:#00338D;}
.db-finding-sev.med{background:#E8F0FD;color:#3D5A8A;}
.db-finding-sev.low{background:#C6F6D5;color:#276749;}
.db-finding-issue{font-size:12.5px;color:#5A7090;margin-bottom:4px;line-height:1.5;}
.db-finding-rec{font-size:12px;color:#005EB8;line-height:1.5;}
.db-finding-probe{font-size:11px;color:#B0C0D4;margin-top:4px;font-style:italic;}

/* ── Big score ── */
.db-big-score{display:flex;align-items:center;gap:16px;padding:16px;background:#F0F5FF;border-radius: 0px;margin-bottom:14px;border:1px solid #D8E6FF;}
.db-big-score-num{font-size:44px;font-weight:900;color:#00338D;letter-spacing:-2px;line-height:1;}
.db-big-score-right{flex:1;}
.db-big-score-label{font-size:12px;color:#7A90AB;font-weight:600;margin-bottom:6px;}
.db-big-score-bar{height:10px;background:#D8E6FF;border-radius: 0px;overflow:hidden;}
.db-big-score-fill{height:100%;border-radius: 0px;transition:width 1s cubic-bezier(.16,1,.3,1);}

/* ── Checklist ── */
.db-checklist{display:flex;flex-direction:column;gap:6px;margin-bottom:16px;}
.db-check-row{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#F7FAFF;border-radius: 0px;}
.db-check-k{font-size:13px;color:#5A7090;}
.db-check-v{font-size:13px;font-weight:700;color:#00338D;}
.db-check-v.green{color:#276749;}
.db-check-v.red{color:#00338D;}

@media(max-width:640px){
  .db-body{padding:20px 14px;}
  .db-nav{padding:0 16px;}
  .db-score-bar-name{min-width:80px;}
}

/* ── Eval loader ── */
@keyframes eval-slide{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}
@keyframes eval-pulse{0%,100%{opacity:1}50%{opacity:0.6}}
.db-eval-loader{margin-top:16px;}
.db-eval-track{height:4px;background:#E3EAF3;border-radius: 0px;overflow:hidden;position:relative;}
.db-eval-bar{position:absolute;top:0;left:0;height:100%;width:30%;background:linear-gradient(to right,#00338D,#0091DA,#00A3A1);border-radius: 0px;animation:eval-slide 1.6s ease-in-out infinite;}
.db-eval-steps{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;justify-content:center;}
.db-eval-step{font-size:11px;font-weight:600;padding:3px 10px;border-radius: 0px;background:#EEF4FF;color:#005EB8;border:1px solid #C7D9F5;animation:eval-pulse 2s ease-in-out infinite;}
.db-eval-step:nth-child(2){animation-delay:0.4s;}
.db-eval-step:nth-child(3){animation-delay:0.8s;}
.db-eval-step:nth-child(4){animation-delay:1.2s;}
.db-eval-lbl{font-size:11px;color:#8FA3BF;margin-top:6px;text-align:center;}

/* ── Principle accordion ── */
.db-principle-list{display:flex;flex-direction:column;gap:8px;margin-top:4px;}
.db-principle-card{border:1.5px solid #E3EAF3;border-radius: 0px;overflow:hidden;background:#fff;transition:border-color 0.2s;}
.db-principle-card.has-issues{border-color:#C7D9F5;}
.db-principle-card.has-high{border-color:#A8BFEE;}
.db-principle-card.all-pass{border-color:#C6F6D5;}
.db-principle-header{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;user-select:none;transition:background 0.15s;}
.db-principle-header:hover{background:#F7FAFF;}
.db-principle-name{font-size:13px;font-weight:700;color:#0B1F33;flex:1;min-width:0;}
.db-principle-meta{display:flex;align-items:center;gap:8px;flex-shrink:0;}
.db-principle-score-chip{font-size:11.5px;font-weight:800;padding:2px 9px;border-radius: 0px;min-width:38px;text-align:center;}
.db-principle-score-chip.green{background:#F0FFF4;color:#276749;border:1px solid #C6F6D5;}
.db-principle-score-chip.amber{background:#EEF4FF;color:#3D5A8A;border:1px solid #C7D9F5;}
.db-principle-score-chip.red{background:#E8EFFE;color:#00338D;border:1px solid #A8BFEE;}
.db-principle-chevron{font-size:11px;color:#B0C0D4;transition:transform 0.2s;margin-left:2px;}
.db-principle-chevron.open{transform:rotate(180deg);}
.db-principle-bar-row{padding:0 14px 10px;display:flex;align-items:center;gap:8px;}
.db-principle-bar-track{flex:1;height:7px;background:#EDF1F7;border-radius: 0px;overflow:hidden;}
.db-principle-bar-fill{height:100%;border-radius: 0px;transition:width 0.7s cubic-bezier(.16,1,.3,1);}
.db-principle-body{border-top:1px solid #F0F4FA;padding:12px 14px;display:flex;flex-direction:column;gap:8px;}
.db-principle-finding{padding:9px 11px;border-radius: 0px;border-left:3px solid #C7D9F5;background:#F7FAFF;}
.db-principle-finding.high{border-left-color:#00338D;background:#EEF4FF;}
.db-principle-finding.med{border-left-color:#4A78C4;background:#F0F5FF;}
.db-principle-finding.pass{border-left-color:#C6F6D5;background:#F0FFF4;}
.db-principle-finding-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}
.db-principle-finding-sev{font-size:10px;font-weight:800;padding:1px 7px;border-radius: 0px;}
.db-principle-finding-sev.high{background:#D8E6FF;color:#00338D;}
.db-principle-finding-sev.med{background:#E8F0FD;color:#3D5A8A;}
.db-principle-finding-sev.low{background:#C6F6D5;color:#276749;}
.db-principle-finding-issue{font-size:12px;color:#5A7090;line-height:1.5;margin-bottom:3px;}
.db-principle-finding-rec{font-size:11.5px;color:#005EB8;line-height:1.5;}
.db-principle-finding-probe{font-size:10.5px;color:#B0C0D4;margin-top:3px;font-style:italic;}
.db-principle-pass-note{font-size:12px;color:#276749;text-align:center;padding:4px 0;}

/* ══════════════════════════════════════════
   MODAL — base keyframes
══════════════════════════════════════════ */
@keyframes modal-backdrop-fade{from{opacity:0}to{opacity:1}}
@keyframes modal-pop-up{from{opacity:0;transform:scale(0.85) translateY(20px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes pulse-ring{0%{transform:scale(1);opacity:1}100%{transform:scale(1.8);opacity:0}}
@keyframes spin-icon{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes slide-bar-indet{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}
@keyframes fade-in-up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes scale-in{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}
@keyframes dot-bounce{0%,100%{opacity:0.35;transform:scale(0.85)}50%{opacity:1;transform:scale(1.15)}}

/* ── Modal — success keyframes ── */
@keyframes modal-success-zoom{0%{transform:scale(1)}30%{transform:scale(1.06)}60%{transform:scale(0.97)}100%{transform:scale(1)}}
@keyframes modal-success-ring-flare{0%{transform:scale(1);opacity:0.8}100%{transform:scale(2.4);opacity:0}}
@keyframes modal-check-draw{0%{stroke-dashoffset:40}100%{stroke-dashoffset:0}}
@keyframes modal-check-pop{0%{transform:scale(0);opacity:0}60%{transform:scale(1.2)}100%{transform:scale(1);opacity:1}}
@keyframes modal-green-pulse{0%,100%{box-shadow:0 0 20px rgba(16,185,129,0.3)}50%{box-shadow:0 0 40px rgba(16,185,129,0.55)}}

/* ── Modal — structural ── */
.db-modal-backdrop{
  position:fixed;top:0;left:0;right:0;bottom:0;
  background:rgba(11,31,51,0.65);backdrop-filter:blur(8px);
  display:flex;align-items:center;justify-content:center;
  z-index:999;animation:modal-backdrop-fade 0.4s cubic-bezier(0.4,0,0.2,1);
}
.db-modal-container{position:relative;width:90%;max-width:520px;max-height:90vh;overflow:visible;display:flex;align-items:center;justify-content:center;border-radius: 0px;}

.db-modal-card{
  background:#fff;border-radius: 0px;padding:36px 36px 32px;width:100%;overflow:hidden;
  box-shadow:0 32px 80px rgba(0,51,141,0.18),0 0 0 1px rgba(0,51,141,0.06);
  animation:modal-pop-up 0.5s cubic-bezier(0.34,1.56,0.64,1);
  transition:box-shadow 0.5s ease;
}
.db-modal-card.success{
  animation:modal-success-zoom 0.55s cubic-bezier(.34,1.56,.64,1) both;
  box-shadow:0 25px 100px rgba(16,185,129,0.25),0 0 1px rgba(16,185,129,0.15);
}

/* ── Modal — header ── */
.db-modal-header{text-align:center;margin-bottom:24px;animation:fade-in-up 0.6s ease 0.1s both;}
.db-modal-icon-wrap{position:relative;width:80px;height:80px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;animation:scale-in 0.5s ease 0.2s both;}
.db-modal-icon-bg{position:absolute;width:80px;height:80px;border-radius: 50%;background:linear-gradient(135deg,#EEF4FF,#E8F0FD);border:2px solid #C7D9F5;box-shadow:0 4px 20px rgba(0,94,184,0.1);transition:background 0.5s ease,border-color 0.5s ease,box-shadow 0.5s ease;}
.db-modal-icon-bg.success{background:linear-gradient(135deg,#ECFDF5,#D1FAE5);border-color:#6EE7B7;box-shadow:0 4px 20px rgba(16,185,129,0.15);animation:modal-green-pulse 2s ease-in-out infinite;}
.db-modal-icon-pulse{position:absolute;width:80px;height:80px;border-radius: 50%;border:2px solid #005EB8;animation:pulse-ring 1.8s ease-out infinite;transition:border-color 0.5s ease;}
.db-modal-icon-pulse.success{border-color:#10B981;}
.db-modal-icon-spin{position:absolute;width:70px;height:70px;border-radius: 50%;border:2.5px solid transparent;border-top-color:#0091DA;border-right-color:#005EB8;animation:spin-icon 2s linear infinite;transition:border-top-color 0.5s ease,border-right-color 0.5s ease;}
.db-modal-icon-spin.success{border-top-color:#10B981;border-right-color:#059669;}
.db-modal-success-ring-flare{position:absolute;width:80px;height:80px;border-radius: 50%;border:2.5px solid #10B981;animation:modal-success-ring-flare 0.9s ease-out forwards;}
.db-modal-icon-svg{position:relative;z-index:2;width:36px;height:36px;color:#005EB8;transition:color 0.4s ease;}
.db-modal-icon-svg.success{color:#059669;}
.db-modal-check{animation:modal-check-pop 0.5s cubic-bezier(.34,1.56,.64,1) both;}
.db-modal-check-path{stroke-dasharray:40;stroke-dashoffset:40;animation:modal-check-draw 0.45s ease 0.15s forwards;}

.db-modal-title{font-size:22px;font-weight:900;color:#00338D;letter-spacing:-0.4px;margin-bottom:8px;animation:fade-in-up 0.6s ease 0.3s both;transition:color 0.4s ease;}
.db-modal-title.success{color:#065F46;}
.db-modal-subtitle{font-size:13px;color:#8FA3BF;line-height:1.5;animation:fade-in-up 0.6s ease 0.4s both;transition:color 0.4s ease;}
.db-modal-subtitle.success{color:#059669;}

/* ── Modal — body ── */
.db-modal-body{margin-bottom:0;animation:fade-in-up 0.6s ease 0.5s both;}
.db-modal-tracker{margin-bottom:16px;}
.db-modal-phase-label{font-size:10.5px;font-weight:700;color:#8FA3BF;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;display:flex;align-items:center;gap:8px;}
.db-modal-phase-dot{width:8px;height:8px;border-radius: 50%;background:#005EB8;animation:eval-pulse 1.2s ease-in-out infinite;transition:background 0.4s ease;}
.db-modal-phase-dot.success{background:#10B981;}

.db-modal-progress-track{height:8px;background:#EDF1F7;border-radius: 0px;overflow:hidden;position:relative;}
.db-modal-progress-bar{height:100%;width:0%;background:linear-gradient(90deg,#00338D,#005EB8,#0091DA);border-radius: 0px;transition:width 0.5s cubic-bezier(0.4,0,0.2,1),background 0.5s ease,box-shadow 0.5s ease;box-shadow:0 2px 8px rgba(0,94,184,0.35);position:relative;overflow:hidden;}
.db-modal-progress-bar.success{background:linear-gradient(90deg,#059669,#10B981,#34D399);box-shadow:0 2px 8px rgba(16,185,129,0.4);}
@keyframes progress-shimmer-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(220%)}}
.db-modal-progress-bar::after{content:"";position:absolute;top:0;left:0;height:100%;width:40%;background:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.55) 50%,rgba(255,255,255,0) 100%);animation:progress-shimmer-sweep 1.4s ease-in-out infinite;}
.db-modal-progress-bar.success::after{animation:none;display:none;}

/* ── Live probe counter + rotating category chip ── */
@keyframes live-chip-cycle{0%{opacity:0;transform:translateY(4px)}15%{opacity:1;transform:translateY(0)}85%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-4px)}}
.db-modal-live-row{display:flex;align-items:center;justify-content:space-between;margin-top:8px;margin-bottom:2px;height:20px;}
.db-modal-live-count{font-size:11px;font-weight:700;color:#5A7090;font-variant-numeric:tabular-nums;}
.db-modal-live-chip-wrap{position:relative;height:18px;overflow:hidden;flex:1;margin-left:12px;text-align:right;}
.db-modal-live-chip{position:absolute;right:0;top:0;font-size:11px;font-weight:700;color:#005EB8;background:#EEF4FF;border:1px solid #C7D9F5;padding:1px 9px;border-radius:0;white-space:nowrap;animation:live-chip-cycle 1.1s ease both;}
.db-modal-live-dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:#0091DA;margin-right:6px;animation:eval-pulse 0.9s ease-in-out infinite;}

/* ── Modal — pipeline steps ── */
.db-modal-pipeline{display:flex;flex-direction:column;gap:0;margin-bottom:4px;}
.db-modal-step{display:flex;align-items:center;gap:14px;padding:9px 0;position:relative;}
.db-modal-step:not(:last-child)::after{content:'';position:absolute;left:11px;top:34px;width:2px;height:calc(100% - 14px);background:#E3EAF3;z-index:0;}
.db-modal-step.step-done:not(:last-child)::after{background:#BBF7D0;}
@keyframes step-pulse{0%,100%{box-shadow:0 0 0 0 rgba(0,94,184,0.28)}60%{box-shadow:0 0 0 6px rgba(0,94,184,0)}}
.db-modal-step-dot{width:24px;height:24px;border-radius: 50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;position:relative;z-index:1;transition:all 0.35s ease;}
.db-modal-step-dot.dot-pending{background:#F0F4FA;border:2px solid #E3EAF3;}
.db-modal-step-dot.dot-active{background:#EEF4FF;border:2px solid #005EB8;animation:step-pulse 1.6s ease-in-out infinite;}
.db-modal-step-dot.dot-done{background:#059669;border:2px solid #059669;}
.db-modal-step-dot-inner{width:8px;height:8px;border-radius: 50%;transition:background 0.3s ease;}
.db-modal-step-dot-inner.inner-pending{background:#C7D9F5;}
.db-modal-step-dot-inner.inner-active{background:#005EB8;}
.db-modal-step-text{flex:1;display:flex;flex-direction:column;gap:2px;}
.db-modal-step-label{font-size:13px;transition:color 0.3s ease,font-weight 0.1s;}
.db-modal-step-label.label-pending{color:#B0C0D4;font-weight:500;}
.db-modal-step-label.label-active{color:#00338D;font-weight:700;}
.db-modal-step-label.label-done{color:#5A7090;font-weight:500;}
.db-modal-step-detail{font-size:11px;color:#8FA3BF;line-height:1.4;font-weight:400;}
.db-modal-step-tag{font-size:10.5px;font-weight:700;letter-spacing:0.4px;transition:color 0.3s ease;flex-shrink:0;}
.db-modal-step-tag.tag-active{color:#005EB8;}
.db-modal-step-tag.tag-done{color:#059669;}
.db-modal-step-tag.tag-pending{color:transparent;}

/* ── Modal — message ── */
.db-modal-message{padding:14px 18px;background:#F7FAFF;border-radius: 0px;border:1.5px solid #E3EAF3;border-left:3px solid #005EB8;font-size:12.5px;color:#5A7090;line-height:1.65;transition:background 0.5s ease,border-left-color 0.5s ease,color 0.4s ease;}
.db-modal-message.success{background:#F0FFF8;border-color:#A7F3D0;border-left-color:#10B981;color:#065F46;}

/* ── Modal — dots ── */
.db-modal-dots{display:flex;gap:7px;justify-content:center;margin-top:20px;}
.db-modal-dot{width:7px;height:7px;border-radius: 50%;background:#C7D9F5;animation:dot-bounce 1.2s ease-in-out infinite;transition:background 0.4s ease;}
.db-modal-dot.success{background:#A7F3D0;}
.db-modal-dot:nth-child(2){animation-delay:0.15s}
.db-modal-dot:nth-child(3){animation-delay:0.3s}
.db-modal-dot:nth-child(4){animation-delay:0.45s}

@media(max-width:640px){
  .db-modal-card{padding:32px 24px;}
  .db-modal-title{font-size:20px;}
  .db-modal-stats{grid-template-columns:1fr;}
  .db-modal-container{width:95%;}
}
`;

// ─── Helper: score / risk color utilities ─────────────────────────────────────

const scoreColor = (s: number) =>
  s >= 75 ? "#059669"
  : s >= 50 ? "linear-gradient(90deg,#005EB8,#0091DA)"
  : "linear-gradient(90deg,#00338D,#005EB8)";

const scoreColorSolid = (s: number) =>
  s >= 75 ? "#059669" : s >= 50 ? "#3D5A8A" : "#00338D";

const scoreCls   = (s: number) => s >= 75 ? "green"   : s >= 50 ? "amber"   : "red";
const riskCls    = (r = "")   => r.toLowerCase().includes("low") ? "low" : r.toLowerCase().includes("high") ? "high" : "med";

// ─── PrincipleAccordion ───────────────────────────────────────────────────────

function PrincipleAccordion({ principle, score, findings }: {
  principle: string;
  score: number;
  findings: BlackBoxFinding[];
}) {
  const [open, setOpen] = useState(false);

  const hasHigh  = findings.some(f => f.severity === "High");
  const hasMed   = findings.some(f => f.severity === "Medium");
  const failCount = findings.length;
  const allPass  = failCount === 0;
  const worstSev = hasHigh ? "High" : hasMed ? "Medium" : "Low";
  const barColor = scoreColor(score);
  const cardCls  = hasHigh ? "has-high" : hasMed ? "has-issues" : allPass ? "all-pass" : "";

  const uniqueIssues = findings.reduce<BlackBoxFinding[]>((acc, f) => {
    if (!acc.find(a => a.issue === f.issue)) acc.push(f);
    return acc;
  }, []);

  return (
    <div className={`db-principle-card ${cardCls}`}>
      <div className="db-principle-header" onClick={() => setOpen(v => !v)}>
        <span className="db-principle-name">{principle}</span>
        <span className="db-principle-meta">
          {failCount > 0 && (
            <span className={`db-finding-sev ${worstSev.toLowerCase()}`} style={{ fontSize: 10, padding: "1px 7px" }}>
              {failCount} issue{failCount > 1 ? "s" : ""}
            </span>
          )}
          <span className={`db-principle-score-chip ${scoreCls(score)}`}>{score}</span>
          <span className={`db-principle-chevron${open ? " open" : ""}`}>▼</span>
        </span>
      </div>

      <div className="db-principle-bar-row">
        <div className="db-principle-bar-track">
          <div className="db-principle-bar-fill" style={{ width: `${Math.min(score, 100)}%`, background: barColor }} />
        </div>
      </div>

      {open && (
        <div className="db-principle-body">
          {allPass ? (
            <div className="db-principle-pass-note">All probes passed for this principle</div>
          ) : (
            uniqueIssues.map((f, idx) => (
              <div key={idx} className={`db-principle-finding ${f.severity === "High" ? "high" : f.severity === "Medium" ? "med" : ""}`}>
                <div className="db-principle-finding-top">
                  <span style={{ fontSize: 12, fontWeight: 700, color: f.severity === "High" ? "#00338D" : f.severity === "Medium" ? "#3D5A8A" : "#5A7090" }}>
                    {f.severity}
                  </span>
                </div>
                <div className="db-principle-finding-issue">{f.issue}</div>
                {f.recommendation && (
                  <div className="db-principle-finding-rec">Recommendation: {f.recommendation}</div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── BlackBoxSummary ──────────────────────────────────────────────────────────

function BlackBoxSummary({ result, tab, onRedo }: {
  result: BlackBoxResult;
  tab: string;
  onRedo: () => void;
}) {
  const sc     = scoreColor(result.overall_score);
  const scText = scoreColorSolid(result.overall_score);
  const cls    = scoreCls(result.overall_score);

  const modeLabel = tab === "chat"
    ? `${result.probes_run} conversation turns parsed`
    : `${result.probes_run} governance probes executed`;

  const principleEntries = result.category_scores ? Object.entries(result.category_scores) : [];
  const findingsByPrinciple: Record<string, BlackBoxFinding[]> = {};
  (result.findings ?? []).forEach(f => {
    if (!findingsByPrinciple[f.category]) findingsByPrinciple[f.category] = [];
    findingsByPrinciple[f.category].push(f);
  });

  const totalIssues      = result.findings?.length ?? 0;
  const highIssues       = result.findings?.filter(f => f.severity === "High").length ?? 0;
  const passedPrinciples = principleEntries.filter(([, s]) => (s as number) >= 75).length;

  return (
    <div className="db-card done">
      <div className="db-done-row">
        <div>
          <div className="db-card-h">Black Box Audit Complete</div>
          <div style={{ fontSize: 12, color: "#8FA3BF", marginTop: 2 }}>{modeLabel}</div>
        </div>
        <button className="db-redo" onClick={onRedo}>Redo</button>
      </div>

      <div className="db-big-score">
        <div className="db-big-score-num" style={{ color: scText }}>{result.overall_score}</div>
        <div className="db-big-score-right">
          <div className="db-big-score-label">Governance Score</div>
          <div className="db-big-score-bar">
            <div className="db-big-score-fill" style={{ width: `${Math.min(result.overall_score, 100)}%`, background: sc }} />
          </div>
        </div>
      </div>

      <div className="db-kv">
        <div className="db-kv-row">
          <span className="db-kv-k">Overall governance score</span>
          <span className={`db-kv-v ${cls}`} style={{ color: scText }}>{result.overall_score} / 100</span>
        </div>
        <div className="db-kv-row">
          <span className="db-kv-k">Risk level</span>
          <span className={`db-badge ${riskCls(result.risk_level)}`}>{result.risk_level} Risk</span>
        </div>
        <div className="db-kv-row">
          <span className="db-kv-k">Principles passing (≥75)</span>
          <span className={`db-kv-v ${passedPrinciples === principleEntries.length ? "green" : "amber"}`}>
            {passedPrinciples} / {principleEntries.length}
          </span>
        </div>
        <div className="db-kv-row">
          <span className="db-kv-k">Issues found</span>
          <span className="db-kv-v">
            {totalIssues === 0
              ? <span style={{ color: "#276749" }}>None</span>
              : (
                <>
                  {highIssues > 0 && <span style={{ color: "#00338D", fontWeight: 700 }}>{highIssues} High</span>}
                  {highIssues > 0 && totalIssues - highIssues > 0 && <span style={{ color: "#8FA3BF" }}> · </span>}
                  {totalIssues - highIssues > 0 && <span style={{ color: "#3D5A8A" }}>{totalIssues - highIssues} Medium/Low</span>}
                </>
              )}
          </span>
        </div>
      </div>

      {principleEntries.length > 0 && (
        <>
          <div className="db-section-lbl" style={{ marginTop: 18 }}>
            Results by KPMG Principle — click to expand
          </div>
          <div className="db-principle-list">
            {principleEntries.map(([principle, s]) => (
              <PrincipleAccordion
                key={principle}
                principle={principle}
                score={s as number}
                findings={findingsByPrinciple[principle] ?? []}
              />
            ))}
          </div>
        </>
      )}

      {tab === "chat" && (
        <div className="db-info" style={{ marginTop: 12 }}>
          Chat history ingested into the SDCC pipeline. Proceed to Step 4 to run the full governance evaluation.
        </div>
      )}
    </div>
  );
}

// ─── SdccSummaryPanel ─────────────────────────────────────────────────────────

function SdccSummaryPanel({ summary, onRedo }: { summary: SdccSummary; onRedo: () => void }) {
  const qColor  = scoreColor(summary.data_quality_score);
  const qCls    = scoreCls(summary.data_quality_score);
  const riskClsFn = (r = "") => r.toLowerCase().includes("low") ? "green" : r.toLowerCase().includes("high") ? "red" : "amber";

  const schemaFields = [
    { label: "task_id", ok: summary.has_task_id_col !== false },
    { label: "input",   ok: summary.has_input_col   !== false },
    { label: "output",  ok: summary.has_output_col  !== false },
    { label: "latency", ok: summary.has_latency_col !== false },
  ];

  return (
    <div className="db-card done">
      <div className="db-done-row">
        <div>
          <div className="db-card-h">Logs Ingested — SDCC Complete</div>
          <div style={{ fontSize: 12, color: "#8FA3BF", marginTop: 2 }}>
            Structural & Data Completeness Check ran across your inference logs
          </div>
        </div>
        <button className="db-redo" onClick={onRedo}>Upload New</button>
      </div>

      <div className="db-big-score">
        <div className="db-big-score-num" style={{ color: qColor }}>{summary.data_quality_score}%</div>
        <div className="db-big-score-right">
          <div className="db-big-score-label">Data Quality Score</div>
          <div className="db-big-score-bar">
            <div className="db-big-score-fill" style={{ width: `${summary.data_quality_score}%`, background: qColor }} />
          </div>
        </div>
      </div>

      <div className="db-section-lbl">Log Details</div>
      <div className="db-kv">
        <div className="db-kv-row">
          <span className="db-kv-k">Rows ingested</span>
          <span className="db-kv-v">{summary.logs_ingested.toLocaleString()} inference records</span>
        </div>
        <div className="db-kv-row">
          <span className="db-kv-k">Detected model type</span>
          <span className="db-kv-v">
            {summary.model_type?.replace(/_/g, " ") || "Unknown"}
            {summary.detection_confidence ? ` (${Math.round(summary.detection_confidence * 100)}% confidence)` : ""}
          </span>
        </div>
        <div className="db-kv-row">
          <span className="db-kv-k">Structural risk</span>
          <span className={`db-kv-v ${riskClsFn(summary.structural_risk)}`}>{summary.structural_risk || "Unknown"}</span>
        </div>
        <div className="db-kv-row">
          <span className="db-kv-k">Data quality</span>
          <span className={`db-kv-v ${qCls}`}>
            {summary.data_quality_score}% — {qCls === "green" ? "Good" : qCls === "amber" ? "Moderate" : "Poor"}
          </span>
        </div>
      </div>

      <div className="db-section-lbl">Schema Coverage</div>
      <div style={{ fontSize: 12.5, color: "#5A7090", marginBottom: 8, lineHeight: 1.5 }}>
        These are the columns we look for in your logs. Missing columns reduce evaluation accuracy.
      </div>
      <div className="db-schema">
        {schemaFields.map(f => (
          <span key={f.label} className={`db-schema-pill ${f.ok ? "ok" : "miss"}`}>
            {f.label}
          </span>
        ))}
      </div>

      {summary.column_warnings && summary.column_warnings.length > 0 && (
        <div className="db-warn">
          <strong>Column warnings:</strong> {summary.column_warnings.join(" · ")}
        </div>
      )}

      {summary.recommendation && (
        <>
          <div className="db-section-lbl">Recommendation</div>
          <div className="db-info" style={{ marginTop: 0 }}>{summary.recommendation}</div>
        </>
      )}
    </div>
  );
}

// ─── BlackBoxModal ────────────────────────────────────────────────────────────

function BlackBoxModal({ isOpen, isChat, progress, phase, tier }: {
  isOpen: boolean;
  isChat: boolean;
  progress: number;
  phase: number;
  tier: "dev" | "standard" | "thorough";
}) {
  const isDone = progress >= 100;

  // Cycles a "currently testing: X" chip through the TAF principles while
  // running, purely cosmetic — makes the wait feel active rather than stalled.
  const [liveCatIdx, setLiveCatIdx] = useState(0);
  useEffect(() => {
    if (isDone || !isOpen) return;
    const id = setInterval(() => setLiveCatIdx(i => (i + 1) % BB_LIVE_CATEGORIES.length), 1100);
    return () => clearInterval(id);
  }, [isDone, isOpen]);

  const totalProbes = BB_TOTAL_PROBES[tier] ?? BB_TOTAL_PROBES.standard;
  const liveProbeCount = Math.min(totalProbes, Math.round((Math.min(progress, 100) / 100) * totalProbes));

  if (!isOpen) return null;

  // Shorthand: append "success" class when done
  const sc = (base: string) => isDone ? `${base} success` : base;

  return (
    <div className="db-modal-backdrop">
      <div className="db-modal-container">
        <div className={sc("db-modal-card")}>

          {/* ── Header ── */}
          <div className="db-modal-header">
            <div className="db-modal-icon-wrap">
              <div className={sc("db-modal-icon-bg")} />
              <div className={sc("db-modal-icon-pulse")} />

              {/* Flare ring on success */}
              {isDone && <div className="db-modal-success-ring-flare" />}

              {/* Spinner → hidden on success */}
              {!isDone && <div className="db-modal-icon-spin" />}

              {/* Icon: shield while loading → checkmark on done */}
              {isDone ? (
                <svg
                  className={sc("db-modal-icon-svg db-modal-check")}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline className="db-modal-check-path" points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg
                  className="db-modal-icon-svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              )}
            </div>

            <div className={sc("db-modal-title")}>
              {isDone
                ? "Audit Complete"
                : isChat ? "Parsing Chat History" : "Running Black Box Audit"}
            </div>
            <div className={sc("db-modal-subtitle")}>
              {isDone
                ? "All governance probes completed successfully. Processing results…"
                : isChat
                  ? "Extracting conversation turns and ingesting into the evaluation pipeline…"
                  : "Firing governance probes and analyzing AI behavior across multiple dimensions…"}
            </div>
          </div>

          {/* ── Body ── */}
          <div className="db-modal-body">

            {/* Progress bar */}
            {!isChat && (
              <div className="db-modal-tracker">
                <div className="db-modal-phase-label">
                  <div className={sc("db-modal-phase-dot")} />
                  {isDone ? "Complete" : "In Progress"}
                </div>
                <div className="db-modal-progress-track">
                  <div
                    className={sc("db-modal-progress-bar")}
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </div>
                {!isDone && (
                  <div className="db-modal-live-row">
                    <span className="db-modal-live-count">Probe {liveProbeCount} of ~{totalProbes}</span>
                    <div className="db-modal-live-chip-wrap">
                      <span key={liveCatIdx} className="db-modal-live-chip">
                        <span className="db-modal-live-dot" />
                        Testing: {BB_LIVE_CATEGORIES[liveCatIdx]}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Pipeline steps — accurate to unified_pipeline.py */}
            {!isChat && (() => {
              // Probe totals derived from audit_config.py expected_probe_count():
              //   GAI only (22 probe-testable controls):
              //     dev:      8 fp + 22 cp + 0 af  = ~30  + build-risk if applicable
              //     standard: 22 fp + 66 cp + 15 af = ~103 + build-risk if applicable
              //     thorough: 36 fp + 132 cp + 45 af = ~213 + build-risk if applicable
              //   With all 5 categories (36 probe-testable):
              //     dev: ~44, standard: ~157, thorough: ~297
              //   Mid-point estimates (2-3 extra categories typical):

              return (
                <div className="db-modal-pipeline">
                  {BB_LOADER_PHASES.map((ph, i) => {
                    const stepDone   = isDone || i < phase;
                    const stepActive = !isDone && i === phase;
                    const stepState  = stepDone ? "step-done" : stepActive ? "step-active" : "step-pending";
                    return (
                      <div key={ph.label} className={`db-modal-step ${stepState}`}>
                        <div className={`db-modal-step-dot ${stepDone ? "dot-done" : stepActive ? "dot-active" : "dot-pending"}`}>
                          {stepDone ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <div className={`db-modal-step-dot-inner ${stepActive ? "inner-active" : "inner-pending"}`} />
                          )}
                        </div>
                        <div className="db-modal-step-text">
                          <span className={`db-modal-step-label ${stepDone ? "label-done" : stepActive ? "label-active" : "label-pending"}`}>
                            {ph.label}
                          </span>
                          {(stepActive || stepDone) && (
                            <span className="db-modal-step-detail">{ph.detail}</span>
                          )}
                        </div>
                        <span className={`db-modal-step-tag ${stepDone ? "tag-done" : stepActive ? "tag-active" : "tag-pending"}`}>
                          {stepDone ? "Done" : stepActive ? "Running" : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Phase-aware message */}
            <div className={sc("db-modal-message")} style={{ marginTop: 16 }}>
              {isDone
                ? "All probes completed. Computing governance scores…"
                : isChat
                    ? "This typically takes 30–60 seconds. Please wait while we parse your conversation."
                    : phase === 0
                        ? "Synthesizing fingerprint probes and firing them at the live AI — reconciling responses against your registration profile and system prompt."
                        : phase === 1
                            ? "Running 50 broad governance probes across all 10 KPMG principles in 5 batches of 10. This is the longest phase."
                            : phase === 2
                                ? "Probing all applicable TAF taxonomy controls — Groq synthesizes adversarial prompts tailored to this system."
                                : phase === 3
                                    ? "Running 10 maximally adversarial probes on failing principles only. Hardest probes in the audit."
                                    : "Computing principle scores, classifying findings, and saving probe logs to CSV."}
            </div>

            {/* Animated dots */}
            <div className="db-modal-dots">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={sc("db-modal-dot")} />
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── SectionHeader ────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, subtitle, done, optional }: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  done: boolean;
  optional?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      {icon}
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#0B1F33", letterSpacing: "-0.2px" }}>
          {title}
          {done && (
            <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 0, background: "#F0FDF4", color: "#059669", border: "1px solid #A7F3D0" }}>
              Complete
            </span>
          )}
          {optional && (
            <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 0, background: "#F5F8FC", color: "#7A90AB", border: "1px solid #E3EAF3" }}>
              {optional}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "#7A90AB", marginTop: 2 }}>{subtitle}</div>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();
  const aiName = localStorage.getItem("activeAI") || "";

  // Black Box state
  const [bbTab, setBbTab]               = useState<"api" | "ui" | "chat">("api");
  const [bbEndpoint, setBbEndpoint]     = useState("");
  const [bbApiKey, setBbApiKey]         = useState("");
  const [bbUiUrl, setBbUiUrl]           = useState("");
  const [bbChatText, setBbChatText]     = useState("");
  const [bbChatSrc, setBbChatSrc]       = useState("chatgpt");
  const [bbLoading, setBbLoading]       = useState(false);
  const [bbResult, setBbResult]         = useState<BlackBoxResult | null>(null);
  const [bbError, setBbError]           = useState("");
  const [bbProgress, setBbProgress]     = useState(0);
  const [bbLoaderPhase, setBbLoaderPhase] = useState(0);
  const [bbDone, setBbDone]             = useState(false);
  // Effort tier for the unified taxonomy-seeded pipeline
  const [bbTier, setBbTier]             = useState<"dev" | "standard" | "thorough">("standard");
  const [depthInfoOpen, setDepthInfoOpen] = useState(false);

  // Log ingestion state
  const [file, setFile]                     = useState<File | null>(null);
  const [ingestLoading, setIngestLoading]   = useState(false);
  const [sdccSummary, setSdccSummary]       = useState<SdccSummary | null>(null);
  const [ingestError, setIngestError]       = useState("");
  const [logsDone, setLogsDone]             = useState(false);

  // Knowledge base state
  const [kbFiles, setKbFiles]       = useState<FileList | null>(null);
  const [kbLoading, setKbLoading]   = useState(false);
  const [kbSuccess, setKbSuccess]   = useState(false);
  const [kbChunks, setKbChunks]     = useState<number | null>(null);
  const [kbChunkList, setKbChunkList] = useState<{ chunk_index: number; content: string; source: string | null }[] | null>(null);
  const [kbListOpen, setKbListOpen] = useState(false);
  const [kbListLoading, setKbListLoading] = useState(false);
  const [kbError, setKbError]       = useState("");
  const [kbDone, setKbDone]         = useState(false);

  // Training data state (Section 3b — TAF taxonomy unlock)
  const [trainingFile,      setTrainingFile]     = useState<File | null>(null);
  const [trainingType,      setTrainingType]     = useState("fine_tuning");
  const [trainingLoading,   setTrainingLoading]  = useState(false);
  const [trainingError,     setTrainingError]    = useState("");
  const [trainingDone,      setTrainingDone]     = useState(false);
  const [trainingDataId,    setTrainingDataId]   = useState<string | undefined>();
  const [trainingAnalysis,  setTrainingAnalysis] = useState<any>(null);

  // Evaluation state
  const [evalLoading, setEvalLoading]     = useState(false);
  const [evalError, setEvalError]         = useState("");
  const [computationNotes, setComputationNotes] = useState<Record<string, ComputationNote> | null>(null);

  const uploaded   = logsDone || bbDone;
  const extractErr = (e: any) => e?.response?.data?.detail || e?.message || "Operation failed.";

  // ── Restore evaluation progress for this AI ──────────────────────────────
  // bbDone/logsDone/etc. are plain component state, so without this, refreshing
  // the page or navigating away and back to Dashboard resets them to false —
  // the "Run Full Governance Evaluation" button silently disables again even
  // though Step 1/2 was already completed for this AI system.
  useEffect(() => {
    if (!aiName) return;
    try {
      const saved = sessionStorage.getItem(`evalProgress:${aiName}`);
      if (!saved) return;
      const p = JSON.parse(saved);
      if (p.bbDone)           setBbDone(true);
      if (p.logsDone)         setLogsDone(true);
      if (p.sdccSummary)      setSdccSummary(p.sdccSummary);
      if (p.bbResult)         setBbResult(p.bbResult);
      if (p.kbDone)           setKbDone(true);
      if (p.kbChunks != null) setKbChunks(p.kbChunks);
    } catch { /* corrupt/missing progress — safe to ignore, user just redoes Step 1/2 */ }
  }, [aiName]);

  // ── Persist evaluation progress whenever it changes ──────────────────────
  useEffect(() => {
    if (!aiName) return;
    if (!bbDone && !logsDone && !kbDone) return; // nothing worth saving yet
    try {
      sessionStorage.setItem(`evalProgress:${aiName}`, JSON.stringify({
        bbDone, logsDone, sdccSummary, bbResult, kbDone, kbChunks,
      }));
    } catch { /* sessionStorage full/unavailable — evaluation still works this session, just won't survive a refresh */ }
  }, [aiName, bbDone, logsDone, sdccSummary, bbResult, kbDone, kbChunks]);

  // Phase cycling — this build's backend responds almost instantly (no real
  // LLM/network latency, see offline_engine.py), so pacing here is a fixed,
  // deliberately-slowed schedule rather than a real elapsed-time estimate —
  // tuned so the modal always visibly walks through all 5 phases over a
  // realistic-feeling ~8.7s, regardless of tier or how fast the backend
  // actually answers.
  const OFFLINE_PHASE_DURATIONS_MS = [900, 4700, 1700, 800, 400]; // sums to 8500ms
  const OFFLINE_TOTAL_DURATION_MS  = OFFLINE_PHASE_DURATIONS_MS.reduce((a, b) => a + b, 0);
  const PHASE_DURATIONS_MS = OFFLINE_PHASE_DURATIONS_MS;
  useEffect(() => {
    if (!bbLoading || bbTab === "chat") return;
    setBbLoaderPhase(0);
    let phase = 0;
    const advance = () => {
      phase = Math.min(phase + 1, BB_LOADER_PHASES.length - 1);
      setBbLoaderPhase(phase);
      if (phase < BB_LOADER_PHASES.length - 1) {
        t = setTimeout(advance, PHASE_DURATIONS_MS[phase]);
      }
    };
    let t = setTimeout(advance, PHASE_DURATIONS_MS[0]);
    return () => clearTimeout(t);
  }, [bbLoading, bbTab]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleBlackBox = async () => {
    if (bbTab === "api"  && !bbApiKey)           { setBbError("Provide an API key."); return; }
    if (bbTab === "ui"   && !bbUiUrl)             { setBbError("Provide the deployed UI URL."); return; }
    if (bbTab === "chat" && !bbChatText.trim())   { setBbError("Paste your chat history first."); return; }

    setBbLoading(true);
    setBbError("");
    setBbResult(null);
    setBbProgress(0);

    if (bbTab === "chat") {
      try {
        const res = await ingestChatHistory(aiName || "external-ai", bbChatText, bbChatSrc);
        setSdccSummary(res.data);
        setLogsDone(true);
        setBbDone(true);
        setBbResult({
          audit_id: "chat", ai_name: aiName, mode: "chat", status: "completed",
          overall_score: res.data.data_quality_score ?? 0,
          risk_level: res.data.structural_risk ?? "Unknown",
          probes_run: res.data.turns_parsed ?? 0,
          category_scores: {}, findings: [],
        });
      } catch (e: any) {
        setBbError(extractErr(e));
      } finally {
        setBbLoading(false);
      }
      return;
    }

    // Progress bar — smoothly climbs over OFFLINE_TOTAL_DURATION_MS regardless
    // of how fast the backend actually answers (see the phase-cycling note
    // above for why: this build's audit pipeline has no real network latency
    // to pace against, so real-time /progress polling would jump straight to
    // ~100% within the first tick instead of animating).
    const startedAt = Date.now();
    const iv = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const pct = Math.min(92, (elapsed / OFFLINE_TOTAL_DURATION_MS) * 92);
      setBbProgress(pct);
    }, 80);

    try {
      const res = await runBlackBoxAudit({
        ai_name: aiName || "external-ai",
        mode: bbTab,
        endpoint: bbEndpoint,
        api_key: bbApiKey,
        ui_url: bbUiUrl,
        tier: bbTier,   // "dev" | "standard" | "thorough"
      });
      clearInterval(iv);

      // Hold at the current (near-92%) progress until the full animated
      // schedule has actually played out, so a near-instant backend response
      // never causes the modal to skip straight from Fingerprint to Complete.
      const remaining = OFFLINE_TOTAL_DURATION_MS - (Date.now() - startedAt);
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));

      setBbProgress(100);
      setBbResult(res.data);
      setBbDone(true);

      // Auto-ingest probe results into SDCC
      let probes: any[] = res.data?.probe_results ?? [];
      // probe_results may come back as a JSON string from Postgres JSONB — parse it
      if (typeof probes === "string") {
        try { probes = JSON.parse(probes); } catch { probes = []; }
      }
      if (!Array.isArray(probes)) probes = [];
      if (probes.length > 0 && aiName) {
        try {
          const esc  = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
          const rows = probes.map((p: any) => [
            esc(p.probe_id || p.task_id || ""),
            esc(p.prompt   || p.input   || ""),
            esc(p.response || p.output  || ""),
            p.latency_ms || 0,
          ].join(","));
          const csv  = ["task_id,input,output,latency", ...rows].join("\n");
          const blob = new Blob([csv], { type: "text/csv" });
          const ir   = await sdccIngest(aiName, new File([blob], "bb_autoingest.csv", { type: "text/csv" }));
          setSdccSummary(ir.data);
          setLogsDone(true);
        } catch (autoErr: any) {
          console.warn("[auto-ingest] SDCC auto-ingest failed:", autoErr?.response?.data || autoErr?.message || autoErr);
        }
      }
    } catch (e: any) {
      clearInterval(iv);
      setBbProgress(0);
      setBbError(extractErr(e));
    } finally {
      setBbLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!aiName) { navigate("/register-ai"); return; }
    if (!file)   { setIngestError("Select a file first."); return; }
    setIngestLoading(true);
    setIngestError("");
    setSdccSummary(null);
    try {
      const res = await sdccIngest(aiName, file);
      setSdccSummary(res.data);
      setLogsDone(true);
    } catch (e) {
      setIngestError(extractErr(e));
    } finally {
      setIngestLoading(false);
    }
  };

  const handleTrainingUpload = async () => {
    if (!trainingFile || !aiName) return;
    setTrainingLoading(true);
    setTrainingError("");
    try {
      const r = await uploadTrainingData(aiName, trainingFile, trainingType);
      setTrainingDataId(r.data.training_data_id);
      setTrainingAnalysis(r.data.analysis_summary);
      setTrainingDone(true);
    } catch (err: any) {
      setTrainingError(err.response?.data?.detail || "Training data upload failed.");
    } finally {
      setTrainingLoading(false);
    }
  };

  const handleKb = async () => {
    if (!aiName || !kbFiles?.length) { setKbError("Select at least one file."); return; }
    setKbLoading(true);
    setKbError("");
    setKbSuccess(false);
    try {
      const res = await uploadKnowledgeBase(aiName, Array.from(kbFiles));
      setKbChunks(res.data?.chunks_stored ?? null);
      setKbSuccess(true);
      setKbDone(true);
      setKbChunkList(null);   // stale until re-fetched — the KB was just replaced
      setKbListOpen(false);
    } catch (e: any) {
      setKbError(extractErr(e));
    } finally {
      setKbLoading(false);
    }
  };

  const handleViewKbChunks = async () => {
    if (kbListOpen) { setKbListOpen(false); return; }
    setKbListOpen(true);
    if (kbChunkList || !aiName) return;   // already loaded
    setKbListLoading(true);
    try {
      const res = await getKbChunks(aiName);
      setKbChunkList(res.data?.chunks ?? []);
    } catch {
      setKbChunkList([]);
    } finally {
      setKbListLoading(false);
    }
  };

  const handleEvaluate = async () => {
    if (!uploaded) return;
    setEvalLoading(true);
    setEvalError("");
    try {
      const res = await evaluateAI(aiName);
      if (res.data.computation_notes) setComputationNotes(res.data.computation_notes);
      sessionStorage.setItem("lastReportData", JSON.stringify(res.data));

      // Auto-trigger TAF taxonomy mapping after successful evaluation
      // (fire-and-forget — don't block navigation)
      try {
        const { computeTafAssessment } = await import("../services/api");
        await computeTafAssessment(aiName, trainingDataId);
      } catch {
        // TAF assessment is non-blocking — report still navigates on failure
      }

      navigate("/audit-overview", { state: { data: res.data } });
    } catch (e) {
      setEvalError(extractErr(e));
    } finally {
      setEvalLoading(false);
    }
  };

  // ── Section icon helper ────────────────────────────────────────────────────

  const stepIcon = (done: boolean, active: boolean, children: React.ReactNode) => (
    <div style={{
      width: 34, height: 34, borderRadius: 0, flexShrink: 0,
      background: done ? "linear-gradient(135deg,#00A3A1,#0091DA)" : active ? "linear-gradient(135deg,#00338D,#005EB8)" : "linear-gradient(135deg,#4B5E78,#7A90AB)",
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 2px 8px rgba(0,51,141,0.2)",
      opacity: 1,
      transition: "background 0.4s ease",
    }}>
      {children}
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  const handleLogout = () => { localStorage.removeItem("token"); localStorage.removeItem("activeAI"); navigate("/login"); };

  return (
    <div className="db">
      <style>{CSS}</style>

      {/* ── Nav bar ──────────────────────────────────────────────────────────── */}
      <nav style={{ background:"#fff", borderBottom:"1px solid #E3EAF3", height:62, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 32px", position:"sticky", top:0, zIndex:100, boxShadow:"0 1px 12px rgba(0,51,141,0.05)", fontFamily:"'Plus Jakarta Sans',sans-serif" }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <span style={{ fontSize:17, fontWeight:900, color:"#00338D", letterSpacing:"-0.4px" }}>TrustShield AI</span>
          {aiName && (
            <>
              <div style={{ width:1, height:18, background:"#E3EAF3" }} />
              <span style={{ background:"#EEF4FF", border:"1px solid #C7D9F5", color:"#005EB8", fontSize:11.5, fontWeight:700, padding:"4px 12px", borderRadius:0 }}>{aiName}</span>
            </>
          )}
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <button onClick={() => navigate("/register-ai")} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:0, fontSize:13, fontWeight:600, cursor:"pointer", border:"1.5px solid #E3EAF3", background:"#fff", color:"#5A7090", fontFamily:"inherit", transition:"all 0.2s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor="#005EB8"; (e.currentTarget as HTMLButtonElement).style.color="#005EB8"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor="#E3EAF3"; (e.currentTarget as HTMLButtonElement).style.color="#5A7090"; }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New AI
          </button>
          <button onClick={() => navigate("/profile")} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:0, fontSize:13, fontWeight:600, cursor:"pointer", border:"1.5px solid #E3EAF3", background:"#fff", color:"#5A7090", fontFamily:"inherit", transition:"all 0.2s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor="#005EB8"; (e.currentTarget as HTMLButtonElement).style.color="#005EB8"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor="#E3EAF3"; (e.currentTarget as HTMLButtonElement).style.color="#5A7090"; }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Profile
          </button>
          <button onClick={handleLogout} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:0, fontSize:13, fontWeight:600, cursor:"pointer", border:"1.5px solid #FED7D7", background:"#FFF5F5", color:"#C53030", fontFamily:"inherit", transition:"all 0.2s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background="#FEE2E2"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background="#FFF5F5"; }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Log out
          </button>
        </div>
      </nav>

      {/* Loading modal */}
      <BlackBoxModal
        isOpen={bbLoading}
        isChat={bbTab === "chat"}
        progress={bbProgress}
        phase={bbLoaderPhase}
        tier={bbTier}
      />

      <div className="db-body">
        <div className="db-page-title">Audit Pipeline{aiName ? ` — ${aiName}` : ""}</div>
        <div className="db-page-sub">Run a full governance evaluation on your AI agent. Complete each section below.</div>

        <div className="db-steps">

          {/* ══════════════════════════════════════════
              SECTION 1 — BEHAVIOURAL PROBING
          ══════════════════════════════════════════ */}
          <div className="db-step">
            <div className="db-step-body">
              <SectionHeader
                icon={stepIcon(bbDone, true, (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                ))}
                title="Behavioural Probing"
                subtitle={aiName
                  ? `Fire governance probes at ${aiName} to test real-world behaviour across safety, fairness, and transparency`
                  : "Connect your AI agent and fire governance probes to test real-world behaviour"}
                done={bbDone}
              />

              {bbDone && bbResult ? (
                <BlackBoxSummary
                  result={bbResult}
                  tab={bbTab}
                  onRedo={() => { setBbDone(false); setBbResult(null); setBbProgress(0); }}
                />
              ) : (
                <div className="db-card active">
                  <div className="db-card-h">Black Box Audit</div>
                  <div className="db-card-d">
                    Connect your AI via API endpoint, deployed URL, or paste a chat history. Governance probes are fired automatically and responses are ingested into the SDCC pipeline.
                  </div>

                  {/* Tabs */}
                  <div className="db-tabs">
                    {(["api", "ui", "chat"] as const).map(t => (
                      <button
                        key={t}
                        type="button"
                        className={`db-tab${bbTab === t ? " on" : ""}`}
                        onClick={() => { setBbTab(t); setBbError(""); }}
                      >
                        {t === "api" ? "API Key" : t === "ui" ? "Deployed URL" : "Chat History"}
                      </button>
                    ))}
                  </div>

                  {/* Tab: API */}
                  {bbTab === "api" && (
                    <>
                      <div className="db-field">
                        <div className="db-lbl">API Key <span style={{ fontWeight: 400, color: "#8FA3BF" }}>(any provider)</span></div>
                        <input
                          className="db-inp"
                          type="password"
                          placeholder="Paste your API key here"
                          value={bbApiKey}
                          onChange={e => setBbApiKey(e.target.value)}
                          disabled={bbLoading}
                          autoComplete="new-password"
                        />
                        {bbApiKey && (
                          <div style={{ marginTop: 5, fontSize: 11, color: "#059669", fontWeight: 600 }}>
                            {bbApiKey.startsWith("gsk_") || bbApiKey.startsWith("sk-ant-") || bbApiKey.startsWith("sk-or-") || bbApiKey.startsWith("sk-")
                              ? "API key detected — endpoint will be resolved automatically"
                              : "API key detected — provide your endpoint below"}
                          </div>
                        )}
                      </div>
                      <div className="db-field">
                        <div className="db-lbl">API Endpoint <span style={{ fontWeight: 400, color: "#8FA3BF" }}>(optional — auto-resolved for known providers)</span></div>
                        <input
                          className="db-inp"
                          type="url"
                          placeholder="Leave blank if your provider is auto-detected, or paste a custom endpoint"
                          value={bbEndpoint}
                          onChange={e => setBbEndpoint(e.target.value)}
                          disabled={bbLoading}
                          autoComplete="off"
                        />
                      </div>
                      <div className="db-info" style={{ fontSize: 11 }}>
                        Supports all major AI providers and any OpenAI-compatible API. Enterprise APIs with custom endpoints are fully supported.
                      </div>
                    </>
                  )}

                  {/* Tab: UI */}
                  {bbTab === "ui" && (
                    <>
                      <div className="db-field">
                        <div className="db-lbl">Deployed UI URL</div>
                        <input
                          className="db-inp"
                          type="url"
                          placeholder="https://your-chatbot.vercel.app"
                          value={bbUiUrl}
                          onChange={e => setBbUiUrl(e.target.value)}
                          disabled={bbLoading}
                        />
                      </div>
                      <div className="db-info">
                        The backend opens a headless browser, navigates to your URL, and runs governance probes automatically. The URL must be publicly accessible.
                      </div>
                    </>
                  )}

                  {/* Tab: Chat */}
                  {bbTab === "chat" && (
                    <>
                      <div className="db-field">
                        <div className="db-lbl">Source</div>
                        <select
                          className="db-inp"
                          value={bbChatSrc}
                          onChange={e => setBbChatSrc(e.target.value)}
                          style={{ cursor: "pointer" }}
                        >
                          <option value="chatgpt">ChatGPT</option>
                          <option value="claude">Claude</option>
                          <option value="gemini">Gemini</option>
                          <option value="copilot">Microsoft Copilot</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div className="db-field">
                        <div className="db-lbl">Paste Chat History</div>
                        <textarea
                          className="db-ta"
                          placeholder={"You\nWhat is the capital of France?\n\nChatGPT\nThe capital of France is Paris."}
                          value={bbChatText}
                          onChange={e => setBbChatText(e.target.value)}
                          disabled={bbLoading}
                        />
                      </div>
                      <div className="db-info">
                        Open any AI chat, select all the conversation text, copy and paste it here. We'll parse the turns and run a full governance audit.
                      </div>
                    </>
                  )}

                  {/* Error */}
                  {bbError && (
                    <div style={{ marginTop: 10, padding: "11px 14px", background: "#EEF4FF", border: "1.5px solid #C7D9F5", borderLeft: "3px solid #005EB8", borderRadius: 0, fontSize: 13, color: "#00338D", display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>
                        {bbError}
                        {(bbError.toLowerCase().includes("token") || bbError.toLowerCase().includes("invalid") || bbError.toLowerCase().includes("auth") || bbError.toLowerCase().includes("401")) && (
                          <span style={{ display: "block", marginTop: 4, fontSize: 11.5, color: "#3D5A8A", fontWeight: 500 }}>
                            Check that your API key is correct and has not expired. For Groq, generate a new key at console.groq.com.
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  {/* ── Audit depth selector (API mode only) ── */}
                  {bbTab === "api" && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, position: "relative" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#7A90A8", letterSpacing: "1px", textTransform: "uppercase" }}>
                          Audit depth
                        </div>
                        <div
                          onMouseEnter={() => setDepthInfoOpen(true)}
                          onMouseLeave={() => setDepthInfoOpen(false)}
                          onClick={() => setDepthInfoOpen(o => !o)}
                          style={{
                            width: 15, height: 15, borderRadius: "50%", flexShrink: 0,
                            background: depthInfoOpen ? "#005EB8" : "#DDE5EF",
                            color: depthInfoOpen ? "#fff" : "#64748B",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 10, fontWeight: 800, fontStyle: "italic", cursor: "pointer",
                            transition: "all 0.15s", userSelect: "none",
                          }}
                          role="button"
                          aria-label="What does audit depth mean?"
                        >
                          i
                        </div>
                        {depthInfoOpen && (
                          <div style={{
                            position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 20,
                            width: 300, padding: "12px 14px", background: "#0B3D91", color: "#fff",
                            borderRadius: 0, fontSize: 11.5, lineHeight: 1.6, fontWeight: 500,
                            boxShadow: "0 8px 24px rgba(11,61,145,0.35)", textTransform: "none", letterSpacing: "normal",
                          }}>
                            <strong style={{ fontWeight: 800 }}>Audit depth</strong> controls how many governance probes
                            are fired at your AI system before scoring. More probes cover more
                            edge cases per principle, which raises confidence in the score but
                            takes longer to run. Pick based on whether this is a quick internal
                            check or evidence you'll hand to auditors or regulators.
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        {(["dev", "standard", "thorough"] as const).map(t => {
                          const labels: Record<string, { label: string; sub: string; color: string }> = {
                            dev:      { label: "Low",    sub: "~55 probes · fast",        color: "#64748B" },
                            standard: { label: "Medium", sub: "~130 probes · balanced",   color: "#005EB8" },
                            thorough: { label: "Strong", sub: "~255 probes · cert-grade", color: "#0B3D91" },
                          };
                          const { label, sub, color } = labels[t];
                          const active = bbTier === t;
                          return (
                            <button key={t} type="button" onClick={() => setBbTier(t)} disabled={bbLoading}
                              style={{
                                flex: 1, padding: "9px 6px", border: `1.5px solid ${active ? color : "#DDE5EF"}`,
                                background: active ? (t === "thorough" ? "#0B3D91" : t === "standard" ? "#005EB8" : "#F1F5F9") : "#FAFBFD",
                                color: active ? (t === "dev" ? "#334155" : "#fff") : "#64748B",
                                cursor: "pointer", fontFamily: "inherit",
                                transition: "all 0.15s",
                              }}>
                              <div style={{ fontSize: 12, fontWeight: 800 }}>{label}</div>
                              <div style={{ fontSize: 10, marginTop: 2, opacity: 0.8 }}>{sub}</div>
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>
                        {bbTier === "dev" && "Fast iteration — low confidence. Not for client-facing audits."}
                        {bbTier === "standard" && "Balanced coverage — medium/high confidence. Default for real audits."}
                        {bbTier === "thorough" && "Full coverage — high confidence. Use for certification-grade evidence."}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className="db-btn"
                    style={{ marginTop: 12 }}
                    onClick={handleBlackBox}
                    disabled={bbLoading}
                  >
                    {bbLoading
                      ? (bbTab === "chat" ? "Parsing & Ingesting…" : "Running Audit…")
                      : (bbTab === "chat" ? "Audit Chat History" : "Run Black Box Audit")}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ══════════════════════════════════════════
              SECTION 2 — LOG INGESTION
          ══════════════════════════════════════════ */}
          <div className="db-step">
            <div className="db-step-body">
              <SectionHeader
                icon={stepIcon(logsDone, false, (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
                    <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
                  </svg>
                ))}
                title="Inference Log Ingestion"
                subtitle={aiName
                  ? `Upload ${aiName}'s production inference logs — inputs, outputs, latency. The SDCC pipeline checks data quality and detects model type automatically.`
                  : "Upload production inference logs for structural analysis and data quality scoring"}
                done={logsDone}
                optional="Optional if probing ran"
              />

              {logsDone && sdccSummary && (
                <SdccSummaryPanel
                  summary={sdccSummary}
                  onRedo={() => { setLogsDone(false); setSdccSummary(null); setFile(null); }}
                />
              )}

              <div className={`db-card${logsDone ? " " : " active"}`} style={{ marginTop: logsDone ? 12 : 0 }}>
                <div className="db-card-h">
                  {logsDone ? "Upload Additional Logs" : "Upload Inference Logs"}
                  {!logsDone && bbDone && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#00A3A1", marginLeft: 8, background: "#F0FAFA", border: "1px solid #B2E8E6", padding: "2px 8px", borderRadius: 0 }}>
                      Auto-ingested from Black Box
                    </span>
                  )}
                </div>
                <div className="db-card-d">
                  {bbDone && !logsDone
                    ? "Black Box probe responses were automatically ingested — you can skip this step and go straight to Step 4. Or upload your own production logs here to replace them."
                    : logsDone
                      ? "You can upload a new or updated log file to replace the current ingestion."
                      : "Upload your AI's inference logs in any format — CSV, Excel, JSON, SQL dump, TSV, or Parquet. We detect and remap your columns automatically. No fixed schema required."}
                </div>
                <div
                  className={`db-drop${file ? " has" : ""}`}
                  onClick={() => document.getElementById("log-inp")?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
                >
                  <input
                    id="log-inp"
                    type="file"
                    accept=".csv,.json,.jsonl,.xlsx,.xls,.tsv,.sql,.parquet,.txt"
                    style={{ display: "none" }}
                    onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); }}
                  />
                  <div className={`db-drop-t${file ? " has" : ""}`}>
                    {file ? file.name : "Click or drag a file here — CSV, Excel, JSON, SQL, TSV, Parquet"}
                  </div>
                </div>
                {ingestError && <div className="db-err">{ingestError}</div>}
                <button className="db-btn" onClick={handleUpload} disabled={ingestLoading || !file}>
                  {ingestLoading ? "Ingesting…" : "Upload & Ingest"}
                </button>
              </div>
            </div>
          </div>

          {/* ══════════════════════════════════════════
              SECTION 3 — KNOWLEDGE BASE
          ══════════════════════════════════════════ */}
          <div className="db-step">
            <div className="db-step-body">
              <SectionHeader
                icon={
                  <div style={{
                    width: 34, height: 34, borderRadius: 0, flexShrink: 0,
                    background: kbDone ? "linear-gradient(135deg,#00A3A1,#0091DA)" : "linear-gradient(135deg,#4B5E78,#7A90AB)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                    opacity: uploaded ? 1 : 0.5,
                    transition: "background 0.4s ease, opacity 0.4s ease",
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                }
                title="Knowledge Base"
                subtitle="Upload reference documents to ground the LLM Judge against your own material — significantly improves accuracy scoring for RAG and domain-specific agents"
                done={kbDone}
                optional="Optional"
              />

              <div className={`db-card${uploaded ? "" : " locked"}`}>
                <div className="db-card-h">Upload Knowledge Base</div>
                <div className="db-card-d">
                  Upload reference documents (PDF, TXT, DOCX, MD, CSV, XLSX) to ground the LLM Judge evaluation against your own material. When provided, the three judges compare AI responses against your KB — significantly improving accuracy scoring for RAG and domain-specific systems.
                </div>
                {kbDone && kbSuccess && (
                  <div className="db-ok" style={{ marginBottom: 12 }}>
                    {kbChunks} chunks stored. The LLM Judge will use these as reference during evaluation.
                    <button
                      type="button"
                      onClick={handleViewKbChunks}
                      style={{ marginLeft: 10, background: "none", border: "none", color: "#00338D", fontWeight: 700, fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: 0 }}
                    >
                      {kbListOpen ? "Hide chunks" : "View chunks"}
                    </button>
                    <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4, fontWeight: 400 }}>
                      This knowledge base is temporary — it expires 24 hours after your last upload or evaluation. Re-upload if you come back later.
                    </div>
                  </div>
                )}
                {kbListOpen && (
                  <div style={{ marginBottom: 12, maxHeight: 260, overflowY: "auto", border: "1px solid #E2E8F0", borderRadius: 0 }}>
                    {kbListLoading && <div style={{ padding: 12, fontSize: 12.5, color: "#64748B" }}>Loading chunks…</div>}
                    {!kbListLoading && kbChunkList && kbChunkList.length === 0 && (
                      <div style={{ padding: 12, fontSize: 12.5, color: "#94A3B8" }}>No stored chunks found for this AI system.</div>
                    )}
                    {!kbListLoading && kbChunkList && kbChunkList.map((c) => (
                      <div key={c.chunk_index} style={{ padding: "10px 12px", borderBottom: "1px solid #F1F5F9" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#00338D", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
                            Chunk {c.chunk_index + 1}
                          </span>
                          {c.source && <span style={{ fontSize: 10.5, color: "#94A3B8" }}>{c.source}</span>}
                        </div>
                        <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
                          {c.content}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div
                  className={`db-drop${kbFiles && kbFiles.length > 0 ? " has" : ""}`}
                  onClick={() => document.getElementById("kb-inp")?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) setKbFiles(e.dataTransfer.files); }}
                >
                  <input
                    id="kb-inp"
                    type="file"
                    accept=".pdf,.txt,.md,.docx,.csv,.xlsx,.xls"
                    multiple
                    style={{ display: "none" }}
                    onChange={e => { if (e.target.files?.length) setKbFiles(e.target.files); }}
                  />
                  <div className={`db-drop-t${kbFiles && kbFiles.length > 0 ? " has" : ""}`}>
                    {kbFiles && kbFiles.length > 0
                      ? `${kbFiles.length} file${kbFiles.length > 1 ? "s" : ""} selected`
                      : "Click or drag files here (PDF, TXT, DOCX, MD, CSV, XLSX)"}
                  </div>
                </div>
                {kbError && <div className="db-err">{kbError}</div>}
                <button className="db-btn teal" onClick={handleKb} disabled={kbLoading || !kbFiles?.length}>
                  {kbLoading ? "Uploading…" : "Upload Knowledge Base"}
                </button>
              </div>
            </div>
          </div>


          {/* ══════════════════════════════════════════
              SECTION 3b — TRAINING DATA UPLOAD (TAF TAXONOMY UNLOCK)
          ══════════════════════════════════════════ */}
          <div className="db-step">
            <div className="db-step-body">
              <SectionHeader
                icon={
                  <div style={{
                    width: 34, height: 34, borderRadius: 0, flexShrink: 0,
                    background: trainingDone ? "linear-gradient(135deg,#7C3AED,#A78BFA)" : "linear-gradient(135deg,#4B5E78,#7A90AB)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.1)", transition: "background 0.4s ease",
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
                      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
                    </svg>
                  </div>
                }
                title="Training Data Upload"
                subtitle="Upload fine-tuning / training data to unlock 15 additional Risk Taxonomy controls — bias in training data, memorisation, membership inference, compute footprint."
                done={trainingDone}
                optional="Optional — unlocks Risk Taxonomy controls"
              />
              {!trainingDone ? (
                <div className="db-card active">
                  <div className="db-card-h">Upload Training / Fine-tuning Data</div>
                  <div className="db-card-d">
                    Upload your model's training or fine-tuning dataset (CSV, XLSX, or JSON). TrustShield analyses it for bias representation, deduplication quality, PII exposure, and compute-size proxies — unlocking 15 controls in the Risk Taxonomy tab that otherwise cannot be evaluated from external probing alone.
                  </div>
                  <div style={{ background: "#EDE9FE", border: "1px solid #C4B5FD", borderRadius: 0, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#5B21B6", lineHeight: 1.6 }}>
                    <strong>Dev mode:</strong> Heuristic proxies used now. In production, Azure ML Responsible AI Dashboard, Azure Purview, and fairlearn replace these with production-grade metrics.
                  </div>
                  <select value={trainingType} onChange={e => setTrainingType(e.target.value)}
                    style={{ width: "100%", marginBottom: 10, padding: "9px 12px", border: "1px solid #C4B5FD", borderRadius: 0, fontSize: 13, background: "#fff", fontFamily: "inherit" }}>
                    <option value="fine_tuning">Fine-tuning data</option>
                    <option value="training">Training data</option>
                    <option value="eval">Evaluation / test data</option>
                  </select>
                  <div
                    className={`db-drop${trainingFile ? " has" : ""}`}
                    onClick={() => document.getElementById("training-inp")?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setTrainingFile(f); }}
                  >
                    <input id="training-inp" type="file" accept=".csv,.xlsx,.xls,.json"
                      style={{ display: "none" }}
                      onChange={e => { if (e.target.files?.[0]) setTrainingFile(e.target.files[0]); }} />
                    <div className={`db-drop-t${trainingFile ? " has" : ""}`}>
                      {trainingFile ? trainingFile.name : "Click or drag CSV / XLSX / JSON here"}
                    </div>
                  </div>
                  {trainingError && <div className="db-err">{trainingError}</div>}
                  <button className="db-btn" style={{ background: "linear-gradient(135deg,#7C3AED,#A78BFA)" }}
                    onClick={handleTrainingUpload} disabled={trainingLoading || !trainingFile}>
                    {trainingLoading ? "Analysing…" : "Upload & Analyse Training Data"}
                  </button>
                </div>
              ) : (
                <div className="db-card" style={{ background: "#F5F3FF", border: "1px solid #DDD6FE" }}>
                  <div className="db-card-h" style={{ color: "#7C3AED" }}>✓ Training Data Analysed</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", fontSize: 12, color: "#5B21B6", marginTop: 8 }}>
                    {trainingAnalysis?.representation_score != null && (<><span>Representation Balance</span><span style={{ fontWeight: 700 }}>{trainingAnalysis.representation_score}%</span></>)}
                    {trainingAnalysis?.deduplication_rate != null && (<><span>Deduplication Rate</span><span style={{ fontWeight: 700 }}>{trainingAnalysis.deduplication_rate}%</span></>)}
                    {trainingAnalysis?.pii_exposure_rate != null && (<><span>PII Exposure Rate</span><span style={{ fontWeight: 700, color: trainingAnalysis.pii_exposure_rate > 5 ? "#DC2626" : "#059669" }}>{trainingAnalysis.pii_exposure_rate}%</span></>)}
                    {trainingAnalysis?.compute_size_proxy && (<><span>Dataset Size Class</span><span style={{ fontWeight: 700 }}>{trainingAnalysis.compute_size_proxy}</span></>)}
                  </div>
                  <div style={{ fontSize: 11, color: "#7C3AED", marginTop: 10 }}>
                    15 Risk Taxonomy controls now unlocked — view them in the Risk Taxonomy tab.
                  </div>
                  <button onClick={() => { setTrainingDone(false); setTrainingFile(null); setTrainingAnalysis(null); setTrainingDataId(undefined); }}
                    style={{ marginTop: 10, fontSize: 12, color: "#7C3AED", background: "none", border: "1px solid #C4B5FD", padding: "4px 12px", cursor: "pointer", borderRadius: 0, fontFamily: "inherit" }}>
                    Replace Training Data
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ══════════════════════════════════════════
              SECTION 4 — GOVERNANCE EVALUATION
          ══════════════════════════════════════════ */}
          <div className="db-step">
            <div className="db-step-body">
              <SectionHeader
                icon={
                  <div style={{
                    width: 34, height: 34, borderRadius: 0, flexShrink: 0,
                    background: uploaded ? "linear-gradient(135deg,#00338D,#005EB8)" : "linear-gradient(135deg,#4B5E78,#7A90AB)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 2px 8px rgba(0,51,141,0.2)",
                    opacity: uploaded ? 1 : 0.5,
                    transition: "background 0.4s ease, opacity 0.4s ease",
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                  </div>
                }
                title="Full Governance Evaluation"
                subtitle={aiName
                  ? `Run the complete KPMG TAF pipeline on ${aiName} — SDCC analysis → Triple LLM Judge → 10-principle scoring → compliance mapping → PDF report`
                  : "Run the complete governance evaluation pipeline and generate your audit report"}
                done={false}
                optional={!uploaded ? "Complete sections above first" : undefined}
              />

              <div className={`db-card${uploaded ? "" : " locked"}`}>
                <div className="db-card-h">Run Full Governance Evaluation</div>
                <div className="db-card-d">
                  Runs the complete KPMG TAF pipeline: SDCC structural analysis → Triple LLM Judge accuracy scoring → 10-principle TAF scoring → risk classification → compliance mapping → PDF report generation. This is the final step.
                </div>

                {uploaded && sdccSummary && (
                  <div className="db-checklist">
                    <div className="db-check-row">
                      <span className="db-check-k">Inference logs</span>
                      <span className="db-check-v green">{sdccSummary.logs_ingested.toLocaleString()} rows ready</span>
                    </div>
                    <div className="db-check-row">
                      <span className="db-check-k">Model type detected</span>
                      <span className="db-check-v">{sdccSummary.model_type?.replace(/_/g, " ") || "Auto-detect"}</span>
                    </div>
                    <div className="db-check-row">
                      <span className="db-check-k">Data quality</span>
                      <span className={`db-check-v ${sdccSummary.data_quality_score >= 70 ? "green" : "red"}`}>
                        {sdccSummary.data_quality_score}%
                      </span>
                    </div>
                    <div className="db-check-row">
                      <span className="db-check-k">Knowledge base</span>
                      <span className={`db-check-v ${kbDone ? "green" : ""}`}>
                        {kbDone ? `${kbChunks} chunks loaded` : "Not uploaded (optional)"}
                      </span>
                    </div>
                  </div>
                )}

                {!uploaded && (
                  <div className="db-info">
                    Complete Step 1 (Black Box Audit) to auto-ingest logs and enable evaluation — or upload your own logs in Step 2.
                  </div>
                )}
                {uploaded && !sdccSummary && bbDone && (
                  <div className="db-info" style={{ marginBottom: 16 }}>
                    Black Box probe responses were auto-ingested. You're ready to run the full evaluation.
                  </div>
                )}
                {evalError && <div className="db-err">{evalError}</div>}
                {computationNotes && (
                  <div className="db-ok" style={{ marginBottom: 12 }}>
                    {Object.values(computationNotes).filter((n: any) => n.status === "computed").length} metrics computed successfully.
                  </div>
                )}

                <button className="db-btn big" onClick={handleEvaluate} disabled={!uploaded || evalLoading}>
                  {evalLoading ? "Generating Report…" : "Run Full Governance Evaluation →"}
                </button>

                {evalLoading && (
                  <div className="db-eval-loader">
                    <div className="db-eval-track"><div className="db-eval-bar" /></div>
                    <div className="db-eval-steps">
                      <span className="db-eval-step">SDCC Analysis</span>
                      <span className="db-eval-step">LLM Judge Scoring</span>
                      <span className="db-eval-step">TAF Principles</span>
                      <span className="db-eval-step">Risk Taxonomy Mapping</span>
                      <span className="db-eval-step">PDF Report</span>
                    </div>
                    <div className="db-eval-lbl">This may take some time — please don't close the tab.</div>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}