/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import AuditContextBar, { LensFooter } from "../components/AuditContextBar";
import { useLocation, useNavigate } from "react-router-dom";

// ── Design tokens — aligned with ExecutiveSummary ─────────────────────────────
const B = "#00338D", M = "#005EB8";
const FF = "'Plus Jakarta Sans', system-ui, sans-serif";

// Green → good, Blue → ok/watch, Slate → concern (no red/orange harshness)
const sc   = (s: number) => s >= 75 ? "#059669" : s >= 50 ? "#2563EB" : "#64748B";
const sb   = (s: number) => s >= 75 ? "#F0FDF4" : s >= 50 ? "#EFF6FF" : "#F1F5F9";
const band = (s: number) => s >= 75 ? "Strong" : s >= 50 ? "Watch" : "Critical";

// Severity — using the same muted palette, not harsh red
const sevMeta = (sev: string) => {
  if (sev === "High")   return { color: "#64748B", bg: "#F1F5F9", dot: "#64748B", label: "High" };
  if (sev === "Medium") return { color: "#2563EB", bg: "#EFF6FF", dot: "#2563EB", label: "Medium" };
  return                       { color: "#059669", bg: "#F0FDF4", dot: "#059669", label: "Low" };
};

// Re-run status
const statusMeta = (s: string) => {
  const u = (s || "").toUpperCase();
  if (u === "RESOLVED")   return { color: "#059669", bg: "#F0FDF4", label: "Resolved" };
  if (u === "NEW")        return { color: "#2563EB", bg: "#EFF6FF", label: "New" };
  return                         { color: "#94A3B8", bg: "#F8FAFC", label: "Persisting" };
};

const fmt = (d: string) => {
  try { return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return d; }
};

const CSS = `
*{box-sizing:border-box;margin:0;padding:0;}body{background:#F8FAFC;}
.ri-card{background:#fff;border-radius: 0px;border:1px solid #E2E8F0;box-shadow:0 1px 2px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.04);}
.ri-row{display:flex;align-items:flex-start;gap:12px;padding:13px 20px;cursor:pointer;border-bottom:1px solid #F8FAFC;transition:background 0.12s;}
.ri-row:hover{background:#F8FAFC;}
.ri-row:last-child{border-bottom:none;}
.ri-tab{padding:7px 18px;border-radius: 0px;border:1.5px solid;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;transition:all 0.15s;}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.ri-in{animation:fadeUp 0.3s cubic-bezier(.22,1,.36,1) both;}
`;

// ── Deduplicate findings by (category + first 80 chars of issue) ─────────────
function deduplicateFindings(findings: any[]): any[] {
  const seen = new Map<string, any>();
  for (const f of findings) {
    const key = `${f.category || ""}__${(f.issue || f.note || "").slice(0, 80)}`;
    if (seen.has(key)) {
      seen.get(key)._count = (seen.get(key)._count || 1) + 1;
    } else {
      seen.set(key, { ...f, _count: 1 });
    }
  }
  return Array.from(seen.values());
}

// ── Governance readiness verdict ─────────────────────────────────────────────
function getVerdict(r: any, highCount: number) {
  const score = r.overall_score ?? 0;
  const catScores: any = r.category_scores || {};
  const safetyScore  = catScores["Safety"]?.score  ?? catScores["Safety"]  ?? null;
  const privacyScore = catScores["Privacy"]?.score ?? catScores["Privacy"] ?? null;
  const blockers: string[] = [];
  const watches: string[]  = [];

  if (highCount > 0) blockers.push(`${highCount} high-severity finding${highCount > 1 ? "s" : ""} require remediation`);
  if (safetyScore !== null && safetyScore < 40)  blockers.push(`Safety score is critically low (${safetyScore}/100)`);
  if (privacyScore !== null && privacyScore < 40) blockers.push(`Privacy score is critically low (${privacyScore}/100)`);
  if (score < 50) blockers.push(`Governance score below minimum threshold (${score}/100)`);

  if (score >= 50 && score < 75) watches.push("Score below 75 — remediation plan required before full production readiness");
  if ((r.delta_summary?.regressed_count ?? 0) > 0) watches.push(`${r.delta_summary.regressed_count} principle(s) regressed since prior audit`);

  const status = blockers.length > 0 ? "REQUIRES_REMEDIATION"
    : watches.length > 0 ? "CONDITIONAL"
    : "READY";

  const meta = {
    REQUIRES_REMEDIATION: { label: "Requires Remediation",  color: "#64748B", bg: "#F1F5F9", icon: "○" },
    CONDITIONAL:          { label: "Conditional Readiness", color: "#2563EB", bg: "#EFF6FF", icon: "◐" },
    READY:                { label: "Governance Ready",      color: "#059669", bg: "#F0FDF4", icon: "●" },
  }[status];

  return { status, meta, blockers, watches };
}

// ── Movement label display ────────────────────────────────────────────────────
const mvmtColors: Record<string, string> = {
  RESOLVED: "#059669", IMPROVING: "#2563EB", UNCHANGED: "#94A3B8", WORSENING: "#64748B", REGRESSED: "#475569",
};
const mvmtIcons: Record<string, string> = {
  RESOLVED: "↑", IMPROVING: "↑", UNCHANGED: "→", WORSENING: "↓", REGRESSED: "↓",
};

// ── Snake_case → Title Case ───────────────────────────────────────────────────
const titleCase = (s: string) =>
  (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ── Radar chart — 10 governance dimensions at a glance ────────────────────────
function RadarChart({ rows }: { rows: { name: string; score: number; ratingColor: string }[] }) {
  const n = rows.length;
  if (n < 3) return null;
  const size = 300, cx = size / 2, cy = size / 2 - 4, R = 96;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, r: number): [number, number] => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
  const rings = [0.25, 0.5, 0.75, 1];
  const dataPoints = rows.map((row, i) => pt(i, Math.max(row.score, 2) / 100 * R));
  const dataPath = dataPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + " Z";

  return (
    <svg width={size} height={size + 14} viewBox={`0 0 ${size} ${size + 14}`}>
      {rings.map((f, idx) => {
        const ringPts = rows.map((_, i) => pt(i, f * R).join(",")).join(" ");
        return <polygon key={idx} points={ringPts} fill="none" stroke="#E2E8F0" strokeWidth={1} />;
      })}
      {rows.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#E2E8F0" strokeWidth={1} />;
      })}
      <path d={dataPath} fill="#2563EB1A" stroke="#2563EB" strokeWidth={2} strokeLinejoin="round" />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={3.5} fill={rows[i].ratingColor} stroke="white" strokeWidth={1.5} />
      ))}
      {rows.map((row, i) => {
        const [x, y] = pt(i, R + 26);
        const anchor = Math.abs(Math.cos(angle(i))) < 0.2 ? "middle" : Math.cos(angle(i)) > 0 ? "start" : "end";
        return (
          <text key={row.name} x={x} y={y} fontSize={9.5} fontWeight={700} fill="#475569"
            textAnchor={anchor as any} dominantBaseline="middle">
            {row.name.length > 13 ? row.name.slice(0, 12) + "…" : row.name}
          </text>
        );
      })}
    </svg>
  );
}

// ── Donut chart — severity mix ────────────────────────────────────────────────
function Donut({ segments, size = 108, thickness = 15 }: { segments: { value: number; color: string; label: string }[]; size?: number; thickness?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2, c = size / 2, circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="#F1F5F9" strokeWidth={thickness} />
        {total > 0 && segments.filter(s => s.value > 0).map((s, i) => {
          const dash = (s.value / total) * circ;
          const el = (
            <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset}
              transform={`rotate(-90 ${c} ${c})`} strokeLinecap="butt" />
          );
          offset += dash;
          return el;
        })}
        <text x={c} y={c - 2} textAnchor="middle" fontSize={22} fontWeight={900} fill="#0F172A">{total}</text>
        <text x={c} y={c + 14} textAnchor="middle" fontSize={8.5} fontWeight={600} fill="#94A3B8">FINDINGS</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
        {segments.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#374151", fontWeight: 500, flex: 1 }}>{s.label}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: s.color }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Evidence tier chip (Code & Build Risk) ───────────────────────────────────
const tierMeta = (tier: string) => {
  if (tier === "regex")       return { label: "Pattern-matched",  color: "#2563EB", bg: "#EFF6FF" };
  if (tier === "llm_judged")  return { label: "LLM-judged",       color: "#64748B", bg: "#F1F5F9" };
  return                           { label: tier || "—",          color: "#94A3B8", bg: "#F8FAFC" };
};

export default function RiskIntelligence() {
  const location = useLocation();
  const navigate = useNavigate();
  const raw = location.state?.data || (() => {
    try { const s = sessionStorage.getItem("lastReportData"); return s ? JSON.parse(s) : null; }
    catch { return null; }
  })();

  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [expandedPrinciple, setExpandedPrinciple] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"findings" | "principles" | "buildrisk" | "tracker">("findings");
  const [, setAnim] = useState(false);
  useEffect(() => { setTimeout(() => setAnim(true), 60); }, []);

  if (!raw) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: FF }}>
      <button onClick={() => navigate("/dashboard")} style={{ padding: "10px 24px", background: M, border: "none", borderRadius: 0, color: "white", fontWeight: 700, cursor: "pointer" }}>← Back</button>
    </div>
  );

  const r = raw;
  const allFindings: any[]  = r.findings || [];
  const catScores: any       = r.category_scores || {};
  const prn: any             = r.trusted_ai_principles || {};
  const isRerun              = !!(r.parent_audit_id || (r.rerun_sequence && r.rerun_sequence > 1));
  const deltaSummary: any    = r.delta_summary || null;
  const principleDeltas: any[] = r.principle_deltas || [];
  const resolvedFindings: any[] = r.resolved_findings || [];
  const persistingFindings: any[] = r.persisting_findings || [];
  const newFindings: any[]   = r.new_findings || [];

  // Deduplicate before splitting by severity
  const findings   = deduplicateFindings(allFindings);
  const high       = findings.filter((f: any) => f.severity === "High");
  const medium     = findings.filter((f: any) => f.severity === "Medium");
  const low        = findings.filter((f: any) => f.severity === "Low");

  // Principle scores — merge from category_scores and trusted_ai_principles
  const principleMap: Record<string, number> = {};
  for (const [k, v] of Object.entries(catScores)) {
    principleMap[k] = typeof v === "number" ? v : (v as any)?.score ?? 0;
  }
  for (const [k, v] of Object.entries(prn)) {
    if (!(k in principleMap)) principleMap[k] = (v as any)?.score ?? 0;
  }
  // Worst sub-parameter per principle, computed server-side (base_evaluator.compute_risk_analysis)
  const riskItems: any[] = r.risk_analysis?.risk_items || [];
  const worstByPrinciple: Record<string, any> = {};
  for (const item of riskItems) worstByPrinciple[item.principle] = item;

  const HIGH_IMPACT = new Set(["Safety", "Privacy", "Security", "Fairness"]);
  const principleRows = Object.entries(principleMap)
    .map(([name, score]) => {
      const hi = HIGH_IMPACT.has(name);
      const rating = score < 50 ? (hi ? "Critical" : "Below threshold") : score < 75 ? "Watch" : "Strong";
      const ratingColor = score < 50 ? "#64748B" : score < 75 ? "#2563EB" : "#059669";
      const ratingBg    = score < 50 ? "#F1F5F9" : score < 75 ? "#EFF6FF" : "#F0FDF4";
      const delta = principleDeltas.find((d: any) => d.principle === name);
      const pdata: any = prn[name] || {};
      const parameters: Record<string, number> = pdata.parameters || {};
      const description: string = pdata.description || "";
      const worst = worstByPrinciple[name] || null;
      return { name, score, hi, rating, ratingColor, ratingBg, delta, parameters, description, worst };
    })
    .sort((a, b) => {
      // Critical high-impact first, then by score ascending
      const ap = (a.score < 50 && a.hi) ? 0 : (a.score < 50) ? 1 : (a.score < 75) ? 2 : 3;
      const bp = (b.score < 50 && b.hi) ? 0 : (b.score < 50) ? 1 : (b.score < 75) ? 2 : 3;
      return ap !== bp ? ap - bp : a.score - b.score;
    });

  const verdict = getVerdict(r, high.length);

  // Summary counts
  const weakCount    = principleRows.filter(p => p.score < 75).length;
  const criticalCount = principleRows.filter(p => p.score < 50).length;

  // Code & Build Risk — display-only signal layer (build_risk.py)
  const buildRisk: any = r.code_build_risk || null;
  const hasBuildRisk = !!(buildRisk && buildRisk.applicable);
  const buildRiskNarrative: string = buildRisk?.ai_narrative || "";

  // Quantitative model-quality metrics (base_evaluator.model_metrics) — distinct
  // evidence from the LLM-judged findings above: real computed values + thresholds.
  const modelMetrics: any = r.model_metrics || {};
  const metricRows = Object.entries(modelMetrics)
    .filter(([, v]: any) => v && v.value !== null && v.value !== undefined)
    .map(([name, v]: any) => ({ name, ...v }))
    .sort((a: any, b: any) => {
      const rank: Record<string, number> = { High: 0, Moderate: 1, Low: 2 };
      return (rank[a.risk_level] ?? 3) - (rank[b.risk_level] ?? 3);
    });

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: FF, color: "#0F172A" }}>
      <style>{CSS}</style>
      <AuditContextBar data={raw} />

      <div style={{ padding: "28px 40px 64px", maxWidth: 1400, margin: "0 auto" }}>

        {/* ── VERDICT CARD ──────────────────────────────────────────────── */}
        <div className="ri-card ri-in" style={{ padding: "24px 28px", marginBottom: 24, background: verdict.meta.bg, border: `1px solid ${verdict.meta.color}25` }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 18, flexWrap: "wrap" as const }}>

            {/* Status orb */}
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: verdict.meta.color, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 22, fontWeight: 900, flexShrink: 0 }}>
              {verdict.meta.icon}
            </div>

            {/* Text */}
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" as const }}>
                <span style={{ fontSize: 17, fontWeight: 900, color: verdict.meta.color, letterSpacing: "-0.3px" }}>{verdict.meta.label}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 0, background: verdict.meta.color, color: "white", letterSpacing: "0.5px" }}>
                  {verdict.status.replace("_", " ")}
                </span>
                {isRerun && r.rerun_sequence && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 0, background: "#EFF6FF", color: "#2563EB", border: "1px solid #BFDBFE" }}>
                    Re-run #{r.rerun_sequence}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {verdict.blockers.map((b, i) => (
                  <div key={i} style={{ fontSize: 12.5, color: "#475569", display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#64748B", flexShrink: 0 }} />
                    {b}
                  </div>
                ))}
                {verdict.watches.map((w, i) => (
                  <div key={i} style={{ fontSize: 12.5, color: "#2563EB", display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#2563EB", flexShrink: 0 }} />
                    {w}
                  </div>
                ))}
                {verdict.status === "READY" && (
                  <div style={{ fontSize: 12.5, color: "#059669" }}>All governance thresholds met. AI system is cleared for production deployment.</div>
                )}
              </div>
            </div>

            {/* Score + band */}
            <div style={{ display: "flex", gap: 12, flexShrink: 0, flexWrap: "wrap" as const }}>
              <div style={{ textAlign: "center" as const, padding: "12px 18px", background: "white", borderRadius: 0, border: "1px solid #E2E8F0", minWidth: 72 }}>
                <div style={{ fontSize: 26, fontWeight: 900, color: sc(r.overall_score), lineHeight: 1 }}>{r.overall_score}</div>
                <div style={{ fontSize: 9.5, color: "#94A3B8", marginTop: 2, fontWeight: 600 }}>/ 100 OVERALL</div>
              </div>
              <div style={{ textAlign: "center" as const, padding: "12px 18px", background: "white", borderRadius: 0, border: "1px solid #E2E8F0", minWidth: 72 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: sc(r.overall_score), lineHeight: 1.2 }}>{band(r.overall_score)}</div>
                <div style={{ fontSize: 9.5, color: "#94A3B8", marginTop: 2, fontWeight: 600 }}>BAND</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── RE-RUN TREND STRIP ──────────────────────────────────────── */}
        {isRerun && deltaSummary && (
          <div className="ri-card ri-in" style={{ padding: "16px 24px", marginBottom: 24, background: "#F8FAFF", border: "1px solid #BFDBFE" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#2563EB", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 12 }}>
              Risk Movement vs Prior Audit
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" as const }}>
              {[
                { label: "Score change",  val: `${deltaSummary.overall_score_change >= 0 ? "+" : ""}${Math.round(deltaSummary.overall_score_change)}`, color: deltaSummary.overall_score_change >= 0 ? "#059669" : "#64748B", bg: deltaSummary.overall_score_change >= 0 ? "#F0FDF4" : "#F1F5F9" },
                { label: "Resolved",      val: deltaSummary.resolved_count,  color: "#059669", bg: "#F0FDF4" },
                { label: "Improving",     val: deltaSummary.improving_count, color: "#2563EB", bg: "#EFF6FF" },
                { label: "Regressed",     val: deltaSummary.regressed_count, color: "#64748B", bg: "#F1F5F9" },
                { label: "New findings",  val: deltaSummary.new_finding_count ?? 0, color: "#2563EB", bg: "#EFF6FF" },
              ].map((s, i) => (
                <div key={i} style={{ padding: "10px 16px", borderRadius: 0, background: s.bg, textAlign: "center" as const, minWidth: 80 }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.val}</div>
                  <div style={{ fontSize: 9.5, fontWeight: 600, color: s.color, marginTop: 3 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── MAIN LAYOUT ──────────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 252px", gap: 20, alignItems: "start" }}>

          {/* ── LEFT ─────────────────────────────────────────────────── */}
          <div>
            {/* Tabs */}
            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
              {[
                { id: "findings",   label: `Findings (${findings.length})` },
                { id: "principles", label: `Governance Dimensions (${principleRows.length})` },
                ...(hasBuildRisk ? [{ id: "buildrisk", label: "Code & Build Risk" }] : []),
                ...(isRerun && (resolvedFindings.length + newFindings.length + persistingFindings.length) > 0
                  ? [{ id: "tracker", label: "Finding Tracker" }] : []),
              ].map((t) => (
                <button key={t.id} className="ri-tab" onClick={() => setActiveTab(t.id as any)}
                  style={{
                    background: activeTab === t.id ? M : "white",
                    borderColor: activeTab === t.id ? M : "#E2E8F0",
                    color: activeTab === t.id ? "white" : "#64748B",
                  }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── TAB: FINDINGS ─────────────────────────────────────── */}
            {activeTab === "findings" && (
              <div className="ri-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {findings.length === 0 ? (
                  <div className="ri-card" style={{ padding: "52px 32px", textAlign: "center" as const }}>
                    <div style={{ width: 52, height: 52, borderRadius: 0, background: "#F0FDF4", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#059669", marginBottom: 6 }}>No Findings</div>
                    <div style={{ fontSize: 13, color: "#94A3B8" }}>All governance checks passed.</div>
                  </div>
                ) : (
                  <>
                    {[
                      { label: "High Severity", items: high,   sev: "High",   sub: "Governance gaps requiring immediate attention" },
                      { label: "Medium Severity", items: medium, sev: "Medium", sub: "Address within the next review cycle" },
                      { label: "Low Severity",  items: low,    sev: "Low",    sub: "Monitor and review" },
                    ].filter(g => g.items.length > 0).map(group => {
                      const sm = sevMeta(group.sev);
                      return (
                        <div key={group.sev} className="ri-card" style={{ overflow: "hidden" }}>
                          {/* Group header */}
                          <div style={{ padding: "14px 20px", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: sm.dot, flexShrink: 0 }} />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0F172A" }}>{group.label} — {group.items.length}</div>
                              <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 1 }}>{group.sub}</div>
                            </div>
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: sm.color, background: sm.bg, border: `1px solid ${sm.color}25`, padding: "3px 10px", borderRadius: 0 }}>
                              {group.sev}
                            </span>
                          </div>

                          {/* Finding rows */}
                          {group.items.map((f: any, i: number) => {
                            const key = `${group.sev}${i}`;
                            const isExp = expanded === key;
                            const status = f.finding_status || f.status || null;
                            const st = status ? statusMeta(status) : null;
                            const issueText = f.issue || f.note || "";

                            return (
                              <div key={i} className="ri-row" onClick={() => setExpanded(isExp ? null : key)}
                                style={{ background: isExp ? "#F8FAFC" : "white", flexDirection: "column" as const, gap: 0, padding: 0 }}>
                                {/* Row header */}
                                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "13px 20px", width: "100%" }}>
                                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: sm.dot, marginTop: 6, flexShrink: 0 }} />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" as const, marginBottom: 3 }}>
                                      <span style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>{f.category}</span>
                                      {f._count > 1 && (
                                        <span style={{ fontSize: 10, fontWeight: 700, color: "#64748B", background: "#F1F5F9", padding: "1px 7px", borderRadius: 0 }}>
                                          ×{f._count} occurrences
                                        </span>
                                      )}
                                      {st && (
                                        <span style={{ fontSize: 10, fontWeight: 700, color: st.color, background: st.bg, padding: "1px 7px", borderRadius: 0 }}>
                                          {st.label}
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ fontSize: 12.5, color: "#64748B", lineHeight: 1.55, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isExp ? "normal" as const : "nowrap" as const, maxWidth: "100%" }}>
                                      {issueText}
                                    </div>
                                  </div>
                                  <svg style={{ flexShrink: 0, marginTop: 2, transition: "transform 0.2s", transform: isExp ? "rotate(180deg)" : "none" }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                                </div>

                                {/* Expanded detail */}
                                {isExp && (
                                  <div style={{ padding: "0 20px 16px 37px", width: "100%" }}>
                                    {f.probe && (
                                      <div style={{ marginBottom: 10, padding: "10px 14px", background: "#F8FAFC", borderRadius: 0, border: "1px solid #E2E8F0" }}>
                                        <div style={{ fontSize: 9.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 4 }}>Probe</div>
                                        <div style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.6, fontStyle: "italic" as const }}>{f.probe}</div>
                                      </div>
                                    )}
                                    {f.response_preview && (
                                      <div style={{ marginBottom: 10, padding: "10px 14px", background: "#FAFBFF", borderRadius: 0, border: "1px solid #E2E8F0" }}>
                                        <div style={{ fontSize: 9.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 4 }}>AI Response excerpt</div>
                                        <div style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.6 }}>{f.response_preview}</div>
                                      </div>
                                    )}
                                    {f.recommendation && (
                                      <div style={{ padding: "10px 14px", borderRadius: 0, background: "#EEF4FF", border: `1px solid ${M}20` }}>
                                        <div style={{ fontSize: 9.5, fontWeight: 700, color: M, textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 4 }}>Recommended action</div>
                                        <div style={{ fontSize: 12.5, color: B, lineHeight: 1.6 }}>{f.recommendation}</div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}

            {/* ── TAB: GOVERNANCE DIMENSIONS ─────────────────────────── */}
            {activeTab === "principles" && (
              <div className="ri-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="ri-card" style={{ padding: "20px 24px", display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" as const }}>
                <RadarChart rows={principleRows} />
                <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: "#0F172A" }}>Shape of the risk surface</div>
                  <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.6 }}>
                    Dimensions pulled toward the centre are furthest from governance-ready. A well-rounded outer ring means risk is evenly controlled across all {principleRows.length} principles rather than concentrated in one area.
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: "#059669" }}>{principleRows.filter(p => p.score >= 75).length}</div>
                      <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 600 }}>STRONG</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: "#2563EB" }}>{weakCount - criticalCount}</div>
                      <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 600 }}>WATCH</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: "#64748B" }}>{criticalCount}</div>
                      <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 600 }}>CRITICAL</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="ri-card" style={{ overflow: "hidden" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid #F1F5F9" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0F172A" }}>Governance Dimension Risk</div>
                  <div style={{ fontSize: 11.5, color: "#94A3B8", marginTop: 2 }}>Safety, Privacy, Security and Fairness carry elevated regulatory weight — click a row for sub-parameter detail</div>
                </div>
                {principleRows.map((row, i) => {
                  const mvmt = row.delta?.movement_label;
                  const isOpen = expandedPrinciple === row.name;
                  const subParams = Object.entries(row.parameters || {})
                    .sort((a: any, b: any) => a[1] - b[1]); // weakest sub-parameter first
                  return (
                    <div key={row.name} style={{ borderBottom: i < principleRows.length - 1 ? "1px solid #F8FAFC" : "none" }}>
                      <div onClick={() => setExpandedPrinciple(isOpen ? null : row.name)}
                        style={{ padding: "13px 20px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", background: isOpen ? "#F8FAFC" : "white" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7, flexWrap: "wrap" as const }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>{row.name}</span>
                            {row.hi && <span style={{ fontSize: 9, fontWeight: 700, color: M, background: "#EEF4FF", padding: "1px 6px", borderRadius: 0 }}>KEY RISK</span>}
                            <span style={{ fontSize: 10, fontWeight: 700, color: row.ratingColor, background: row.ratingBg, padding: "2px 8px", borderRadius: 0 }}>{row.rating}</span>
                            {mvmt && mvmt !== "UNCHANGED" && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: mvmtColors[mvmt] || "#94A3B8" }}>
                                {mvmtIcons[mvmt]} {row.delta?.score_change != null ? `${row.delta.score_change > 0 ? "+" : ""}${row.delta.score_change}` : ""}
                              </span>
                            )}
                            {subParams.length > 0 && (
                              <span style={{ fontSize: 9, color: "#94A3B8", fontWeight: 600 }}>{subParams.length} sub-parameters</span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ flex: 1, height: 4, background: "#F1F5F9", borderRadius: 0, overflow: "hidden" }}>
                              <div style={{ width: `${row.score}%`, height: "100%", background: row.ratingColor, borderRadius: 0, transition: "width 1s ease" }} />
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 800, color: row.ratingColor, minWidth: 28, textAlign: "right" as const }}>{row.score}</span>
                          </div>
                        </div>
                        {row.delta?.not_reprobed && (
                          <span style={{ fontSize: 10, color: "#94A3B8", fontStyle: "italic" as const, flexShrink: 0 }}>not re-probed</span>
                        )}
                        <svg style={{ flexShrink: 0, transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "none" }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                      </div>

                      {isOpen && (
                        <div className="ri-in" style={{ padding: "0 20px 18px 20px", background: "#F8FAFC" }}>
                          {row.description && (
                            <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.6, marginBottom: 12 }}>{row.description}</div>
                          )}
                          {row.worst && (
                            <div style={{ marginBottom: 12, padding: "9px 14px", background: "#FAFBFF", border: `1px solid ${M}20`, borderRadius: 0 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: M }}>Weakest signal: </span>
                              <span style={{ fontSize: 11.5, color: "#374151" }}>{titleCase(row.worst.worst_param)} ({row.worst.worst_val}/100) — a {row.worst.gap}-point gap to full score</span>
                            </div>
                          )}
                          {subParams.length === 0 ? (
                            <div style={{ fontSize: 11.5, color: "#94A3B8", fontStyle: "italic" as const }}>No sub-parameter detail available for this dimension.</div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              {subParams.map(([key, val]: any) => {
                                const pct = typeof val === "number" ? Math.round(val <= 1 ? val * 100 : val) : 0;
                                const color = pct >= 75 ? "#059669" : pct >= 50 ? "#2563EB" : "#64748B";
                                return (
                                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <div style={{ width: 190, flexShrink: 0, fontSize: 11.5, color: "#374151", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{titleCase(key)}</div>
                                    <div style={{ flex: 1, height: 5, background: "#EEF1F5", borderRadius: 0, overflow: "hidden" }}>
                                      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 0 }} />
                                    </div>
                                    <span style={{ fontSize: 11, fontWeight: 800, color, minWidth: 26, textAlign: "right" as const }}>{pct}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              </div>
            )}

            {/* ── TAB: CODE & BUILD RISK ───────────────────────────────── */}
            {activeTab === "buildrisk" && hasBuildRisk && (
              <div className="ri-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="ri-card" style={{ padding: "18px 24px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" as const, marginBottom: 12 }}>
                    {buildRisk.overall_score !== null && (
                      <div style={{ textAlign: "center" as const, padding: "10px 18px", background: sb(buildRisk.overall_score), borderRadius: 0, border: `1px solid ${sc(buildRisk.overall_score)}25` }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: sc(buildRisk.overall_score) }}>{buildRisk.overall_score}</div>
                        <div style={{ fontSize: 9, color: "#94A3B8", fontWeight: 600 }}>{buildRisk.overall_band?.toUpperCase()}</div>
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0F172A", marginBottom: 3 }}>Code & Build Risk</div>
                      <div style={{ fontSize: 11.5, color: "#94A3B8", lineHeight: 1.5 }}>{buildRisk.note}</div>
                    </div>
                  </div>
                  {buildRiskNarrative && (
                    <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6, padding: "10px 0 2px" }}>
                      {buildRiskNarrative}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                    {[
                      { l: "Built with",    v: buildRisk.context?.built_with },
                      { l: "AI-generated", v: buildRisk.context?.ai_generated },
                      { l: "Human review gate", v: buildRisk.context?.human_review_gate },
                      { l: "Registration reconciliation", v: buildRisk.context?.reconciliation },
                    ].filter(x => x.v).map((x, i) => (
                      <div key={i} style={{ padding: "6px 12px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 0, fontSize: 11 }}>
                        <span style={{ color: "#94A3B8", fontWeight: 600 }}>{x.l}: </span>
                        <span style={{ color: "#374151", fontWeight: 700 }}>{x.v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {Object.entries(
                  (buildRisk.checks || []).reduce((acc: Record<string, any[]>, c: any) => {
                    (acc[c.group] = acc[c.group] || []).push(c);
                    return acc;
                  }, {})
                ).map(([group, checks]: any) => (
                  <div key={group} className="ri-card" style={{ overflow: "hidden" }}>
                    <div style={{ padding: "12px 20px", borderBottom: "1px solid #F1F5F9" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: "#0F172A" }}>{group}</span>
                    </div>
                    {checks.map((c: any, i: number) => {
                      const key = `br_${c.id}`;
                      const isExp = expanded === key;
                      const tier = tierMeta(c.evidence_tier);
                      const unavailable = c.status === "unavailable";
                      return (
                        <div key={c.id} className="ri-row" onClick={() => setExpanded(isExp ? null : key)}
                          style={{ background: isExp ? "#F8FAFC" : "white", flexDirection: "column" as const, gap: 0, padding: 0, borderBottom: i < checks.length - 1 ? "1px solid #F8FAFC" : "none" }}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "13px 20px", width: "100%" }}>
                            <div style={{ width: 5, height: 5, borderRadius: "50%", background: unavailable ? "#CBD5E1" : sc(c.score ?? 0), marginTop: 6, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" as const, marginBottom: 3 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>{c.title}</span>
                                <span style={{ fontSize: 9.5, fontWeight: 700, color: tier.color, background: tier.bg, padding: "1px 7px", borderRadius: 0 }}>{tier.label}</span>
                                {!unavailable && (
                                  <span style={{ fontSize: 10, fontWeight: 700, color: sc(c.score), background: sb(c.score), padding: "1px 7px", borderRadius: 0 }}>{c.band} · {c.score}</span>
                                )}
                              </div>
                              <div style={{ fontSize: 12.5, color: "#64748B", lineHeight: 1.55 }}>{c.plain}</div>
                              <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 3 }}>{c.summary}</div>
                            </div>
                            <svg style={{ flexShrink: 0, marginTop: 2, transition: "transform 0.2s", transform: isExp ? "rotate(180deg)" : "none" }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                          </div>
                          {isExp && (
                            <div style={{ padding: "0 20px 16px 37px", width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                              <div style={{ padding: "10px 14px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 0 }}>
                                <div style={{ fontSize: 9.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 4 }}>How it was checked</div>
                                <div style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.6 }}>{c.how}</div>
                              </div>
                              <div style={{ padding: "10px 14px", background: "#FAFBFF", border: "1px solid #E2E8F0", borderRadius: 0 }}>
                                <div style={{ fontSize: 9.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 4 }}>Why it matters</div>
                                <div style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.6 }}>{c.why}</div>
                              </div>
                              <div style={{ padding: "10px 14px", background: "#F0FDF4", border: "1px solid #05966920", borderRadius: 0 }}>
                                <div style={{ fontSize: 9.5, fontWeight: 700, color: "#059669", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 4 }}>What good looks like</div>
                                <div style={{ fontSize: 12.5, color: "#065F46", lineHeight: 1.6 }}>{c.good}</div>
                              </div>
                              <div style={{ fontSize: 10.5, color: "#94A3B8", fontStyle: "italic" as const }}>
                                {c.probes_run} probe{c.probes_run === 1 ? "" : "s"} run · {c.confidence} confidence · future tier: {c.future_tier}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {/* ── TAB: FINDING TRACKER ──────────────────────────────── */}
            {activeTab === "tracker" && isRerun && (
              <div className="ri-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { label: "Resolved", items: resolvedFindings,   color: "#059669", bg: "#F0FDF4", sub: "Were failing in the prior run — now passing" },
                  { label: "New",      items: newFindings,        color: "#2563EB", bg: "#EFF6FF", sub: "Did not appear in the prior run" },
                  { label: "Persisting", items: persistingFindings, color: "#64748B", bg: "#F1F5F9", sub: "Still open since the prior run" },
                ].filter(g => g.items.length > 0).map(group => (
                  <div key={group.label} className="ri-card" style={{ overflow: "hidden" }}>
                    <div style={{ padding: "12px 20px", background: group.bg, borderBottom: `1px solid ${group.color}18`, display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: group.color }}>{group.label} ({group.items.length})</span>
                      <span style={{ fontSize: 11, color: group.color, marginLeft: 4 }}>— {group.sub}</span>
                    </div>
                    {deduplicateFindings(group.items).map((f: any, i: number) => (
                      <div key={i} style={{ padding: "11px 20px", borderBottom: i < group.items.length - 1 ? "1px solid #F8FAFC" : "none", display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: group.color, marginTop: 5, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>{f.category || f.principle}</div>
                          <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.55 }}>{f.issue || f.note || ""}</div>
                        </div>
                        {f._count > 1 && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", background: "#F8FAFC", padding: "1px 7px", borderRadius: 0, flexShrink: 0 }}>×{f._count}</span>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── RIGHT SIDEBAR ─────────────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky" as const, top: 76 }}>

            {/* Risk summary */}
            <div className="ri-card" style={{ padding: "18px 16px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.6px", marginBottom: 14 }}>Risk Summary</div>
              <Donut segments={[
                { label: "High severity",   value: high.length,   color: "#64748B" },
                { label: "Medium severity", value: medium.length, color: "#2563EB" },
                { label: "Low severity",    value: low.length,    color: "#059669" },
              ]} />
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <div style={{ flex: 1, textAlign: "center" as const, padding: "8px 6px", background: "#EFF6FF", borderRadius: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 900, color: "#2563EB" }}>{weakCount}</div>
                  <div style={{ fontSize: 9, color: "#2563EB", fontWeight: 600 }}>DIMENSIONS &lt; 75</div>
                </div>
                <div style={{ flex: 1, textAlign: "center" as const, padding: "8px 6px", background: "#F1F5F9", borderRadius: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 900, color: "#64748B" }}>{criticalCount}</div>
                  <div style={{ fontSize: 9, color: "#64748B", fontWeight: 600 }}>CRITICAL DIMENSIONS</div>
                </div>
              </div>
            </div>

            {/* Model quality metrics — quantitative, computed evidence */}
            {metricRows.length > 0 && (
              <div className="ri-card" style={{ padding: "18px 16px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.6px", marginBottom: 12 }}>Model Quality Metrics</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {metricRows.slice(0, 6).map((m: any) => {
                    const rc = m.risk_level === "High" ? "#64748B" : m.risk_level === "Moderate" ? "#2563EB" : "#059669";
                    return (
                      <div key={m.name} title={m.description}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
                          <span style={{ fontSize: 11, color: "#374151", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, maxWidth: 140 }}>{titleCase(m.name)}</span>
                          <span style={{ fontSize: 11.5, fontWeight: 800, color: rc }}>{m.value}{m.unit ? ` ${m.unit}` : ""}</span>
                        </div>
                        <div style={{ fontSize: 9.5, color: rc, fontWeight: 600 }}>{m.risk_level} risk</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Governance dimension overview — visual bars */}
            <div className="ri-card" style={{ padding: "18px 16px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.6px", marginBottom: 14 }}>Dimensions at a Glance</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {principleRows.map((row) => (
                  <div key={row.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 11, color: "#374151", fontWeight: 600, width: 86, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{row.name}</div>
                    <div style={{ flex: 1, height: 4, background: "#F1F5F9", borderRadius: 0, overflow: "hidden" }}>
                      <div style={{ width: `${row.score}%`, height: "100%", background: row.ratingColor, borderRadius: 0, transition: "width 1s ease" }} />
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: row.ratingColor, minWidth: 22, textAlign: "right" as const }}>{row.score}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Audit metadata */}
            <div className="ri-card" style={{ padding: "18px 16px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.6px", marginBottom: 12 }}>Audit Details</div>
              {[
                { l: "Risk level",    v: r.risk_level || "—" },
                { l: "Model type",    v: (r.model_label || r.model_type || "—").replace(/_/g, " ") },
                { l: "Evaluated",     v: r.evaluated_at ? fmt(r.evaluated_at) : r.started_at ? fmt(r.started_at) : "—" },
                { l: "Mode",          v: r.mode || "—" },
                ...(isRerun ? [{ l: "Audit run", v: `#${r.rerun_sequence}` }] : []),
              ].map(({ l, v }) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "7px 0", borderBottom: "1px solid #F8FAFC", fontSize: 12 }}>
                  <span style={{ color: "#94A3B8", fontWeight: 500 }}>{l}</span>
                  <span style={{ color: "#334155", fontWeight: 600, textAlign: "right" as const, maxWidth: "55%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <LensFooter data={raw} />
    </div>
  );
}