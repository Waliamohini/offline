/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * pages/TafTaxonomy.tsx  — KPMG TAF: Detailed Principle View
 * ===========================================================
 * Merged page: taxonomy controls grouped by principle, with the
 * sub-parameters we compute shown inline per principle. For anything
 * not computed, shows WHY (e.g. training data not provided) and how to fix.
 *
 * Design matches GovernancePrinciples.tsx: no red, grey for low scores,
 * KPMG navy/green/amber palette, SVG icons.
 */

import { useState, useEffect } from "react";
import type { JSX } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AuditContextBar, { LensFooter } from "../components/AuditContextBar";
import { getDetailedTaf } from "../services/api";

const B = "#00338D", M = "#005EB8";
const FF = "'Inter',system-ui,sans-serif";

// Score → colour (no red; grey for low) — matches GovernancePrinciples
const sc = (s: number | null | undefined) =>
  s == null ? "#CBD5E1" : s >= 75 ? "#059669" : s >= 50 ? M : "#64748B";
const band = (s: number | null | undefined) =>
  s == null ? "N/A" : s >= 75 ? "Strong" : s >= 50 ? "Watch" : "Critical";

// Status → styling (no red)
const STATUS: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  "Covered":           { dot: "#059669", text: "#065F46", bg: "#DCFCE7", label: "Covered" },
  "Partial":           { dot: "#D97706", text: "#78350F", bg: "#FEF3C7", label: "Partial" },
  "Not Covered":       { dot: "#94A3B8", text: "#475569", bg: "#F1F5F9", label: "Not Computed" },
  "Training Unlocked": { dot: M,         text: B,         bg: "#EFF6FF", label: "Training Unlocked" },
  "N/A":               { dot: "#CBD5E1", text: "#94A3B8", bg: "#F8FAFC", label: "N/A" },
};

// SVG icon per principle
const ICON: Record<string, JSX.Element> = {
  "Fairness": <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><path d="M5 7l-2 6h4z"/><path d="M19 7l-2 6h4z"/><path d="M3 7h18"/><path d="M8 21h8"/></svg>,
  "Explainability": <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  "Data Integrity": <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>,
  "Security": <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  "Privacy": <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  "Transparency": <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  "Accountability": <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  "Reliability": <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  "Safety": <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  "Sustainability": <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>,
};

const PILLAR_ORDER = ["Fairness","Explainability","Data Integrity","Security","Privacy","Transparency","Accountability","Reliability","Safety","Sustainability"];

function getAiName() { return localStorage.getItem("activeAI") || ""; }

function prettyName(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Sub-parameter row ─────────────────────────────────────────────────────────
function SubParamRow({ name, score }: { name: string; score: number | null }) {
  const pct = score == null ? null : Math.round(score <= 1 ? score * 100 : score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderBottom: "1px solid #F1F5F9" }}>
      <span style={{ flex: 1, fontSize: 13, color: "#334155" }}>{prettyName(name)}</span>
      <div style={{ width: 120, height: 4, background: "#E2E8F0", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct ?? 0}%`, background: sc(pct), transition: "width .5s" }} />
      </div>
      <span style={{ width: 42, textAlign: "right", fontSize: 13, fontWeight: 700, color: sc(pct) }}>
        {pct == null ? "—" : `${pct}%`}
      </span>
    </div>
  );
}

// ── Taxonomy control row ──────────────────────────────────────────────────────
function ControlRow({ row }: { row: any }) {
  const [open, setOpen] = useState(false);
  // Defensive guard: a "Covered" or "Partial" badge implies a real, positive
  // result. If the score is missing or literally 0, that combination is
  // contradictory — treat it as not-yet-evaluated instead of showing a
  // misleading green/amber badge next to a 0% or blank score.
  const hasRealScore = row.score != null && row.score > 0;
  const displayStatus =
    (row.computed_status === "Covered" || row.computed_status === "Partial") && !hasRealScore
      ? "Not Covered"
      : row.computed_status;
  const st = STATUS[displayStatus] || STATUS["N/A"];
  const notComputed = displayStatus === "Not Covered";
  // N/A rows that carry a concrete reason (cross-category controls, or
  // controls the taxonomy itself marks inapplicable) still get a "why" box —
  // just not the training-upload call-to-action styling.
  const naWithReason = row.computed_status === "N/A" && !!row.data_required && row.data_required !== "-";

  return (
    <div style={{ borderBottom: "1px solid #F1F5F9" }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", cursor: "pointer" }}
      >
        <code style={{ fontSize: 11, color: M, fontWeight: 700, minWidth: 92 }}>{row.numbered_id}</code>
        <span style={{ flex: 1, fontSize: 13, color: "#334155" }}>{row.risk}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", fontSize: 11, fontWeight: 700, color: st.text, background: st.bg, whiteSpace: "nowrap" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.dot }} />
          {st.label}
        </span>
        <span style={{ width: 42, textAlign: "right", fontSize: 13, fontWeight: 700, color: sc(row.score) }}>
          {row.score == null ? "—" : `${Math.round(row.score)}%`}
        </span>
        <span style={{ color: "#CBD5E1", fontSize: 10, width: 12 }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ padding: "10px 14px 14px", background: "#F8FAFF", fontSize: 12, color: "#475569", lineHeight: 1.7 }}>
          {row.test && <div><strong style={{ color: "#334155" }}>How it's tested:</strong> {row.test}</div>}
          {row.evidence && <div style={{ marginTop: 4 }}><strong style={{ color: "#334155" }}>Evidence:</strong> {row.evidence}</div>}
          {row.score_source === "Governance evaluation score" && (
            <div style={{ marginTop: 4, fontSize: 11, color: "#94A3B8", fontStyle: "italic" }}>
              Scored from this principle's sub-parameters above.
            </div>
          )}

          {/* WHY NOT COMPUTED — the key ask */}
          {notComputed && (
            <div style={{ marginTop: 8, padding: "10px 12px", background: row.training_gated ? "#EFF6FF" : "#F1F5F9", border: `1px solid ${row.training_gated ? "#BFDBFE" : "#E2E8F0"}` }}>
              <div style={{ fontWeight: 700, color: row.training_gated ? B : "#475569", marginBottom: 3 }}>
                {row.training_gated ? "⬆ Not computed — training data required" : "Not computed — out of audit scope"}
              </div>
              <div style={{ color: row.training_gated ? "#1E3A5F" : "#64748B" }}>
                {row.training_gated
                  ? "Training / fine-tuning data was not provided. Upload it in the audit pipeline and this control will be computed automatically (bias-in-training, memorisation, or carbon-footprint proxies)."
                  : (row.data_required || "This control needs infrastructure or data access beyond external black-box probing.")}
              </div>
            </div>
          )}

          {/* N/A WITH A REASON — cross-category controls, or controls the
              taxonomy itself marks inapplicable for this AI type */}
          {naWithReason && (
            <div style={{ marginTop: 8, padding: "10px 12px", background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
              <div style={{ fontWeight: 700, color: "#94A3B8", marginBottom: 3 }}>Not applicable to this AI system</div>
              <div style={{ color: "#64748B" }}>{row.data_required}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Principle accordion ───────────────────────────────────────────────────────
function PrincipleCard({ p, defaultOpen }: { p: any; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const score = p.score == null ? null : Math.round(p.score);
  const accent = sc(score);

  return (
    <div style={{ border: "1px solid #E2E8F0", borderLeft: `3px solid ${accent}`, marginBottom: 8, background: "#fff" }}>
      {/* Header */}
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", cursor: "pointer", background: open ? "#FAFBFF" : "#fff", userSelect: "none" }}>
        <span style={{ color: accent, display: "flex" }}>{ICON[p.pillar]}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#0F172A", letterSpacing: "-.02em" }}>{p.pillar}</div>
          <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
            {p.covered_count}/{p.control_count} controls computed · {p.sub_parameters.length} sub-parameters
          </div>
        </div>
        {score != null && (
          <div style={{ textAlign: "center", minWidth: 54 }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: accent, lineHeight: 1 }}>{score}</div>
            <div style={{ fontSize: 9, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: ".06em" }}>{band(score)}</div>
          </div>
        )}
        <span style={{ color: "#CBD5E1", fontSize: 11 }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ borderTop: `1px solid ${accent}22` }}>
          <div style={{ padding: "8px 20px 16px" }}>
            {/* Sub-parameters — the exact signals that feed this pillar's
                score, shown inline instead of behind a second tab. Any
                control below whose evidence is sourced from this principle
                evaluation (rather than a blackbox probe) says so, pointing
                back up here. */}
            {p.sub_parameters.length > 0 && (
              <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid #F1F5F9" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>
                  Principle Signals ({p.sub_parameters.length})
                </div>
                {p.sub_parameters.map((sp: any) => <SubParamRow key={sp.name} name={sp.name} score={sp.score} />)}
              </div>
            )}

            <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>
              Taxonomy Controls ({p.control_count})
            </div>
            {p.controls.length ? p.controls.map((c: any) => <ControlRow key={c.numbered_id} row={c} />)
              : <div style={{ padding: "16px 0", color: "#94A3B8", fontSize: 13 }}>No controls for this principle in the current AI category.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function TafTaxonomy() {
  const location = useLocation();
  const navigate = useNavigate();

  // Same contract as every other report sub-page (RiskIntelligence,
  // RegulatoryAlignment, AgentBehaviour, Recommendations, RerunComparison):
  // the report payload is handed down via router state when the sidebar
  // navigates here, with a sessionStorage fallback for refreshes/deep-links.
  // TafTaxonomy previously skipped this entirely and only read
  // localStorage("activeAI") directly — that's what desynced it from the
  // step wizard: AuditContextBar/LensFooter never received `data`, so the
  // footer had nothing to compute the current step from and fell back to
  // "STEP 0 OF 9" with the default "Executive Summary" link.
  const raw = location.state?.data || (() => {
    try { const s = sessionStorage.getItem("lastReportData"); return s ? JSON.parse(s) : null; }
    catch { return null; }
  })();

  // ai_name should come from the report we were actually navigated with,
  // not a possibly-stale localStorage value — but keep the old key as a
  // last-resort fallback for direct links / bookmarks.
  const aiName = raw?.ai_name || getAiName();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTaf = () => {
    if (!aiName) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    getDetailedTaf(aiName)
      .then(r => setData(r.data))
      .catch(err => {
        setData(null);
        if (err?.response?.status === 404) {
          setError(null); // handled by the normal empty state below
          return;
        }
        // Surface the real cause instead of a generic message — a 500 here
        // (e.g. a backend SQL error) was previously indistinguishable from
        // a genuine network timeout, which made this impossible to
        // self-diagnose. Show the backend's own detail text when present.
        const status = err?.response?.status;
        const detail = err?.response?.data?.detail;
        setError(
          status
            ? `Server error (${status})${detail ? `: ${detail}` : ""} — this is a backend issue, not a network timeout. Check the backend logs.`
            : "Couldn't reach the server — no response received. Check the backend is running and reachable."
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTaf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiName]);

  const principles = data?.principles || [];
  const summary = data?.summary || {};
  const engine = data?.engine_status || {};
  const coverage = summary.coverage_pct || 0;

  return (
    <div style={{ fontFamily: FF, color: "#0F172A", minHeight: "100vh", background: "#F7F9FC" }}>
      <AuditContextBar data={raw} />

      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${B} 0%, ${M} 100%)`, padding: "28px 40px 24px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.5)", letterSpacing: "2.5px", textTransform: "uppercase", marginBottom: 8 }}>
          KPMG Trusted AI Framework
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 20 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 900, color: "#fff", letterSpacing: "-.04em", marginBottom: 6 }}>
              Risk Taxonomy — Principle Detail
            </h1>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,.6)", maxWidth: 560, lineHeight: 1.65 }}>
              Every taxonomy control grouped by principle, with the sub-parameters we compute shown inline.
              Anything not computed shows why — and how to unlock it.
            </p>
          </div>
          {data && (
            <div style={{ display: "flex", gap: 2 }}>
              {[
                { label: "Coverage",    val: `${coverage}%`,              bg: sc(coverage) },
                { label: "Covered",     val: summary.covered || 0,       bg: "#059669" },
                { label: "Partial",     val: summary.partial || 0,       bg: "#D97706" },
                { label: "Not Computed",val: summary.not_covered || 0,   bg: "#64748B" },
              ].map(c => (
                <div key={c.label} style={{ background: c.bg, padding: "10px 14px", textAlign: "center", minWidth: 72 }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{c.val}</div>
                  <div style={{ fontSize: 8, fontWeight: 700, color: "#fff", opacity: .8, textTransform: "uppercase", letterSpacing: ".08em", marginTop: 3 }}>{c.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: "20px 40px 40px" }}>
        {/* Engine tier honesty banner */}
        {data && Object.keys(engine).length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18, alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".06em" }}>Analysis engines:</span>
            {Object.entries(engine).map(([k, v]: any) => (
              <span key={k} style={{
                display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", fontSize: 11, fontWeight: 600,
                background: v.tier === "ml" ? "#DCFCE7" : "#F1F5F9",
                color: v.tier === "ml" ? "#065F46" : "#64748B",
              }}>
                {k}: {v.engine} {v.tier === "ml" ? "✓" : "(basic)"}
              </span>
            ))}
          </div>
        )}

        {loading && <div style={{ textAlign: "center", padding: "60px 0", color: "#94A3B8", fontSize: 14 }}>Loading…</div>}

        {/* Network/server error — distinct from "no assessment yet" so the
            page never just spins forever with no way out */}
        {!loading && error && (
          <div style={{ textAlign: "center", padding: "80px 20px", border: "1px dashed #E2E8F0", background: "#fff" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#475569", marginBottom: 8 }}>{error}</div>
            <button
              onClick={fetchTaf}
              style={{ padding: "10px 24px", border: "none", fontFamily: FF, background: `linear-gradient(135deg,${B},${M})`, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", marginTop: 8 }}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && data && PILLAR_ORDER
          .map(name => principles.find((p: any) => p.pillar === name))
          .filter(Boolean)
          .map((p: any, i: number) => <PrincipleCard key={p.pillar} p={p} defaultOpen={i < 2} />)}

        {/* Empty state */}
        {!loading && !error && !data && (
          <div style={{ textAlign: "center", padding: "80px 20px", border: "1px dashed #E2E8F0", background: "#fff" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5" style={{ marginBottom: 16 }}>
              <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
            </svg>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#475569", marginBottom: 8 }}>No assessment for {aiName || "this AI system"}</div>
            <div style={{ fontSize: 13, color: "#94A3B8", maxWidth: 420, margin: "0 auto 24px", lineHeight: 1.7 }}>
              The taxonomy detail is generated automatically when you run a Full Governance Evaluation from the audit pipeline.
            </div>
            <button onClick={() => navigate("/dashboard")} style={{ padding: "10px 24px", border: "none", fontFamily: FF, background: `linear-gradient(135deg,${B},${M})`, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              Go to Audit Pipeline →
            </button>
          </div>
        )}

        {data && (
          <div style={{ marginTop: 20, padding: "10px 16px", background: "#fff", border: "1px solid #E2E8F0", fontSize: 11, color: "#94A3B8", lineHeight: 1.7 }}>
            <strong style={{ color: "#64748B" }}>How scores are computed:</strong>{" "}
            Each principle score is the weighted average of its sub-parameters. Taxonomy controls draw from the same
            sub-parameters plus blackbox probe results where applicable. Green ✓ engines are real ML models; "(basic)"
            engines use keyword/regex heuristics — install detoxify and presidio (free) to upgrade them.
          </div>
        )}
      </div>

      <LensFooter data={raw} />
    </div>
  );
}