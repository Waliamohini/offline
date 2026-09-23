import axios from "axios";

// ── Runtime API base URL ────────────────────────────────────────────────────
// In Docker, docker-entrypoint.sh writes /config.js into the built dist/
// before nginx starts, setting window.__CONFIG__.apiBaseUrl to whatever
// API_URL the container was given. index.html loads that script before this
// bundle runs, so this picks it up at *runtime*, not at build time — the
// same image works in dev/UAT/prod without a rebuild.
//
// Outside Docker (plain `npm run dev`), window.__CONFIG__ won't exist, so
// this falls back to localhost:8000, same as before this change.
declare global {
  interface Window {
    __CONFIG__?: { apiBaseUrl?: string };
  }
}

const BASE_URL = window.__CONFIG__?.apiBaseUrl || "http://localhost:8000";

// No blanket timeout here: several endpoints below (Black Box Audit, Re-run
// Audit, Evaluate, SDCC ingest, training-data upload) legitimately run for
// minutes — probing a live AI, crunching large log/training files, etc.
// A global 30s cap killed those mid-flight with "timeout of 30000ms exceeded"
// even though the backend was still working. Fast, simple GET/POST calls
// instead get their own short per-request timeout below, so a hung request
// on *those* still fails fast without capping the long-running ones.
const api = axios.create({ baseURL: BASE_URL });

const QUICK_TIMEOUT_MS = 30_000;

// Attach JWT to every request automatically
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Auth ──────────────────────────────────────────────────────────────────────
export const registerUser = (data: { name: string; email: string; password: string }) =>
  api.post("/api/auth/register", data);

export const registerAdmin = (data: { name: string; email: string; password: string }) =>
  api.post("/api/auth/register-admin", data);

export const loginUser = (data: { email: string; password: string }) =>
  api.post("/api/auth/login", data);

export const getProfile = () =>
  api.get("/api/auth/me");

export const updateProfile = (data: { name: string }) =>
  api.patch("/api/auth/me", data);

// ── Register AI ───────────────────────────────────────────────────────────────
// Connection details (type, endpoint, headers) are no longer collected during
// registration — they are entered fresh at audit time on the Dashboard.
// A stub connector is sent to satisfy the backend schema requirement.
// The profile field carries all governance/deployment context used by the
// behavioral fingerprinter and probe generator.
export const registerAI = (data: {
  name:        string;
  description: string;
  domain:      string;
  connector:   { type: string; endpoint: string; headers: Record<string, string> };
  profile?: {
    end_users?:              string;
    decision_influence?:     string;
    data_types?:             string[];
    jurisdictions?:          string[];
    deployment_status?:      string;
    real_time_data?:         string;
    autonomous_actions?:     string;
    oversight_model?:        string;
    output_visibility?:      string;
    highest_stakes_failure?: string;
    bias_tested?:            string;
    // Build provenance — gates the Code & Build Risk tab
    ai_generated?:           string;
    ai_codegen_tools?:       string;
    human_review_gate?:      string;
    // TAF risk category scope — GAI always included; user picks extras
    taf_applicable_categories?: string[];
  };
}) => api.post("/register-ai", data);

// ── List AI systems (used by Dashboard to populate the AI selector) ───────────
export const listAiSystems = () =>
  api.get("/ai-systems");

// ── SDCC Ingest ───────────────────────────────────────────────────────────────
export const sdccIngest = (aiName: string, file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  return api.post(`/sdcc/ingest/${aiName}`, fd);
};

// ── KB Upload ─────────────────────────────────────────────────────────────────
export const uploadKnowledgeBase = (aiName: string, files: File[]) => {
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  return api.post(`/sdcc/upload-kb/${aiName}`, fd);
};

// Normalized KB chunks for an AI system (chunk_index, content, source file) —
// lets the UI show which files actually contributed grounding context.
export const getKbChunks = (aiName: string) =>
  api.get(`/sdcc/kb-chunks/${aiName}`);

// ── Evaluate ──────────────────────────────────────────────────────────────────
// Crunches ingested logs/KB — can take a while on large datasets; no client timeout.
export const evaluateAI = (aiName: string) =>
  api.post(`/evaluate/${aiName}`, undefined, { timeout: 0 });

// ── Reports ───────────────────────────────────────────────────────────────────
export const getReports = () =>
  api.get("/reports");

export const getReportById = (reportId: string) =>
  api.get(`/reports/${reportId}`);

// Per-row, per-judge LLM panel deliberation for a report — votes, reasons,
// and each judge's individual latency_ms. Not embedded in the report JSON
// itself (that only carries aggregate accuracy/rows_judged), so this is a
// separate call, fetched lazily by LlmAnalysis.tsx.
export const getJudgePanel = (reportId: string) =>
  api.get(`/reports/${reportId}/judge-panel`);

// Normalized sub-parameter rows for a report — score + definition + which
// analysis engine (ml vs heuristic) produced it.
export const getSubParameters = (reportId: string) =>
  api.get(`/reports/${reportId}/sub-parameters`);

// One row per Control Matrix ID (GAI.FAIR.01, PD.SEC.01, etc.) for a report.
export const getTaxonomyControls = (reportId: string) =>
  api.get(`/reports/${reportId}/taxonomy-controls`);

// Regulatory/framework alignment (EU AI Act, ISO 42001, NIST AI RMF, KPMG
// TAF) as normalized rows with their own principle-score breakdown.
export const getFrameworkCompliance = (reportId: string) =>
  api.get(`/reports/${reportId}/framework-compliance`);

// ── Black Box Audit ───────────────────────────────────────────────────────────
// Connection credentials (api_key, endpoint, ui_url) are entered here at
// audit-run time and never stored — they are used only for the duration of
// the audit request.
// No client-side timeout: a full audit runs ~90-110 real probe calls against
// the target AI (fingerprinting + Wave 1/2/3 + build-risk). Even with the
// bounded-concurrency fix on the backend this can legitimately take a few
// minutes — the fix for "audit hangs" was speeding up the backend, not
// capping the frontend request that's waiting on it.
export const runBlackBoxAudit = (data: {
  ai_name:   string;
  mode:      "api" | "ui";
  endpoint?: string;
  api_key?:  string;
  ui_url?:   string;
  /**
   * Audit effort tier.
   * "dev"      — ~100 probes, fast, low confidence. For iteration / CI.
   * "standard" — ~200-330 probes, medium/high confidence. Default for real audits.
   * "thorough" — ~380-600 probes, high confidence. For certification-grade evidence.
   * Omitting tier routes through the legacy wave-based pipeline (backward compat).
   */
  tier?:     "dev" | "standard" | "thorough";
}) => api.post("/blackbox/audit", data, { timeout: 0 });

export const getBlackBoxHistory = (aiName: string) =>
  api.get(`/blackbox/history/${aiName}`);

export const getAllBlackBoxHistory = () =>
  api.get("/blackbox/history-all");

export const getBlackBoxAuditById = (auditId: string) =>
  api.get(`/blackbox/audit/${auditId}`);

// ── Chat History Ingest ───────────────────────────────────────────────────────
export const ingestChatHistory = (aiName: string, text: string, source = "") =>
  api.post(`/sdcc/ingest-chat/${aiName}`, { text, source });

// ── Re-run Audit ──────────────────────────────────────────────────────────────
// Same reasoning as runBlackBoxAudit — no client timeout, this re-runs a
// probe battery against a live AI and can take minutes.
export const runRerunAudit = (data: {
  prior_audit_id:  string;
  user_context:    string;
  scope_override?: "full" | "targeted" | "phase1_only";
  endpoint?:       string;
  api_key?:        string;
  mode?:           string;
}) => api.post("/blackbox/audit/rerun", data, { timeout: 0 });

export const getRerunHistory = (aiName: string) =>
  api.get(`/blackbox/rerun-history/${aiName}`);

// ── Report Audit ───────────────────────────────────────────────────────────────
export const getAuditResult = (auditId: string) =>
  api.get(`/audit/result/${auditId}`);

export default api;
// ── Risk Taxonomy (TAF) ───────────────────────────────────────────────────────

export const uploadTrainingData = (aiName: string, file: File, uploadType = "fine_tuning") => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_type", uploadType);
  return api.post(`/taf/upload-training/${encodeURIComponent(aiName)}`, fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const computeTafAssessment = (aiName: string, trainingDataId?: string) =>
  api.post(`/taf/assess/${encodeURIComponent(aiName)}`, { training_data_id: trainingDataId ?? null });

export const getTafAssessment = (aiName: string) =>
  api.get(`/taf/assessment/${encodeURIComponent(aiName)}`);

export const getTrainingUploads = (aiName: string) =>
  api.get(`/taf/training-uploads/${encodeURIComponent(aiName)}`);

export const getDetailedTaf = (aiName: string) =>
  api.get(`/taf/detailed/${encodeURIComponent(aiName)}`, { timeout: QUICK_TIMEOUT_MS });