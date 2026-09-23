/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from "react";
import AuditContextBar, { LensFooter } from "../components/AuditContextBar";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { getAuditResult } from "../services/api";

import type { Status } from "./_regulatoryConfig";
import {
  STATUS_META,
  CLAUSES,
  FW_META,
  resolveEvidence,
  clauseStatus,
  computeFwSummaries,
  REGULATORY_CSS,
} from "./_regulatoryConfig";

const B = "#00338D", M = "#005EB8";
const FF = "'Plus Jakarta Sans', system-ui, sans-serif";
const FW_KEYS = Object.keys(FW_META);
const DEFAULT_FW = "EU_AI_Act";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStoredData(): any | null {
  try {
    const s = sessionStorage.getItem("lastReportData");
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function extractAuditId(data: any): string | null {
  if (!data) return null;
  return data.audit_id || data.report_id || null;
}

// Status icon SVG
function StatusIcon({ status }: { status: Status }) {
  const sm = STATUS_META[status];
  if (status === "Met") return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={sm.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
  if (status === "Gap") return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={sm.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
  if (status === "Partial") return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={sm.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
  return <span style={{ fontSize: 11, color: sm.color }}>—</span>;
}

// ─── Evidence table (inside expanded clause) ──────────────────────────────────

function EvidenceTable({ clause, data }: { clause: any; data: any }) {
  const rows = clause.evidence.map((e: any) => ({ ...e, resolved: resolveEvidence(data, e) }));

  return (
    <div style={{ padding: "0 24px 20px", borderTop: "1px solid #F1F5F9" }}>
      {/* Intent */}
      <div style={{ margin: "14px 0 12px", padding: "10px 14px", borderRadius: 0, background: "#F8FAFC", border: "1px solid #E2E8F0", fontSize: 12.5, color: "#475569", lineHeight: 1.6 }}>
        <strong style={{ color: "#0F172A" }}>Requirement:</strong> {clause.requirement}
      </div>

      {/* Evidence rows */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.6px", marginBottom: 8 }}>
        Audit evidence — {rows.length} data point{rows.length !== 1 ? "s" : ""}
      </div>

      <div style={{ borderRadius: 0, border: "1px solid #E2E8F0", overflow: "hidden" }}>
        {/* Table header */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 80px", gap: 0, padding: "8px 16px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
          {["Evidence point", "Value found", "Status"].map((h, i) => (
            <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.5px", textAlign: i === 2 ? "center" as const : "left" as const }}>{h}</div>
          ))}
        </div>

        {rows.map((ev: any, i: number) => {
          const esm = STATUS_META[ev.resolved.status as Status];
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 130px 80px", gap: 0, padding: "11px 16px", background: i % 2 === 0 ? "#FAFBFD" : "white", borderBottom: i < rows.length - 1 ? "1px solid #F1F5F9" : "none", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{ev.label}</div>
                {ev.resolved.detail && (
                  <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2, lineHeight: 1.4 }}>{ev.resolved.detail}</div>
                )}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", fontVariantNumeric: "tabular-nums" }}>
                {ev.resolved.value}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <StatusIcon status={ev.resolved.status as Status} />
                <span style={{ fontSize: 10.5, fontWeight: 700, color: esm.color }}>{esm.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Gap / Partial callout */}
      {clause.status === "Gap" && (
        <div style={{ marginTop: 12, padding: "11px 14px", borderRadius: 0, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 12.5, color: "#991B1B", lineHeight: 1.6 }}>
          <strong>Gap identified — {clause.id}.</strong> One or more evidence points do not meet the required threshold. This clause cannot be included in a conformity claim until remediated. See Recommendations for specific actions mapped to {clause.principles.join(", ")}.
        </div>
      )}
      {clause.status === "Partial" && (
        <div style={{ marginTop: 12, padding: "11px 14px", borderRadius: 0, background: "#EFF6FF", border: "1px solid #BFDBFE", fontSize: 12.5, color: "#1E40AF", lineHeight: 1.6 }}>
          <strong>Partial coverage — {clause.id}.</strong> Some evidence meets the threshold but gaps remain. Conformity can be conditionally claimed with documented remediation in progress.
        </div>
      )}
      {clause.status === "Met" && (
        <div style={{ marginTop: 12, padding: "11px 14px", borderRadius: 0, background: "#F0FDF4", border: "1px solid #A7F3D0", fontSize: 12.5, color: "#065F46", lineHeight: 1.6 }}>
          <strong>Requirement satisfied — {clause.id}.</strong> All measured evidence points meet the threshold. This clause can be cited in a conformity assessment or governance submission.
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RegulatoryAlignment() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [data, setData] = useState<any | null>(() => location.state?.data || getStoredData());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchAttempted, setFetchAttempted] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;

  const urlFw    = searchParams.get("framework");
  const urlClause = searchParams.get("clause");
  const initFw   = FW_KEYS.includes(urlFw || "") ? urlFw! : DEFAULT_FW;

  const [selFw,     setSelFw]     = useState(initFw);
  const [expanded,  setExpanded]  = useState<string | null>(urlClause || null);
  const [filterTag, setFilterTag] = useState("all");

  // Sync URL
  useEffect(() => {
    const p = new URLSearchParams();
    p.set("framework", selFw);
    if (expanded) p.set("clause", expanded);
    setSearchParams(p, { replace: true });
  }, [selFw, expanded, setSearchParams]);

  useEffect(() => { setExpanded(null); setFilterTag("all"); }, [selFw]);

  // API fetch fallback
  const attemptFetch = useCallback(async () => {
    setError(null);
    const auditId = extractAuditId(dataRef.current);

    // Case 1: data exists with an auditId — silently refresh in the background
    if (dataRef.current && auditId) {
      try {
        const fresh = await getAuditResult(auditId);
        if (fresh) setData(fresh);
      } catch { /* keep existing data on failure */ }
      setFetchAttempted(true);
      return;
    }

    // Case 2: data exists but no auditId — nothing to refresh
    if (dataRef.current && !auditId) {
      setFetchAttempted(true);
      return;
    }

    // Case 3: no data — try URL param with full loading/error states
    const urlId = searchParams.get("auditId");
    if (urlId) {
      setLoading(true);
      try {
        const result = await getAuditResult(urlId);
        if (result) {
          setData(result);
          sessionStorage.setItem("lastReportData", JSON.stringify(result));
        } else {
          setError("Audit result not found.");
        }
      } catch (err: any) {
        setError(err?.response?.data?.detail || err?.message || "Failed to load audit data.");
      } finally {
        setLoading(false);
        setFetchAttempted(true);
      }
    } else {
      setFetchAttempted(true);
    }
  }, [searchParams]);

  useEffect(() => { if (!fetchAttempted) attemptFetch(); }, [fetchAttempted, attemptFetch]);

  // Retry: extract auditId from stale data, set it as URL param, then re-trigger fetch
  const handleRetry = useCallback(() => {
    const id = extractAuditId(dataRef.current);
    if (id) {
      setSearchParams(prev => { prev.set("auditId", id); return prev; }, { replace: true });
    }
    setData(null);
    setError(null);
    setFetchAttempted(false);
  }, [setSearchParams]);

  // Loading / error / empty states — unchanged from original
  const Spinner = () => (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: FF, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 20 }}>
      <style>{REGULATORY_CSS + `@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width: 40, height: 40, borderRadius: "50%", border: "3px solid #E2E8F0", borderTopColor: M, animation: "spin 0.8s linear infinite" }} />
      <div style={{ fontSize: 15, fontWeight: 600, color: "#64748B" }}>Loading regulatory alignment…</div>
    </div>
  );

  if (loading) return <Spinner />;
  if (!data && !fetchAttempted) return <Spinner />;

  if (error) return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: FF, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <style>{REGULATORY_CSS}</style>
      <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#FEF2F2", border: "1px solid #FECACA", display: "grid", placeItems: "center", color: "#DC2626", fontSize: 22, fontWeight: 900 }}>!</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#1E293B" }}>Unable to load audit data</div>
      <div style={{ fontSize: 13, color: "#64748B", maxWidth: 400, textAlign: "center", lineHeight: 1.6 }}>{error}</div>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={() => navigate("/dashboard")} style={{ padding: "10px 24px", background: M, border: "none", borderRadius: 0, color: "white", fontWeight: 700, cursor: "pointer", fontFamily: FF }}>← Dashboard</button>
        <button onClick={handleRetry} style={{ padding: "10px 24px", background: "white", border: "1.5px solid #E2E8F0", borderRadius: 0, color: "#374151", fontWeight: 600, cursor: "pointer", fontFamily: FF }}>Retry</button>
      </div>
    </div>
  );

  if (!data && fetchAttempted) return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: FF, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <style>{REGULATORY_CSS}</style>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#1E293B" }}>No audit data available</div>
      <div style={{ fontSize: 13, color: "#64748B", maxWidth: 400, textAlign: "center", lineHeight: 1.6 }}>Run an audit from the Dashboard first, then return here to see clause-level regulatory evidence.</div>
      <button onClick={() => navigate("/dashboard")} style={{ padding: "10px 24px", background: M, border: "none", borderRadius: 0, color: "white", fontWeight: 700, cursor: "pointer", fontFamily: FF }}>← Dashboard</button>
    </div>
  );

  // ── Derived data ─────────────────────────────────────────────────────────────
  const clauses    = CLAUSES[selFw] || [];
  const fwMeta     = FW_META[selFw];
  const fwSummaries = computeFwSummaries(data);

  const clauseRows = clauses.map(c => ({ ...c, status: clauseStatus(data, c) }));
  const counts: Record<Status, number> = { Met: 0, Partial: 0, Gap: 0, "N/A": 0 };
  clauseRows.forEach(c => counts[c.status]++);

  const metPct = clauses.length > 0
    ? Math.round(((counts.Met + counts.Partial * 0.5) / clauses.length) * 100)
    : 0;

  const allTags = ["all", ...Array.from(new Set(clauses.flatMap(c => c.tags)))];
  const filtered = filterTag === "all" ? clauseRows : clauseRows.filter(c => c.tags.includes(filterTag));

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: FF, color: "#0F172A" }}>
      <style>{REGULATORY_CSS}</style>
      <style>{`
        @media print { body { background: white !important; } .no-print { display: none !important; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <AuditContextBar data={data} />

      <div style={{ padding: "28px 40px 64px", display: "grid", gridTemplateColumns: "230px 1fr", gap: 22, maxWidth: 1380, margin: "0 auto" }}>

        {/* ── LEFT NAV ───────────────────────────────────────────────────────── */}
        <div className="no-print" style={{ position: "sticky", top: 76, display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Framework selector */}
          <div className="ra-card" style={{ padding: "14px 10px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.6px", padding: "2px 8px", marginBottom: 8 }}>Framework</div>
            {Object.entries(FW_META).map(([key, meta]) => {
              const sum = fwSummaries.find(f => f.key === key);
              const isSel = selFw === key;
              return (
                <button key={key} className={`ra-fw-btn${isSel ? " sel" : ""}`} onClick={() => setSelFw(key)}>
                  <div style={{ fontSize: 12.5, fontWeight: isSel ? 700 : 500, color: isSel ? M : "#374151" }}>{meta.label}</div>
                  <div style={{ fontSize: 10.5, color: "#94A3B8", marginTop: 1 }}>{meta.authority.split("·")[0].trim()}</div>
                  {sum && (
                    <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
                      {[
                        { n: sum.met,     col: "#059669", label: "Met" },
                        { n: sum.partial, col: "#1D4ED8", label: "Partial" },
                        { n: sum.gap,     col: "#64748B", label: "Gap" },
                      ].filter(x => x.n > 0).map(x => (
                        <div key={x.label} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: x.col, fontWeight: 700 }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: x.col }} />
                          {x.n}
                        </div>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Evidence coverage bars */}
          <div className="ra-card" style={{ padding: "14px 14px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.6px", marginBottom: 12 }}>Evidence Coverage</div>
            {fwSummaries.map(fw => (
              <div key={fw.key} style={{ marginBottom: 11 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "#374151" }}>{fw.label}</span>
                  <span style={{ fontSize: 10.5, color: "#94A3B8" }}>{fw.met}/{fw.total}</span>
                </div>
                <div style={{ height: 5, background: "#F1F5F9", borderRadius: 0, overflow: "hidden", display: "flex" }}>
                  <div style={{ width: `${fw.total > 0 ? (fw.met / fw.total) * 100 : 0}%`, background: "#059669", transition: "width 0.5s" }} />
                  <div style={{ width: `${fw.total > 0 ? (fw.partial / fw.total) * 100 : 0}%`, background: "#2563EB", transition: "width 0.5s" }} />
                  <div style={{ width: `${fw.total > 0 ? (fw.gap / fw.total) * 100 : 0}%`, background: "#FECACA", transition: "width 0.5s" }} />
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" as const }}>
              {[{ c: "#059669", l: "Met" }, { c: "#2563EB", l: "Partial" }, { c: "#FECACA", l: "Gap" }].map(x => (
                <div key={x.l} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#64748B" }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: x.c }} />{x.l}
                </div>
              ))}
            </div>
          </div>

          {/* Submission readiness */}
          <div className="ra-card" style={{ padding: "14px", background: counts.Gap === 0 ? "#F0FDF4" : "#F1F5F9", border: `1px solid ${counts.Gap === 0 ? "#A7F3D0" : "#CBD5E1"}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.6px", marginBottom: 8 }}>Submission readiness</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: counts.Gap === 0 ? "#059669" : "#64748B", lineHeight: 1 }}>{metPct}%</div>
            <div style={{ fontSize: 11.5, color: "#475569", marginTop: 4, lineHeight: 1.5 }}>
              {counts.Gap === 0
                ? `All ${counts.Met + counts.Partial} assessed clauses have evidence. Ready for submission.`
                : `${counts.Gap} clause${counts.Gap !== 1 ? "s" : ""} with evidence gaps. Not yet ready for submission.`}
            </div>
          </div>
        </div>

        {/* ── RIGHT CONTENT ──────────────────────────────────────────────────── */}
        <div key={selFw} className="ra-in" style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Framework header */}
          <div className="ra-card" style={{ padding: "22px 28px", borderTop: `3px solid ${M}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap" as const }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.8px", marginBottom: 5 }}>{fwMeta.authority}</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#0F172A", letterSpacing: "-0.3px", marginBottom: 4 }}>{fwMeta.label}</div>
                <div style={{ fontSize: 13, color: "#64748B", lineHeight: 1.6, marginBottom: 4 }}>{fwMeta.desc}</div>
                <div style={{ fontSize: 12, color: "#94A3B8", lineHeight: 1.6 }}>{fwMeta.scope}</div>
              </div>

              {/* Status summary */}
              <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" as const }}>
                {(["Met", "Partial", "Gap", "N/A"] as Status[]).filter(s => counts[s] > 0).map(s => {
                  const sm = STATUS_META[s];
                  return (
                    <div key={s} style={{ textAlign: "center" as const, padding: "10px 16px", borderRadius: 0, background: sm.bg, border: `1px solid ${sm.border}`, minWidth: 56 }}>
                      <div style={{ fontSize: 24, fontWeight: 900, color: sm.color, lineHeight: 1 }}>{counts[s]}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: sm.color, marginTop: 3 }}>{s}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Intent callout */}
            <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 0, background: "#F8FAFC", border: "1px solid #E2E8F0", fontSize: 12.5, color: "#475569", lineHeight: 1.65 }}>
              <strong style={{ color: "#0F172A" }}>What this view shows:</strong>{" "}
              Each row is a specific article or clause from {fwMeta.label}. Expand any row to see the exact measured values from this audit, whether they satisfy the requirement, and what the gap means for a conformity assessment — not a dashboard score, but evidence.
            </div>
          </div>

          {/* Tag filters + Print */}
          <div className="no-print" style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, alignItems: "center" }}>
            {allTags.map(tag => (
              <button key={tag} onClick={() => setFilterTag(tag)} style={{
                padding: "5px 12px", borderRadius: 0, border: "1.5px solid",
                borderColor: filterTag === tag ? M : "#E2E8F0",
                background: filterTag === tag ? "#EEF4FF" : "#fff",
                color: filterTag === tag ? M : "#64748B",
                fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: FF,
              }}>
                {tag === "all" ? `All (${clauses.length})` : tag}
              </button>
            ))}
            <button onClick={() => window.print()} style={{
              marginLeft: "auto", padding: "5px 14px", borderRadius: 0,
              border: `1.5px solid ${M}`, background: "#EEF4FF", color: M,
              fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: FF,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" />
              </svg>
              Export / Print
            </button>
          </div>

          {/* ── Clause table ──────────────────────────────────────────────── */}
          <div className="ra-card" style={{ overflow: "hidden" }}>

            {/* Header row */}
            <div style={{ display: "grid", gridTemplateColumns: "96px 1fr 88px", padding: "10px 24px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
              {["Reference", "Article / Clause", "Evidence status"].map((h, i) => (
                <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: "0.5px", textAlign: i === 2 ? "center" as const : "left" as const }}>{h}</div>
              ))}
            </div>

            {filtered.length === 0 && (
              <div style={{ padding: "40px 24px", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>No clauses match this filter.</div>
            )}

            {filtered.map(clause => {
              const sm   = STATUS_META[clause.status as Status];
              const isOpen = expanded === clause.id;
              return (
                <div key={clause.id} className="ra-clause">
                  {/* Clause header */}
                  <div
                    style={{ display: "grid", gridTemplateColumns: "96px 1fr 88px", padding: "15px 24px", cursor: "pointer", alignItems: "start" }}
                    onClick={() => setExpanded(p => p === clause.id ? null : clause.id)}
                  >
                    {/* Reference */}
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: B, fontFamily: "monospace, monospace" }}>{clause.id}</div>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const, marginTop: 4 }}>
                        {clause.tags.map((t: string) => (
                          <span key={t} style={{ fontSize: 9.5, fontWeight: 700, color: "#64748B", background: "#F1F5F9", padding: "1px 6px", borderRadius: 0 }}>{t}</span>
                        ))}
                      </div>
                    </div>

                    {/* Title */}
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0F172A", marginBottom: 3 }}>{clause.title}</div>
                      <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.55 }}>
                        {clause.requirement.length > 120 ? clause.requirement.slice(0, 120) + "…" : clause.requirement}
                      </div>
                    </div>

                    {/* Status + chevron */}
                    <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 0, background: sm.bg, border: `1px solid ${sm.border}` }}>
                        <StatusIcon status={clause.status as Status} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: sm.color }}>{sm.label}</span>
                      </div>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </div>

                  {/* Expanded evidence */}
                  {isOpen && <EvidenceTable clause={clause} data={data} />}
                </div>
              );
            })}
          </div>

          {/* Submission note */}
          <div className="no-print" style={{ padding: "14px 18px", borderRadius: 0, background: "#EEF4FF", border: `1px solid ${M}22`, fontSize: 12.5, color: "#1E3A5F", lineHeight: 1.7 }}>
            <strong style={{ color: B }}>Using this for a conformity assessment or regulatory submission?</strong>{" "}
            The PDF export includes this evidence table for all four frameworks with the actual field values, statuses, and gap notes — formatted for attachment to a regulatory submission, internal governance review, or third-party audit. Each clause cites the specific audit evidence behind the status verdict, not a derived score.
          </div>
        </div>
      </div>

      <LensFooter data={data} />
    </div>
  );
}