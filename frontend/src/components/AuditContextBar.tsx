/* eslint-disable @typescript-eslint/no-explicit-any */
import { useNavigate, useLocation } from "react-router-dom";

const B = "#00338D", M = "#005EB8";

// ── Icons ─────────────────────────────────────────────────────────────────────

const IconSummary = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
  </svg>
);
const IconShield = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);
const IconAlert = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);
const IconBrain = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
  </svg>
);
const IconDatabase = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
  </svg>
);
const IconGlobe = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);
const IconLightbulb = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/>
    <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>
  </svg>
);
const IconDownload = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);
const IconTaxonomy = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
  </svg>
);
const IconChevronRight = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);
const IconCode = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
  </svg>
);

// ── Route metadata — matches Sidebar.tsx paths AND ORDER exactly ─────────────
// NOTE: this list previously had 9 entries and was missing "/taf-taxonomy",
// even though Sidebar.tsx's REPORT_ITEMS has 10 and includes it. Because
// LensFooter/AuditContextBar index into *this* array by pathname, visiting
// /taf-taxonomy always produced findIndex() === -1 — which is exactly why
// the footer showed "Step 0 of 9", an empty Prev button, and defaulted
// Next to REPORT_SECTIONS[0] ("Executive Summary"). Keep this list in sync
// with Sidebar.tsx's REPORT_ITEMS — both the entries AND their order —
// whenever a report page is added, removed, or reordered.
const REPORT_SECTIONS = [
  { path: "/audit-overview",        label: "Executive Summary",     shortLabel: "Summary",    icon: IconSummary  },
  { path: "/agent-behaviour",       label: "Data Quality",          shortLabel: "Data",       icon: IconDatabase },
  { path: "/llm-analysis",          label: "LLM Analysis",          shortLabel: "LLM",        icon: IconBrain    },
  { path: "/governance-principles", label: "Governance Principles", shortLabel: "Principles", icon: IconShield   },
  { path: "/taf-taxonomy",          label: "Risk Taxonomy",         shortLabel: "Taxonomy",   icon: IconTaxonomy },
  { path: "/regulatory-alignment",  label: "Regulatory Alignment",  shortLabel: "Regulatory", icon: IconGlobe    },
  { path: "/code-build-risk",       label: "Build Vulnerabilities", shortLabel: "Build",      icon: IconCode     },
  { path: "/risk-intelligence",     label: "Risk Profile",          shortLabel: "Profile",    icon: IconAlert    },
  { path: "/recommendations",       label: "Recommendations",       shortLabel: "Actions",    icon: IconLightbulb},
  { path: "/download-report",       label: "Export Report",         shortLabel: "Export",     icon: IconDownload },
];

// ── AuditContextBar ───────────────────────────────────────────────────────────
// A slim gradient banner showing current section + AI name + score.
// Replaces the old full top-navbar — Sidebar handles all navigation.

export default function AuditContextBar({ data }: { data: any }) {
  const { pathname } = useLocation();

  const score     = data?.overall_score;
  const risk      = data?.risk_level;
  const aiName    = data?.ai_name   || "AI System";
  const modelType = data?.model_label || data?.model_type || "";

  const current  = REPORT_SECTIONS.find(s => s.path === pathname);
  const IconComp = current?.icon;

  const riskCol = risk === "Low" ? "#059669" : risk === "Moderate" ? "#D97706" : "#DC2626";
  const riskBg  = risk === "Low" ? "#DCFCE7" : risk === "Moderate" ? "#FEF3C7" : "#FEE2E2";

  return (
    <div style={{
      background: `linear-gradient(135deg, ${B} 0%, ${M} 100%)`,
      padding: "11px 32px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      flexWrap: "wrap" as const,
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Dot-grid overlay */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: "18px 18px", pointerEvents: "none" }} />

      {/* Left: section + AI name */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
        {/* Current section */}
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {IconComp && (
            <span style={{ color: "rgba(255,255,255,0.65)", display: "flex", flexShrink: 0 }}>
              <IconComp />
            </span>
          )}
          <div>
            <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.4)", lineHeight: 1, marginBottom: 2 }}>
              Audit Report
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "white", letterSpacing: "-0.2px", lineHeight: 1.2 }}>
              {current?.label ?? "Report"}
            </div>
          </div>
        </div>

        <div style={{ width: 1, height: 26, background: "rgba(255,255,255,0.18)", flexShrink: 0 }} />

        {/* AI name */}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 8.5, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px", textTransform: "uppercase" as const, marginBottom: 2 }}>AI System</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, maxWidth: 200 }}>{aiName}</div>
        </div>

        {modelType && (
          <span style={{
            fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.55)",
            background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.14)",
            padding: "2px 8px", borderRadius: 0, flexShrink: 0, whiteSpace: "nowrap" as const,
          }}>{modelType}</span>
        )}
      </div>

      {/* Right: score + risk */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {score != null && (
          <div style={{
            display: "flex", alignItems: "baseline", gap: 3,
            background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.18)",
            padding: "5px 12px", borderRadius: 0,
          }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: "white", lineHeight: 1 }}>{score}</span>
            <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.45)", fontWeight: 600 }}>/100</span>
          </div>
        )}
        {risk && (
          <div style={{
            padding: "4px 11px", borderRadius: 0, fontSize: 11, fontWeight: 700,
            color: riskCol, background: riskBg, border: `1px solid ${riskCol}25`,
          }}>
            {risk} Risk
          </div>
        )}
      </div>
    </div>
  );
}

// ── LensFooter — prev/next section navigator + progress dots ─────────────────

export function LensFooter({ data, currentPath }: { data: any; currentPath?: string }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const active = currentPath || pathname;

  const navTo = (path: string) => navigate(path, { state: { data } });
  const currentIdx = REPORT_SECTIONS.findIndex(s => s.path === active);
  const prev = currentIdx > 0       ? REPORT_SECTIONS[currentIdx - 1] : null;
  const next = currentIdx < REPORT_SECTIONS.length - 1 ? REPORT_SECTIONS[currentIdx + 1] : null;

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 12,
      marginTop: 40, marginBottom: 8,
      padding: "18px 24px", paddingRight: 100, // clears the floating chat button
      background: "white", borderRadius: 0,
      border: "1px solid #E2E8F0",
      boxShadow: "0 2px 10px rgba(15,23,42,0.05)",
    }}>
      <style>{`
        @keyframes lensNextGlow {
          0%, 100% { box-shadow: 0 4px 16px rgba(0,51,141,0.30); }
          50%      { box-shadow: 0 4px 26px rgba(0,51,141,0.55); }
        }
        .lens-next-btn { animation: lensNextGlow 2.2s ease-in-out infinite; }
        .lens-next-btn:hover { transform: translateY(-2px) scale(1.02); }
        .lens-prev-btn:hover { border-color: ${M}; color: ${M}; background: ${M}0A; }
      `}</style>

      <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>
        Step {currentIdx + 1} of {REPORT_SECTIONS.length}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" as const }}>

        {/* ← Prev */}
        <div style={{ flex: "1 1 0", minWidth: 0 }}>
          {prev ? (
            <button
              className="lens-prev-btn"
              onClick={() => navTo(prev.path)}
              style={{ display: "flex", alignItems: "center",      gap: 8, background: "white", border: "1.5px solid #E2E8F0", borderRadius: 0, padding: "11px 18px", cursor: "pointer", color: "#64748B", fontSize: 13, fontWeight: 700, fontFamily: "inherit", transition: "all 0.15s" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><prev.icon /> {prev.label}</span>
            </button>
          ) : <div />}
        </div>

        {/* Progress dots */}
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
          {REPORT_SECTIONS.map((item, idx) => (
            <button
              key={item.path}
              onClick={() => navTo(item.path)}
              title={item.label}
              style={{
                width:      idx === currentIdx ? 22 : 7, height: 7, borderRadius: 0,
                background: idx === currentIdx ? M : "#CBD5E1",
                border: "none", cursor: "pointer", padding: 0,
                transition: "all 0.2s", flexShrink: 0,
              }}
            />
          ))}
        </div>

        {/* Next → */}
        <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", justifyContent: "flex-end" }}>
          {next ? (
            <button
              className="lens-next-btn"
              onClick={() => navTo(next.path)}
              style={{ display: "flex", alignItems: "center", gap: 10, background: `linear-gradient(135deg, ${B}, ${M})`, border:      "none", borderRadius: 0, padding: "13px 24px", cursor: "pointer", color: "white", fontSize: 14, fontWeight: 800, fontFamily: "inherit", transition: "transform 0.15s" }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}><next.icon /> {next.label}</span>
              <IconChevronRight />
            </button>
          ) : (
            <button
              onClick={() => navTo("/download-report")}
              style={{ display: "flex", alignItems: "center", gap: 10, background: `linear-gradient(135deg, ${B}, ${M})`, border:      "none", borderRadius: 0, padding: "13px 24px", cursor: "pointer", color: "white", fontSize: 14, fontWeight: 800, fontFamily: "inherit", boxShadow: "0 4px 16px rgba(0,51,141,0.30)" }}
            >
              Audit complete <IconChevronRight />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}