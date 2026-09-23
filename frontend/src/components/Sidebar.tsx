import { useNavigate, useLocation } from "react-router-dom";
import { isAdmin, useAuth } from "../hooks/useAuth";

/* ── Colours ─────────────────────────────────────────────────────────── */
const B9  = "#00338D";  // deep navy
const BM  = "#005EB8";  // mid blue
const FF  = "'Plus Jakarta Sans', system-ui, sans-serif";

/* ── Nav config — corrected order ────────────────────────────────────── */
const SETUP_ITEMS = [
  {
    label: "Register Agent", path: "/register-ai",
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/><line x1="12" y1="14" x2="12" y2="20"/><line x1="9" y1="17" x2="15" y2="17"/></svg>,
  },
];
const AUDIT_ITEMS = [
  {
    label: "Run Audit", path: "/dashboard",
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  },
];

/*
  CORRECTED FLOW ORDER (matches requested audit narrative):
  1. Executive Summary
  2. Data Quality
  3. LLM Analysis
  4. Governance Principles
  5. Risk Taxonomy
  6. Regulatory Alignment (framework matching)
  7. Build Vulnerabilities
  8. Risk Profile
  9. Recommendations
  10. Export
*/
const REPORT_ITEMS = [
  {
    label: "Executive Summary", path: "/audit-overview",
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  },
  {
    label: "Data Quality", path: "/agent-behaviour",
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>,
  },
  {
    label: "LLM Analysis", path: "/llm-analysis",
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
  },
  {
    label: "Governance Principles", path: "/governance-principles",
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  },
  {
    label: "Risk Taxonomy", path: "/taf-taxonomy",
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  },
  {
    label: "Regulatory Alignment", path: "/regulatory-alignment",
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  },
  {
    label: "Build Vulnerabilities", path: "/code-build-risk",
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  },
  {
    label: "Risk Profile", path: "/risk-intelligence",
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  },
  {
    label: "Recommendations", path: "/recommendations",
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  },
  {
    label: "Export", path: "/download-report",
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  },
];

const WORKSPACE_PATHS = new Set(REPORT_ITEMS.map(l => l.path));

function getReportOpts() {
  try { const s = sessionStorage.getItem("lastReportData"); return s ? { state: { data: JSON.parse(s) } } : {}; } catch { return {}; }
}

/* ── Sidebar NavItem — two variants: top-level and report sub-item ─────── */
function TopItem({ label, icon, locked, active, onClick }: {
  label: string; path: string; icon: React.ReactNode;
  locked?: boolean; active: boolean; onClick: () => void;
}) {
  return (
    <div
      onClick={locked ? undefined : onClick}
      title={locked ? "Register an agent first" : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 9,
        padding: "8px 12px", borderRadius: 0, marginBottom: 1,
        cursor: locked ? "not-allowed" : "pointer",
        background: active ? "rgba(255,255,255,0.15)" : "transparent",
        color: locked ? "rgba(255,255,255,0.25)" : active ? "#fff" : "rgba(255,255,255,0.72)",
        opacity: locked ? 0.5 : 1,
        fontSize: 13, fontWeight: active ? 700 : 500,
        userSelect: "none", position: "relative",
        transition: "background 0.12s, color 0.12s",
        letterSpacing: "-0.1px",
      }}
      onMouseEnter={e => { if (!locked && !active) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.1)"; }}
      onMouseLeave={e => { if (!locked && !active) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      {active && (
        <div style={{ position: "absolute", left: 0, top: "16%", bottom: "16%",        width: 3, borderRadius: 0, background: "#fff" }} />
      )}
      <span style={{ opacity: active ? 1 : 0.8, display: "flex", flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {locked && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      )}
    </div>
  );
}

function ReportItem({ label, active, onClick, index }: {
  label: string; path: string; icon: React.ReactNode;
  active: boolean; onClick: () => void; index: number; total: number;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 9,
        padding: "7px 10px 7px 14px", cursor: "pointer",
        background: active ? "rgba(255,255,255,0.13)" : "transparent",
        color: active ? "#fff" : "rgba(255,255,255,0.62)",
        fontSize: 12.5, fontWeight: active ? 700 : 400,
        userSelect: "none", position: "relative",
        transition: "background 0.12s, color 0.12s",         borderRadius: 0,
        // Top/bottom connector lines for the vertical timeline feel
        borderLeft: `2px solid ${active ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.15)"}`,
        marginLeft: 16,
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.07)"; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      {/* Step number */}
      <div style={{
        width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
        background: active ? "#fff" : "rgba(255,255,255,0.15)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 9, fontWeight: 800,
        color: active ? B9 : "rgba(255,255,255,0.6)",
      }}>
        {index + 1}
      </div>
      <span style={{ flex: 1, lineHeight: 1.3 }}>{label}</span>
      {active && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 6 15 12 9 18"/>
        </svg>
      )}
    </div>
  );
}

/* ── Main sidebar ────────────────────────────────────────────────────── */
export default function Sidebar() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const authUser  = useAuth();
  const admin     = isAdmin();
  const hasAgent  = Boolean(localStorage.getItem("activeAI"));
  const activeAI  = localStorage.getItem("activeAI") || "";
  const isActive  = (p: string) => location.pathname === p;

  const displayName = authUser?.displayName || authUser?.email?.split("@")[0] || "User";
  const initials = displayName.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);

  const go = (path: string) => WORKSPACE_PATHS.has(path)
    ? navigate(path, getReportOpts())
    : navigate(path);

  return (
    <>
      <style>{`
        @keyframes sbPulse{0%,100%{opacity:1}50%{opacity:.4}}
        .sb-logout:hover{background:rgba(255,255,255,0.08)!important;color:#fff!important;}
        .sb-nav{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.25) transparent;}
        .sb-nav::-webkit-scrollbar{width:6px;}
        .sb-nav::-webkit-scrollbar-track{background:transparent;}
        .sb-nav::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.25);border-radius:8px;}
        .sb-nav::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.4);}
      `}</style>
      <aside className="sb-nav" style={{
        width: 220, minHeight: "100vh",
        background: `linear-gradient(180deg, ${B9} 0%, ${BM} 100%)`,
        boxShadow: "4px 0 24px rgba(0,0,0,0.18), 2px 0 8px rgba(0,0,0,0.1)",
        display: "flex", flexDirection: "column",
        flexShrink: 0, position: "sticky", top: 0, height: "100vh", overflowY: "auto",
        fontFamily: FF,
      }}>

        {/* ── Brand ─────────────────────────────────────────────── */}
        <div style={{
          padding: "16px 14px 13px",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          display: "flex", alignItems: "center", gap: 9,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 0, flexShrink: 0,
            background: "rgba(255,255,255,0.15)",
            border: "1.5px solid rgba(255,255,255,0.25)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "#fff", letterSpacing: "-0.3px", lineHeight: 1.2 }}>TrustShield AI</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontWeight: 600, letterSpacing: "0.6px", textTransform: "uppercase", marginTop: 1 }}>Audit Platform</div>
          </div>
        </div>

        {/* ── Active agent chip ─────────────────────────────────── */}
        <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          {hasAgent ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "7px 10px", background: "rgba(255,255,255,0.1)",
              borderRadius: 0, border: "1px solid rgba(255,255,255,0.18)",
            }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#34D399", flexShrink: 0, animation: "sbPulse 2.5s ease-in-out infinite" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>Active Agent</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeAI}</div>
              </div>
            </div>
          ) : (
            <button onClick={() => navigate("/register-ai")} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 7,                  padding: "7px 10px", background: "rgba(255,255,255,0.08)", borderRadius: 0,
              border: "1px solid rgba(255,255,255,0.15)", cursor: "pointer", textAlign: "left",
            }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>Register an agent →</span>
            </button>
          )}
        </div>

        {/* ── Navigation ────────────────────────────────────────── */}
        <nav style={{ flex: 1, padding: "8px 8px 4px" }}>

          {/* Setup */}
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", padding: "6px 8px 3px" }}>Setup</div>
          {SETUP_ITEMS.map(item => (
            <TopItem key={item.path} {...item} active={isActive(item.path)} onClick={() => go(item.path)} />
          ))}

          {/* Audit Pipeline */}
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", padding: "10px 8px 3px" }}>Audit Pipeline</div>
          {AUDIT_ITEMS.map(item => (
            <TopItem key={item.path} {...item} locked={!hasAgent} active={isActive(item.path)} onClick={() => go(item.path)} />
          ))}

          {/* My Audits */}
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", padding: "10px 8px 3px" }}>My Audits</div>
          <TopItem
            label="Audit History"
            path="/profile"
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
            active={isActive("/profile")}
            onClick={() => navigate("/profile")}
          />

          {/* Audit Report — timeline style */}
          <div style={{ margin: "10px 0 0" }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "4px 8px 6px",
            }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.35)" }}>Audit Report</span>
              {!hasAgent && (
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontWeight: 500 }}>locked</span>
              )}
            </div>

            <div style={{
              opacity: hasAgent ? 1 : 0.35,
              pointerEvents: hasAgent ? "auto" : "none",
            }}>
              {REPORT_ITEMS.map((item, i) => (
                <ReportItem
                  key={item.path}
                  {...item}
                  index={i}
                  total={REPORT_ITEMS.length}
                  active={isActive(item.path)}
                  onClick={() => go(item.path)}
                />
              ))}
            </div>
          </div>

          {/* Admin */}
          {admin && (
            <>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", padding: "10px 8px 3px" }}>Admin</div>
              <TopItem
                label="Admin Panel" path="/admin"
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
                active={isActive("/admin")} onClick={() => navigate("/admin")}
              />
            </>
          )}
        </nav>

        {/* ── Footer: user + sign out ───────────────────────────── */}
        <div style={{ padding: "8px 10px 10px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <div
            onClick={() => navigate("/profile")}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "7px 9px", borderRadius: 0, cursor: "pointer", marginBottom: 2,
              background: isActive("/profile") ? "rgba(255,255,255,0.15)" : "transparent",
              border: isActive("/profile") ? "1px solid rgba(255,255,255,0.2)" : "1px solid transparent",
              transition: "background 0.12s",
              position: "relative",
            }}
            onMouseEnter={e => { if (!isActive("/profile")) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.08)"; }}
            onMouseLeave={e => { if (!isActive("/profile")) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
          >
            {isActive("/profile") && (
              <div style={{ position: "absolute", left: 0, top: "16%", bottom: "16%",        width: 3, borderRadius: 0, background: "#fff" }} />
            )}
            <div style={{
              width: 28, height: 28, borderRadius: 0, flexShrink: 0,
              background: "rgba(255,255,255,0.18)",
              border: "1.5px solid rgba(255,255,255,0.25)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10.5, fontWeight: 800, color: "#fff", letterSpacing: "-0.2px",
            }}>{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{authUser?.email || ""}</div>
            </div>
          </div>

          <div
            className="sb-logout"
            onClick={() => { localStorage.removeItem("token"); localStorage.removeItem("activeAI"); navigate("/login"); }}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "6px 9px", borderRadius: 0, cursor: "pointer",
              color: "rgba(255,255,255,0.45)", fontSize: 12.5, fontWeight: 500,
              transition: "background 0.12s, color 0.12s",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign out
          </div>
        </div>
      </aside>
    </>
  );
}