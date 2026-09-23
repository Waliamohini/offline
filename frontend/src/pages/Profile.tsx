import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
 
/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */
interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  audit_count: number;
  created_at: string | null;
  last_login: string | null;
}
 
interface AuditRecord {
  audit_id: string;
  ai_name: string;
  overall_score: number;
  risk_level: string;
  status: string;
  created_at: string;
  probes_run?: number;
  mode?: string;
  findings?: any[];
  // Re-run linkage
  rerun_sequence?: number;
  parent_audit_id?: string;
  rerun_scope?: string;
  operator_change_context?: string;
  // Delta fields (present on re-run records)
  delta_summary?: {
    overall_score_change: number;
    resolved_count: number;
    regressed_count: number;
    improving_count: number;
    worsening_count: number;
    new_finding_count: number;
    principles_improved: string[];
    principles_regressed: string[];
  };
  principle_deltas?: any[];
  resolved_findings?: any[];
  persisting_findings?: any[];
  new_findings?: any[];
  phase1_delta?: any;
  started_at?: string;
  completed_at?: string;
}
 
const KPMG_PRINCIPLES = [
  "Safety","Security","Privacy","Fairness","Reliability",
  "Transparency","Accountability","Explainability","Data Integrity","Sustainability",
];
 
const BASE_URL = "http://localhost:8000";
 
/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
const riskColor = (level: string) =>
  level === "Low" ? "#059669" : level === "Moderate" ? "#D97706" : "#64748B";
 
const riskBg = (level: string) =>
  level === "Low" ? "#DCFCE7" : level === "Moderate" ? "#FEF3C7" : "#F1F5F9";
 
const scoreGrade = (score: number) => {
  if (score >= 80) return { label: "Excellent", color: "#059669", bg: "#DCFCE7" };
  if (score >= 65) return { label: "Good",      color: "#2563EB", bg: "#EFF6FF" };
  if (score >= 50) return { label: "Fair",      color: "#D97706", bg: "#FEF3C7" };
  return              { label: "Poor",      color: "#64748B", bg: "#F1F5F9" };
};
 
const fmtDate = (d: string | null) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
 
const fmtDateTime = (d: string | null) => {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
 
const getInitials = (name: string) =>
  name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
 
/* ─────────────────────────────────────────────
   SVG Score Ring
───────────────────────────────────────────── */
// Not currently rendered anywhere on this page — exported rather than
// deleted since it's a complete, working component, not dead code.
export function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const r = size * 0.38;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const { color } = scoreGrade(score);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F1F5F9" strokeWidth={size * 0.1} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={size * 0.1}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 1.2s ease" }} />
      <text x={size / 2} y={size / 2 + 5} textAnchor="middle"
        fill="#1E293B" fontSize={size * 0.26} fontWeight="800"
        fontFamily="'Plus Jakarta Sans', sans-serif">
        {score}
      </text>
    </svg>
  );
}
 
/* ─────────────────────────────────────────────
   Component
───────────────────────────────────────────── */
export default function Profile() {
  const navigate = useNavigate();
 
  const [profile, setProfile]             = useState<UserProfile | null>(null);
  const [audits, setAudits]               = useState<AuditRecord[]>([]);
  const [loading, setLoading]             = useState(true);
  const [auditsLoading, setAuditsLoading] = useState(true);
  const [profileError, setProfileError]   = useState("");
 
  const [editMode, setEditMode]     = useState(false);
  const [editName, setEditName]     = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMsg, setSaveMsg]       = useState<{ text: string; ok: boolean } | null>(null);
 
  const [mounted, setMounted] = useState(false);
 
  // ── Re-run state ──────────────────────────────────────────────────────────
  const [rerunTarget, setRerunTarget]   = useState<AuditRecord | null>(null);
  const [rerunContext, setRerunContext] = useState("");
  const [rerunChangeType, setRerunChangeType] = useState("bug_fix");
  const [rerunPrinciples, setRerunPrinciples] = useState<string[]>([]);
  const [rerunLoading, setRerunLoading] = useState(false);
  const [rerunError, setRerunError]     = useState("");
  const [rerunApiKey, setRerunApiKey]   = useState("");
  const [rerunEndpoint, setRerunEndpoint] = useState("");
  const [rerunStep, setRerunStep]       = useState<1 | 2>(1);
  // Which AI system groups are expanded in the project list
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const dialogRef = useRef<HTMLDivElement>(null);
 
  useEffect(() => {
    setTimeout(() => setMounted(true), 60);
    loadProfile();
    loadAuditHistory();
  }, []);
 
  const authHeader = () => {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
 
  const loadProfile = async () => {
    try {
      const res = await axios.get(`${BASE_URL}/api/auth/me`, { headers: authHeader() });
      setProfile(res.data);
      setEditName(res.data.name);
    } catch {
      setProfileError("Could not load profile. Please log in again.");
    } finally {
      setLoading(false);
    }
  };
 
  const loadAuditHistory = async () => {
    try {
      const [bbRes, repRes] = await Promise.allSettled([
        axios.get(`${BASE_URL}/blackbox/history-all`, { headers: authHeader() }),
        axios.get(`${BASE_URL}/reports`,              { headers: authHeader() }),
      ]);
      const bbList: AuditRecord[] =
        bbRes.status === "fulfilled" ? (bbRes.value.data.history || []) : [];
      const rawReports: any[] =
        repRes.status === "fulfilled" ? (repRes.value.data.reports || []) : [];
 
      // Map SDCC reports — only include if NOT already covered by a blackbox record
      // (same ai_name + same date window) to avoid duplicates in the list
      const bbAiNames = new Set(bbList.map(b => b.ai_name));
      const repList: AuditRecord[] = rawReports
        .filter(r => !bbAiNames.has(r.ai_name))   // skip if blackbox audit exists for this AI
        .map((r) => ({
          audit_id:      r.report_id,
          ai_name:       r.ai_name,
          overall_score: r.overall_score ?? 0,
          risk_level:    r.risk_level    ?? "Unknown",
          status:        "completed",
          created_at:    r.evaluated_at  ?? r.created_at ?? new Date().toISOString(),
          mode:          "evaluate",
          findings:      r.findings,
        }));
 
      // Merge and sort: within each AI, order by rerun_sequence asc then created_at asc
      const merged = [...bbList, ...repList].sort((a, b) => {
        // Primary: group by ai_name alphabetically
        const nameComp = a.ai_name.localeCompare(b.ai_name);
        if (nameComp !== 0) return nameComp;
        // Within same AI: baseline first, then re-runs in sequence order
        const seqA = a.rerun_sequence ?? 1;
        const seqB = b.rerun_sequence ?? 1;
        if (seqA !== seqB) return seqA - seqB;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
      setAudits(merged);
    } catch {
      setAudits([]);
    } finally {
      setAuditsLoading(false);
    }
  };
 
  const handleSave = async () => {
    if (!editName.trim()) return;
    setSaveLoading(true);
    setSaveMsg(null);
    try {
      await axios.patch(`${BASE_URL}/api/auth/me`, { name: editName.trim() }, { headers: authHeader() });
      setProfile((p) => p ? { ...p, name: editName.trim() } : p);
      setEditMode(false);
      setSaveMsg({ text: "Name updated successfully.", ok: true });
      setTimeout(() => setSaveMsg(null), 3000);
    } catch {
      setSaveMsg({ text: "Failed to update. Try again.", ok: false });
    } finally {
      setSaveLoading(false);
    }
  };
 
  const handleAuditClick = async (audit: AuditRecord) => {
    if (audit.mode === "evaluate") {
      try {
        const res = await axios.get(`${BASE_URL}/reports/${audit.audit_id}`, { headers: authHeader() });
        navigate("/report", { state: { data: res.data } });
      } catch {
        navigate("/report", { state: { data: audit } });
      }
      return;
    }
    try {
      const res = await axios.get(`${BASE_URL}/blackbox/audit/${audit.audit_id}`, { headers: authHeader() });
      // Merge delta fields: GET response wins, fall back to list-item fields
      // (history-all now includes these, so this covers both paths)
      const fullData = {
        ...res.data,
        delta_summary:       res.data.delta_summary       ?? audit.delta_summary,
        principle_deltas:    res.data.principle_deltas     ?? audit.principle_deltas,
        resolved_findings:   res.data.resolved_findings    ?? audit.resolved_findings,
        persisting_findings: res.data.persisting_findings  ?? audit.persisting_findings,
        new_findings:        res.data.new_findings         ?? audit.new_findings,
        phase1_delta:        res.data.phase1_delta         ?? audit.phase1_delta,
      };
      navigate("/report", { state: { data: fullData } });
    } catch {
      navigate("/report", { state: { data: audit } });
    }
  };
 
  // ── Re-run handlers ──────────────────────────────────────────────────────
  const handleStartRerun = (e: React.MouseEvent, audit: AuditRecord) => {
    e.stopPropagation();
    setRerunTarget(audit);
    setRerunContext("");
    setRerunChangeType("bug_fix");
    setRerunPrinciples([]);
    setRerunError("");
    setRerunApiKey("");
    setRerunEndpoint("");
    setRerunStep(1);
  };
 
  const handleSubmitRerun = async () => {
    if (!rerunTarget) return;
    if (!rerunContext.trim()) { setRerunError("Please describe what changed."); return; }
    if (!rerunApiKey.trim()) { setRerunError("API key is required."); return; }
    setRerunLoading(true);
    setRerunError("");
    try {
      const userContextFull = [
        rerunContext.trim(),
        `Change type: ${rerunChangeType}`,
        rerunPrinciples.length > 0 ? `Operator claims fixed: ${rerunPrinciples.join(", ")}` : "",
      ].filter(Boolean).join(" | ");
      const res = await axios.post(
        `${BASE_URL}/blackbox/audit/rerun`,
        {
          prior_audit_id: rerunTarget.audit_id,
          user_context:   userContextFull,
          api_key:        rerunApiKey.trim(),
          endpoint:       rerunEndpoint.trim() || undefined,
          mode:           rerunTarget.mode === "evaluate" ? "api" : (rerunTarget.mode || "api"),
        },
        { headers: authHeader() },
      );
      setRerunTarget(null);
      await loadAuditHistory();
      navigate("/report", { state: { data: res.data } });
    } catch (err: any) {
      const detail = err?.response?.data?.detail || "Re-run failed. Try again.";
      setRerunError(typeof detail === "string" ? detail : JSON.stringify(detail));
    } finally {
      setRerunLoading(false);
    }
  };
 
  const completedAudits = audits.filter((a) => a.status === "completed");
  const avgScore = completedAudits.length > 0
    ? Math.round(completedAudits.reduce((s, a) => s + (a.overall_score || 0), 0) / completedAudits.length)
    : null;
  const highRiskCount = audits.filter((a) => a.risk_level === "High").length;
 
  const fade = (delay: number): React.CSSProperties => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? "translateY(0)" : "translateY(18px)",
    transition: `opacity 0.65s ease ${delay}s, transform 0.65s ease ${delay}s`,
  });
 
  /* ── Loading ── */
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#F8FAFC" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 38, height: 38, border: "3px solid #E2E8F0", borderTop: "3px solid #2563EB", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 14px" }} />
          <p style={{ color: "#94A3B8", fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Loading profile…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }
 
  /* ── Error ── */
  if (profileError) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#F8FAFC", gap: 18, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <div style={{ fontSize: 38 }}></div>
        <p style={{ color: "#DC2626", fontSize: 14 }}>{profileError}</p>
        <button onClick={() => navigate("/login")} style={{ padding: "11px 26px", background: "linear-gradient(135deg, #00338D, #005EB8)", border: "none", borderRadius: 0, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
          Back to Login
        </button>
      </div>
    );
  }
 
  const initials = profile ? getInitials(profile.name) : "??";
 
  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", color: "#1E293B", fontFamily: "'Plus Jakarta Sans', sans-serif", paddingBottom: 80, overflowX: "hidden" }}>
 
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 0px; }
 
        .card {
          background: white;
          border: 1px solid #E2E8F0;
          border-radius: 0px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04);
        }
 
        .p-input {
          padding: 10px 14px; border-radius: 0px;
          border: 1.5px solid #E2E8F0;
          background: #F8FAFC; color: #1E293B;
          font-size: 14px; font-family: 'Plus Jakarta Sans', sans-serif;
          transition: border-color 0.2s, box-shadow 0.2s; outline: none;
        }
        .p-input:focus { border-color: #2563EB; box-shadow: 0 0 0 3px rgba(37,99,235,0.12); }
        .p-input::placeholder { color: #94A3B8; }
 
        .btn-primary {
          padding: 10px 20px; border-radius: 0px; border: none;
          background: linear-gradient(135deg, #1E3A8A, #2563EB);
          color: white; font-weight: 700; font-size: 13px; cursor: pointer;
          font-family: 'Plus Jakarta Sans', sans-serif;
          box-shadow: 0 4px 12px rgba(37,99,235,0.25);
          transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
        }
        .btn-primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(37,99,235,0.35); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
 
        .btn-ghost {
          padding: 10px 20px; border-radius: 0px;
          border: 1.5px solid #E2E8F0; background: white;
          color: #64748B; font-weight: 600; font-size: 13px; cursor: pointer;
          font-family: 'Plus Jakarta Sans', sans-serif;
          transition: border-color 0.2s, color 0.2s, background 0.2s;
        }
        .btn-ghost:hover { border-color: #2563EB; color: #2563EB; background: #EFF6FF; }
 
        .btn-danger {
          padding: 10px 20px; border-radius: 0px;
          border: 1.5px solid #FECACA; background: #FEF2F2;
          color: #DC2626; font-weight: 700; font-size: 13px; cursor: pointer;
          font-family: 'Plus Jakarta Sans', sans-serif;
          transition: background 0.2s, transform 0.2s;
        }
        .btn-danger:hover { background: #FEE2E2; transform: translateY(-1px); }
 
        .audit-item {
          display: flex; align-items: center; gap: 14px;
          padding: 14px 16px; border-radius: 0px;
          border: 1px solid #E2E8F0; background: white;
          cursor: pointer; flex-wrap: wrap;
          transition: background 0.2s, border-color 0.2s, transform 0.2s, box-shadow 0.2s;
        }
        .audit-item:hover {
          background: #EFF6FF; border-color: #BFDBFE;
          transform: translateX(4px);
          box-shadow: 0 4px 14px rgba(37,99,235,0.08);
        }
 
        .stat-card {
          text-align: center; padding: 18px 16px;
          border-radius: 0px; background: white;
          border: 1px solid #E2E8F0;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.04);
          flex: 1; min-width: 80px;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
 
        .info-row {
          display: flex; flex-direction: column; gap: 4px;
          padding: 13px 0; border-bottom: 1px solid #F1F5F9;
        }
        .info-row:last-child { border-bottom: none; }
        .info-label {
          font-size: 10px; font-weight: 700; color: #005EB8;
          text-transform: uppercase; letter-spacing: 0.07em;
        }
        .info-value { font-size: 13px; color: #374151; font-weight: 500; }
 
        .sec-heading {
          font-size: 15px; font-weight: 800; color: #1E293B;
          display: flex; align-items: center; gap: 8px;
        }
 
        .quick-action-btn {
          padding: 16px; border-radius: 0px;
          border: 1.5px solid #E2E8F0; background: white;
          color: #374151; font-size: 13px; font-weight: 600;
          cursor: pointer; text-align: left; font-family: 'Plus Jakarta Sans', sans-serif;
          display: flex; align-items: center; gap: 10px;
          transition: background 0.2s, border-color 0.2s, transform 0.2s, color 0.2s;
          box-shadow: 0 1px 4px rgba(0,0,0,0.04);
        }
        .quick-action-btn:hover {
          background: #EFF6FF; border-color: #BFDBFE; color: #2563EB;
          transform: translateY(-2px); box-shadow: 0 6px 16px rgba(37,99,235,0.1);
        }
 
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
 
      {/* ── TOP NAVBAR removed — sidebar handles navigation ── */}
 
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 22 }}>
 
        {/* ── IDENTITY HERO ── */}
        <div className="card" style={{
          padding: "0", overflow: "hidden",
          ...fade(0.06),
        }}>
          {/* Blue gradient banner */}
          <div style={{
            height: 80,
            background: "linear-gradient(135deg, #00338D 0%, #005EB8 60%, #0091DA 100%)",
          }} />
          <div style={{ padding: "0 32px 28px", display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
            {/* Avatar overlapping banner */}
            <div style={{
              width: 80, height: 80, borderRadius: "50%", marginTop: -40, flexShrink: 0,
              background: "linear-gradient(135deg, #00338D, #005EB8, #0091DA)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 26, fontWeight: 900, color: "white", letterSpacing: "-1px",
              border: "4px solid white", boxShadow: "0 4px 16px rgba(37,99,235,0.3)",
            }}>{initials}</div>
 
            {/* Name + edit + tags */}
            <div style={{ flex: 1, minWidth: 200, paddingTop: 16 }}>
              {editMode ? (
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    className="p-input" value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Full name" style={{ width: 210 }}
                    onKeyDown={(e) => e.key === "Enter" && handleSave()}
                    autoFocus
                  />
                  <button className="btn-primary" onClick={handleSave} disabled={saveLoading}>
                    {saveLoading ? "Saving…" : "Save"}
                  </button>
                  <button className="btn-ghost" onClick={() => { setEditMode(false); setEditName(profile?.name || ""); }}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <h1 style={{ fontSize: 22, fontWeight: 800, color: "#1E293B" }}>{profile?.name}</h1>
                  <button
                    onClick={() => setEditMode(true)}
                    style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", color: "#2563EB", fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: "4px 10px", borderRadius: 0, fontWeight: 600 }}
                  > Edit</button>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 12px", borderRadius: 0, fontSize: 11, fontWeight: 700, background: "#DCFCE7", border: "1px solid #86EFAC", color: "#059669" }}>
                   Active
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 12px", borderRadius: 0, fontSize: 11, fontWeight: 700, background: "#EFF6FF", border: "1px solid #BFDBFE", color: "#2563EB", textTransform: "capitalize" }}>
                  {profile?.role || "Auditor"}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 12px", borderRadius: 0, fontSize: 11, fontWeight: 700, background: "#F3E8FF", border: "1px solid #DDD6FE", color: "#7C3AED" }}>
                  ⬡ KPMG TAF
                </span>
              </div>
              {saveMsg && (
                <p style={{ margin: "10px 0 0", fontSize: 12, color: saveMsg.ok ? "#059669" : "#DC2626", fontWeight: 600 }}>
                  {saveMsg.ok ? "" : ""} {saveMsg.text}
                </p>
              )}
            </div>
 
            {/* Stats row */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", paddingTop: 16 }}>
              {[
                { val: profile?.audit_count ?? 0, label: "Total Audits",  color: "#2563EB",  bg: "#EFF6FF" },
                { val: completedAudits.length,      label: "Completed",     color: "#059669",  bg: "#DCFCE7" },
                { val: avgScore ?? "—",             label: "Avg Score",     color: avgScore !== null ? scoreGrade(avgScore).color : "#94A3B8", bg: avgScore !== null ? scoreGrade(avgScore).bg : "#F8FAFC" },
                { val: highRiskCount,               label: "High Risk",     color: highRiskCount > 0 ? "#64748B" : "#059669", bg: highRiskCount > 0 ? "#F1F5F9" : "#DCFCE7" },
              ].map((s) => (
                <div key={s.label} className="stat-card" style={{ background: s.bg, border: `1px solid ${s.color}20` }}>
                  <div style={{ fontSize: 26, fontWeight: 900, color: s.color as string, lineHeight: 1 }}>{s.val}</div>
                  <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
 
        {/* ── TWO COLUMN: Account Info + Audit History ── */}
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 22, alignItems: "start", ...fade(0.12) }}>
 
          {/* LEFT – Account Details */}
          <div className="card" style={{ padding: "26px 28px" }}>
            <p className="sec-heading" style={{ marginBottom: 18 }}> Account Details</p>
 
            {[
              { label: "Email",        value: profile?.email },
              { label: "Role",         value: profile?.role, capitalize: true },
              { label: "Organisation", value: "KPMG Assurance and Consulting Services LLP" },
              { label: "Member Since", value: fmtDate(profile?.created_at ?? null) },
              { label: "Last Login",   value: fmtDateTime(profile?.last_login ?? null) },
            ].map((row) => (
              <div key={row.label} className="info-row">
                <span className="info-label">{row.label}</span>
                <span className="info-value" style={row.capitalize ? { textTransform: "capitalize" } : undefined}>
                  {row.value ?? "—"}
                </span>
              </div>
            ))}
 
            {/* Platform Access */}
            <div className="info-row">
              <span className="info-label">Platform Access</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                {["Black Box Audit", "SDCC Pipeline", "Report Generation"].map((f) => (
                  <span key={f} style={{ fontSize: 12, color: "#059669", display: "flex", alignItems: "center", gap: 7, fontWeight: 600 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#059669", display: "inline-block", flexShrink: 0 }} />
                    {f}
                  </span>
                ))}
              </div>
            </div>
 
            <button className="btn-primary" style={{ width: "100%", marginTop: 22, textAlign: "center" }} onClick={() => navigate("/dashboard")}>
              ← Back to Dashboard
            </button>
          </div>
 
          {/* RIGHT – Audit History */}
          <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 0, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", padding: "26px 28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <p style={{ fontSize: 15, fontWeight: 800, color: "#1E293B", margin: 0 }}>My Projects</p>
              <button
                onClick={() => navigate("/dashboard")}
                style={{ padding: "7px 14px", borderRadius: 0, border: "1.5px solid #E2E8F0", background: "white", color: "#64748B", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#2563EB"; (e.currentTarget as HTMLButtonElement).style.color = "#2563EB"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#E2E8F0"; (e.currentTarget as HTMLButtonElement).style.color = "#64748B"; }}
              >+ New Audit</button>
            </div>
 
            {auditsLoading ? (
              <div style={{ textAlign: "center", padding: "48px 0" }}>
                <div style={{ width: 32, height: 32, border: "3px solid #E2E8F0", borderTop: "3px solid #2563EB", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 14px" }} />
                <p style={{ color: "#94A3B8", fontSize: 13 }}>Loading audits…</p>
              </div>
            ) : audits.length === 0 ? (
              <div style={{ textAlign: "center", padding: "52px 20px" }}>
                <div style={{ fontSize: 42, marginBottom: 14 }}>📋</div>
                <p style={{ color: "#94A3B8", fontSize: 13, marginBottom: 16 }}>No audits run yet.</p>
                <button
                  onClick={() => navigate("/dashboard")}
                  style={{ padding: "10px 20px", borderRadius: 0, border: "none", background: "linear-gradient(135deg, #00338D, #005EB8)", color: "white", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                >Run your first audit →</button>
              </div>
            ) : (() => {
              const groups: Record<string, AuditRecord[]> = {};
              audits.forEach(a => {
                if (!groups[a.ai_name]) groups[a.ai_name] = [];
                groups[a.ai_name].push(a);
              });
              Object.keys(groups).forEach(name => {
                groups[name].sort((a, b) => (a.rerun_sequence ?? 1) - (b.rerun_sequence ?? 1));
              });
              const groupKeys = Object.keys(groups).sort((a, b) => {
                const latestA = Math.max(...groups[a].map(r => new Date(r.created_at).getTime()));
                const latestB = Math.max(...groups[b].map(r => new Date(r.created_at).getTime()));
                return latestB - latestA;
              });
 
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 540, overflowY: "auto" }}>
                  {groupKeys.map(aiName => {
                    const chain = groups[aiName];
                    const latest = chain[chain.length - 1];
                    const baseline = chain[0];
                    const hasReruns = chain.length > 1;
                    const isExpanded = expandedGroups.has(aiName);
                    const { color: sc, label: grade, bg: sgbg } = scoreGrade(latest.overall_score ?? 0);
                    const rc  = riskColor(latest.risk_level);
                    const rbg = riskBg(latest.risk_level);
                    const scoreDelta = hasReruns ? (latest.overall_score ?? 0) - (baseline.overall_score ?? 0) : null;
 
                    return (
                      <div key={aiName} style={{ border: "1px solid #E2E8F0", borderRadius: 0, background: "white" }}>
                        {/* Header row */}
                        <div
                          onClick={() => {
                            if (hasReruns) {
                              setExpandedGroups(prev => { const next = new Set(prev); next.has(aiName) ? next.delete(aiName) : next.add(aiName); return next; });
                            } else {
                              handleAuditClick(baseline);
                            }
                          }}
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", cursor: "pointer", borderBottom: isExpanded ? "1px solid #F1F5F9" : "none", background: isExpanded ? "#F8FBFF" : "white", borderRadius: isExpanded ? "12px 12px 0 0" : 12 }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "#EFF6FF"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = isExpanded ? "#F8FBFF" : "white"; }}
                        >
                          {/* Score circle */}
                          <div style={{ width: 44, height: 44, borderRadius: "50%", background: `${sc}15`, border: `2px solid ${sc}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <span style={{ fontSize: 14, fontWeight: 900, color: sc }}>{latest.overall_score ?? 0}</span>
                          </div>
 
                          {/* Name + date */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1E293B", marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
                              {aiName}
                              {hasReruns && (
                                <span style={{ fontSize: 10, fontWeight: 700, background: "#F3E8FF", border: "1px solid #DDD6FE", color: "#7C3AED", padding: "1px 6px", borderRadius: 0 }}>
                                  {chain.length} runs
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: "#94A3B8" }}>
                              {fmtDate(latest.created_at)}
                              {latest.probes_run ? ` · ${latest.probes_run} probes` : ""}
                              {latest.mode ? ` · ${latest.mode === "evaluate" ? "Evaluate" : latest.mode.toUpperCase()}` : ""}
                            </div>
                          </div>
 
                          {/* Delta */}
                          {scoreDelta !== null && (
                            <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 0, color: scoreDelta > 0 ? "#059669" : scoreDelta < 0 ? "#64748B" : "#94A3B8", background: scoreDelta > 0 ? "#DCFCE7" : scoreDelta < 0 ? "#F1F5F9" : "#F8FAFC", border: `1px solid ${scoreDelta > 0 ? "#86EFAC" : scoreDelta < 0 ? "#CBD5E1" : "#E2E8F0"}`, flexShrink: 0 }}>
                              {scoreDelta > 0 ? "+" : ""}{scoreDelta}
                            </span>
                          )}
 
                          {/* Grade + Risk */}
                          <span style={{ fontSize: 11, fontWeight: 700, color: sc, background: sgbg, border: `1px solid ${sc}20`, padding: "2px 8px", borderRadius: 0, flexShrink: 0 }}>{grade}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: rc, background: rbg, border: `1px solid ${rc}20`, padding: "2px 8px", borderRadius: 0, flexShrink: 0 }}>{latest.risk_level}</span>
 
                          <span style={{ color: hasReruns ? "#94A3B8" : "#2563EB", fontSize: 16, fontWeight: 700, flexShrink: 0, transition: "transform 0.2s", transform: isExpanded ? "rotate(90deg)" : "none", display: "inline-block" }}>›</span>
                        </div>
 
                        {/* Expanded chain */}
                        {isExpanded && (
                          <div style={{ padding: "10px 14px 12px" }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 8 }}>Audit history</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {chain.map((audit, idx) => {
                                const isBase = idx === 0;
                                const ds = audit.delta_summary;
                                const { color: asc } = scoreGrade(audit.overall_score ?? 0);
                                const arc = riskColor(audit.risk_level);
                                const arbg = riskBg(audit.risk_level);
                                return (
                                  <div key={audit.audit_id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", borderRadius: 0, background: "#F8FAFC", border: "1px solid #E2E8F0", cursor: "pointer" }}
                                    onClick={() => handleAuditClick(audit)}
                                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "#EFF6FF"; (e.currentTarget as HTMLDivElement).style.borderColor = "#BFDBFE"; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "#F8FAFC"; (e.currentTarget as HTMLDivElement).style.borderColor = "#E2E8F0"; }}
                                  >
                                    <div style={{ textAlign: "center" as const, minWidth: 36, flexShrink: 0 }}>
                                      <div style={{ fontSize: 16, fontWeight: 900, color: asc, lineHeight: 1 }}>{audit.overall_score}</div>
                                      <div style={{ fontSize: 9, color: "#94A3B8" }}>/100</div>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontSize: 11, fontWeight: 700, color: isBase ? "#2563EB" : "#7C3AED", marginBottom: 1 }}>
                                        {isBase ? "Baseline" : `Re-run #${audit.rerun_sequence ?? 1}`}
                                        <span style={{ fontSize: 10, fontWeight: 700, color: arc, background: arbg, padding: "0 5px", borderRadius: 0, marginLeft: 6 }}>{audit.risk_level}</span>
                                      </div>
                                      <div style={{ fontSize: 10, color: "#94A3B8" }}>{fmtDate(audit.created_at)}{audit.probes_run ? ` · ${audit.probes_run} probes` : ""}</div>
                                    </div>
                                    {ds && !isBase && (
                                      <span style={{ fontSize: 10, fontWeight: 800, color: ds.overall_score_change >= 0 ? "#059669" : "#DC2626", background: ds.overall_score_change >= 0 ? "#DCFCE7" : "#FEE2E2", padding: "1px 6px", borderRadius: 0, flexShrink: 0 }}>
                                        {ds.overall_score_change >= 0 ? "+" : ""}{Math.round(ds.overall_score_change)} pts
                                      </span>
                                    )}
                                    {idx === chain.length - 1 && audit.status === "completed" && audit.mode !== "evaluate" && (
                                      <button onClick={e => handleStartRerun(e, audit)}
                                        style={{ padding: "3px 8px", borderRadius: 0, border: "1.5px solid #BFDBFE", background: "#EFF6FF", color: "#2563EB", fontSize: 10, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
                                        ↺ Re-run
                                      </button>
                                    )}
                                    <span style={{ color: "#2563EB", fontSize: 14, flexShrink: 0 }}>›</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
 
            {audits.length > 0 && (
              <p style={{ margin: "14px 0 0", fontSize: 11, color: "#94A3B8", textAlign: "center" }}>
                Click any row to open its full report →
              </p>
            )}
          </div>
        </div>
 
        {/* ── QUICK ACTIONS ── */}
        <div className="card" style={{ padding: "26px 28px", ...fade(0.18) }}>
          <p className="sec-heading" style={{ marginBottom: 16 }}> Quick Actions</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))", gap: 12 }}>
            {[
              { icon: "", label: "New Black Box Audit", path: "/dashboard",   accent: "#2563EB" },
              { icon: "", label: "Upload Logs (SDCC)",  path: "/dashboard",   accent: "#059669" },
              { icon: "", label: "Report Generation",   path: "/report",      accent: "#7C3AED" },
              { icon: "", label: "Register AI System",  path: "/register-ai", accent: "#D97706" },
            ].map((a) => (
              <button
                key={a.label}
                className="quick-action-btn"
                onClick={() => navigate(a.path)}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = `${a.accent}08`;
                  (e.currentTarget as HTMLButtonElement).style.borderColor = `${a.accent}40`;
                  (e.currentTarget as HTMLButtonElement).style.color = a.accent;
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "white";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "#E2E8F0";
                  (e.currentTarget as HTMLButtonElement).style.color = "#374151";
                }}
              >
                <span style={{ width: 36, height: 36, borderRadius: 0, background: `${a.accent}10`, border: `1px solid ${a.accent}25`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
                  {a.icon}
                </span>
                <span>{a.label}</span>
              </button>
            ))}
          </div>
        </div>
 
        {/* ── FOOTER ── */}
        <div style={{ textAlign: "center", fontSize: 12, color: "#94A3B8", letterSpacing: "0.03em", ...fade(0.22) }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 6, alignItems: "center" }}>
            <span style={{ fontWeight: 700, color: "#2563EB" }}>TrustShield AI</span>
            <span>·</span>
            <span>KPMG Trusted AI Framework</span>
            {profile && <><span>·</span><span>ID: {profile.id?.slice(0, 12)}…</span></>}
          </div>
        </div>
 
      </div>
 
      {/* ── RE-RUN CHANGE DIALOG ──────────────────────────────────────────────── */}
      {rerunTarget && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={(e) => { if (e.target === e.currentTarget) setRerunTarget(null); }}
        >
          <div
            ref={dialogRef}
            style={{ background: "white", borderRadius: 0, padding: "32px 36px", width: "100%", maxWidth: 560, boxShadow: "0 28px 70px rgba(0,0,0,0.22)", fontFamily: "'Plus Jakarta Sans', sans-serif", maxHeight: "90vh", overflowY: "auto" }}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#2563EB", letterSpacing: "1.5px", textTransform: "uppercase" as const, marginBottom: 5 }}>
                  Re-run Audit · Step {rerunStep} of 2
                </div>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: "#1E293B", margin: 0 }}>
                  {rerunStep === 1 ? "↺ What changed?" : "🔑 Connection details"}
                </h2>
                <p style={{ fontSize: 12, color: "#94A3B8", margin: "4px 0 0", fontWeight: 500 }}>
                  {rerunTarget.ai_name} · Score: <strong style={{ color: "#2563EB" }}>{rerunTarget.overall_score}</strong>
                </p>
              </div>
              <button onClick={() => setRerunTarget(null)} style={{ background: "none", border: "none", color: "#94A3B8", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
            </div>
 
            {/* Step progress bar */}
            <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
              {[1, 2].map(s => (
                <div key={s} style={{ flex: 1, height: 4, borderRadius: 0, background: rerunStep >= s ? "#2563EB" : "#E2E8F0", transition: "background 0.3s" }} />
              ))}
            </div>
 
            {/* ── STEP 1 ── */}
            {rerunStep === 1 && (<>
 
              {/* Prior baseline snapshot */}
              <div style={{ padding: "12px 14px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 0, marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "1px", marginBottom: 8 }}>Prior audit baseline</div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" as const }}>
                  <div style={{ textAlign: "center" as const }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: rerunTarget.overall_score >= 75 ? "#059669" : rerunTarget.overall_score >= 50 ? "#2563EB" : "#DC2626" }}>{rerunTarget.overall_score}</div>
                    <div style={{ fontSize: 9.5, color: "#94A3B8" }}>Score</div>
                  </div>
                  <div style={{ textAlign: "center" as const }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: riskColor(rerunTarget.risk_level) }}>{rerunTarget.risk_level}</div>
                    <div style={{ fontSize: 9.5, color: "#94A3B8" }}>Risk</div>
                  </div>
                  {(rerunTarget.findings?.length ?? 0) > 0 && (
                    <div style={{ textAlign: "center" as const }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#64748B" }}>{rerunTarget.findings!.length}</div>
                      <div style={{ fontSize: 9.5, color: "#94A3B8" }}>Findings</div>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 8, lineHeight: 1.5 }}>
                  Phase 1 behavioral fingerprinting always re-runs first. Significant drift → full re-audit. Stable → targeted re-probe of failing principles only.
                </div>
              </div>
 
              {/* What changed */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#2563EB", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 6 }}>
                  What changed in this AI system? *
                </label>
                <textarea
                  value={rerunContext}
                  onChange={(e) => setRerunContext(e.target.value)}
                  placeholder="e.g. Updated system prompt to restrict legal advice, patched safety filters, re-trained on bias dataset…"
                  rows={3}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 0, border: "1.5px solid #E2E8F0", fontSize: 13, fontFamily: "inherit", color: "#1E293B", resize: "vertical" as const, outline: "none", boxSizing: "border-box" as const, background: "#F8FAFC" }}
                  onFocus={e => { e.currentTarget.style.borderColor = "#2563EB"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.1)"; }}
                  onBlur={e => { e.currentTarget.style.borderColor = "#E2E8F0"; e.currentTarget.style.boxShadow = "none"; }}
                />
                <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 3 }}>
                  Injected into every probe wave — makes re-probing adversarially targeted at your claimed fixes.
                </div>
              </div>
 
              {/* Change type */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#2563EB", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 6 }}>Change type</label>
                <select value={rerunChangeType} onChange={(e) => setRerunChangeType(e.target.value)}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 0, border: "1.5px solid #E2E8F0", fontSize: 13, fontFamily: "inherit", color: "#1E293B", background: "#F8FAFC", outline: "none", cursor: "pointer", boxSizing: "border-box" as const }}>
                  <option value="model_update">Model update / version change</option>
                  <option value="system_prompt">System prompt change</option>
                  <option value="fine_tuning">Fine-tuning / retraining</option>
                  <option value="safety_filters">Safety filter update</option>
                  <option value="knowledge_base">Knowledge base update</option>
                  <option value="bug_fix">Bug fix / patch</option>
                  <option value="other">Other</option>
                </select>
              </div>
 
              {/* Claimed fixed principles */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#2563EB", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 8 }}>
                  Which principles do you believe were fixed?{" "}
                  <span style={{ color: "#94A3B8", fontWeight: 500, textTransform: "none" as const }}>(optional — makes probing harder on these)</span>
                </label>
                <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6 }}>
                  {KPMG_PRINCIPLES.map((p) => {
                    const selected = rerunPrinciples.includes(p);
                    return (
                      <button key={p} type="button"
                        onClick={() => setRerunPrinciples(prev => selected ? prev.filter(x => x !== p) : [...prev, p])}
                        style={{ padding: "4px 11px", borderRadius: 0, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "1.5px solid", background: selected ? "#EFF6FF" : "white", borderColor: selected ? "#2563EB" : "#E2E8F0", color: selected ? "#2563EB" : "#94A3B8", fontFamily: "inherit", transition: "all 0.15s" }}>
                        {selected ? "✓ " : ""}{p}
                      </button>
                    );
                  })}
                </div>
              </div>
 
              {rerunError && <div style={{ padding: "10px 14px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 0, fontSize: 12, color: "#DC2626", marginBottom: 14 }}>{rerunError}</div>}
 
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setRerunTarget(null)} style={{ padding: "10px 20px", borderRadius: 0, border: "1.5px solid #E2E8F0", background: "white", color: "#64748B", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                <button
                  onClick={() => { if (!rerunContext.trim()) { setRerunError("Please describe what changed."); return; } setRerunError(""); setRerunStep(2); }}
                  style={{ padding: "10px 24px", borderRadius: 0, border: "none", background: "linear-gradient(135deg, #00338D, #005EB8)", color: "white", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 12px rgba(37,99,235,0.3)" }}>
                  Next →
                </button>
              </div>
            </>)}
 
            {/* ── STEP 2 ── */}
            {rerunStep === 2 && (<>
 
              {/* What will happen */}
              <div style={{ padding: "12px 14px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 0, marginBottom: 14, fontSize: 12, color: "#1D4ED8", lineHeight: 1.65 }}>
                <strong>What happens next:</strong> Phase 1 fingerprinting re-runs first. If drift is detected a full re-audit triggers automatically. Otherwise only failing/weak principles are re-probed — seeded adversarially with your change context.
              </div>
 
              {/* Change context preview */}
              <div style={{ padding: "10px 13px", background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 0, marginBottom: 16, fontSize: 12, color: "#166534" }}>
                <strong>Change context:</strong> {rerunContext.trim().slice(0, 120)}{rerunContext.length > 120 ? "…" : ""}
                {rerunPrinciples.length > 0 && <div style={{ marginTop: 3 }}><strong>Claimed fixes:</strong> {rerunPrinciples.join(", ")}</div>}
              </div>
 
              {/* Endpoint (optional) */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#2563EB", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 6 }}>
                  AI endpoint URL <span style={{ color: "#94A3B8", fontWeight: 500, textTransform: "none" as const }}>(optional — leave blank to reuse prior)</span>
                </label>
                <input type="text" value={rerunEndpoint} onChange={(e) => setRerunEndpoint(e.target.value)}
                  placeholder="https://api.example.com/v1/chat/completions"
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 0, border: "1.5px solid #E2E8F0", fontSize: 13, fontFamily: "inherit", color: "#1E293B", background: "#F8FAFC", outline: "none", boxSizing: "border-box" as const }}
                  onFocus={e => { e.currentTarget.style.borderColor = "#2563EB"; }}
                  onBlur={e => { e.currentTarget.style.borderColor = "#E2E8F0"; }} />
              </div>
 
              {/* API key */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#2563EB", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 6 }}>API key *</label>
                <input type="password" value={rerunApiKey} onChange={(e) => setRerunApiKey(e.target.value)}
                  placeholder="Your AI endpoint API key"
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 0, border: "1.5px solid #E2E8F0", fontSize: 13, fontFamily: "inherit", color: "#1E293B", background: "#F8FAFC", outline: "none", boxSizing: "border-box" as const }}
                  onFocus={e => { e.currentTarget.style.borderColor = "#2563EB"; }}
                  onBlur={e => { e.currentTarget.style.borderColor = "#E2E8F0"; }} />
                <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>Keys are never stored — used for this request only.</p>
              </div>
 
              {rerunError && <div style={{ padding: "10px 14px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 0, fontSize: 12, color: "#DC2626", marginBottom: 14 }}>{rerunError}</div>}
 
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => { setRerunStep(1); setRerunError(""); }} style={{ padding: "10px 20px", borderRadius: 0, border: "1.5px solid #E2E8F0", background: "white", color: "#64748B", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>← Back</button>
                <button onClick={handleSubmitRerun} disabled={rerunLoading}
                  style={{ padding: "10px 24px", borderRadius: 0, border: "none", background: rerunLoading ? "#93C5FD" : "linear-gradient(135deg, #1E3A8A, #2563EB)", color: "white", fontWeight: 700, fontSize: 13, cursor: rerunLoading ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8, boxShadow: rerunLoading ? "none" : "0 4px 12px rgba(37,99,235,0.3)" }}>
                  {rerunLoading ? (
                    <><div style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.4)", borderTop: "2px solid white", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />Running re-audit…</>
                  ) : "↺ Start Re-run"}
                </button>
              </div>
            </>)}
 
          </div>
        </div>
      )}
    </div>
  );
}