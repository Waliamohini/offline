/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from "recharts";

/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */
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
  // Principle scores (if available)
  principle_scores?: Record<string, number>;
}

interface AIGroupData {
  ai_name: string;
  runs: AuditRecord[];
  hasReruns: boolean;
}

const BASE_URL = "http://localhost:8000";

// KPMG color palette
const CHART_COLORS = ["#00338D", "#005EB8", "#0091DA", "#00A3A1", "#059669"];

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
const fmtDate = (d: string | null) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric"
  });
};

const fmtDateTime = (d: string | null) => {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
};

const scoreGrade = (score: number) => {
  if (score >= 80) return { label: "Excellent", color: "#059669", bg: "#DCFCE7" };
  if (score >= 65) return { label: "Good", color: "#2563EB", bg: "#EFF6FF" };
  if (score >= 50) return { label: "Fair", color: "#2563EB", bg: "#EFF6FF" };
  return { label: "Poor", color: "#64748B", bg: "#F1F5F9" };
};

/* ─────────────────────────────────────────────
   Component
───────────────────────────────────────────── */
export default function AuditHistory() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [aiGroups, setAiGroups] = useState<AIGroupData[]>([]);
  const [selectedAI, setSelectedAI] = useState<string>("");

  useEffect(() => {
    loadAuditHistory();
  }, []);

  const authHeader = () => {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const loadAuditHistory = async () => {
    try {
      const res = await axios.get(`${BASE_URL}/blackbox/history-all`, {
        headers: authHeader()
      });
      const audits: AuditRecord[] = res.data.history || [];

      // Group by ai_name
      const grouped = new Map<string, AuditRecord[]>();
      audits.forEach(audit => {
        const arr = grouped.get(audit.ai_name) || [];
        arr.push(audit);
        grouped.set(audit.ai_name, arr);
      });

      // Sort runs within each AI by rerun_sequence asc then created_at asc
      const groups: AIGroupData[] = [];
      grouped.forEach((runs, ai_name) => {
        const sorted = runs.sort((a, b) => {
          const seqA = a.rerun_sequence ?? 1;
          const seqB = b.rerun_sequence ?? 1;
          if (seqA !== seqB) return seqA - seqB;
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });
        const hasReruns = sorted.some(r => (r.rerun_sequence ?? 1) > 1);
        groups.push({ ai_name, runs: sorted, hasReruns });
      });

      // Sort groups alphabetically
      groups.sort((a, b) => a.ai_name.localeCompare(b.ai_name));

      setAiGroups(groups);
      if (groups.length > 0) {
        setSelectedAI(groups[0].ai_name);
      }
    } catch {
      setAiGroups([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAuditClick = async (audit: AuditRecord) => {
    try {
      const res = await axios.get(`${BASE_URL}/blackbox/audit/${audit.audit_id}`, {
        headers: authHeader()
      });
      navigate("/report", { state: { data: res.data } });
    } catch {
      navigate("/report", { state: { data: audit } });
    }
  };

  const selectedGroup = aiGroups.find(g => g.ai_name === selectedAI);

  // Prepare chart data for selected AI
  const scoreProgressionData = selectedGroup?.runs.map((run) => ({
    name: run.rerun_sequence ? `R${run.rerun_sequence}` : "Baseline",
    runNumber: run.rerun_sequence ?? 1,
    score: run.overall_score,
    date: fmtDate(run.created_at),
  })) || [];

  // Prepare principle comparison data (grouped bar chart)
  // Extract all principles from all runs
  const allPrinciples = new Set<string>();
  selectedGroup?.runs.forEach(run => {
    if (run.principle_scores) {
      Object.keys(run.principle_scores).forEach(p => allPrinciples.add(p));
    }
  });

  const principleComparisonData = Array.from(allPrinciples).map(principle => {
    const dataPoint: any = { principle };
    selectedGroup?.runs.forEach((run) => {
      const runLabel = run.rerun_sequence ? `R${run.rerun_sequence}` : "Baseline";
      dataPoint[runLabel] = run.principle_scores?.[principle] ?? null;
    });
    return dataPoint;
  });

  if (loading) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
        padding: 40,
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        color: "#F1F5F9",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 48, height: 48, border: "4px solid rgba(255,255,255,0.1)",
            borderTop: "4px solid #0091DA", borderRadius: "50%",
            animation: "spin 1s linear infinite", margin: "0 auto"
          }} />
          <p style={{ marginTop: 16, fontSize: 14, color: "rgba(255,255,255,0.6)" }}>
            Loading audit history...
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .ai-tab {
          padding: 12px 20px;
          border: none;
          background: rgba(255,255,255,0.05);
          color: rgba(255,255,255,0.6);
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          border-radius: 0 0 0;
          transition: all 0.2s;
          border-bottom: 2px solid transparent;
        }
        .ai-tab:hover {
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.8);
        }
        .ai-tab.active {
          background: white;
          color: #00338D;
          border-bottom: 2px solid #0091DA;
        }
        .chart-card {
          background: white;
          border-radius: 0px;
          padding: 24px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
          margin-bottom: 24px;
        }
        .run-card {
          background: white;
          border-radius: 0px;
          padding: 20px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
          border-left: 4px solid #0091DA;
          cursor: pointer;
          transition: all 0.2s;
        }
        .run-card:hover {
          box-shadow: 0 6px 16px rgba(0,0,0,0.12);
          transform: translateX(4px);
        }
        .badge {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 0px;
          font-size: 12px;
          font-weight: 600;
        }
        .badge-positive {
          background: #DCFCE7;
          color: #059669;
        }
        .badge-negative {
          background: #FEE2E2;
          color: #DC2626;
        }
        .badge-neutral {
          background: #F1F5F9;
          color: #64748B;
        }
      `}</style>

      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
        padding: 40,
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        color: "#F1F5F9"
      }}>
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
          {/* Header */}
          <div style={{
            marginBottom: 32,
            animation: "fadeIn 0.6s ease-out"
          }}>
            <h1 style={{
              fontSize: 32,
              fontWeight: 800,
              margin: "0 0 8px",
              background: "linear-gradient(135deg, #0091DA, #00A3A1)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent"
            }}>
              Audit Re-run Intelligence
            </h1>
            <p style={{
              fontSize: 16,
              color: "rgba(255,255,255,0.6)",
              margin: 0
            }}>
              Track how your AI governance posture improves across re-runs
            </p>
          </div>

          {aiGroups.length === 0 && (
            <div style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 0,
              padding: 40,
              textAlign: "center"
            }}>
              <p style={{ fontSize: 16, color: "rgba(255,255,255,0.6)" }}>
                No audit history found. Run your first audit to get started.
              </p>
            </div>
          )}

          {aiGroups.length > 0 && (
            <>
              {/* AI System Selector Tabs */}
              <div style={{
                display: "flex",
                gap: 8,
                marginBottom: 24,
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                animation: "fadeIn 0.6s ease-out 0.1s backwards"
              }}>
                {aiGroups.map(group => (
                  <button
                    key={group.ai_name}
                    className={`ai-tab ${selectedAI === group.ai_name ? "active" : ""}`}
                    onClick={() => setSelectedAI(group.ai_name)}
                  >
                    {group.ai_name}
                    {group.hasReruns && (
                      <span style={{
                        marginLeft: 8,
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 0,
                        background: selectedAI === group.ai_name ? "#DCFCE7" : "rgba(255,255,255,0.1)",
                        color: selectedAI === group.ai_name ? "#059669" : "rgba(255,255,255,0.5)"
                      }}>
                        {group.runs.length} runs
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {selectedGroup && (
                <>
                  {!selectedGroup.hasReruns ? (
                    <div style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 0,
                      padding: 32,
                      textAlign: "center",
                      animation: "fadeIn 0.6s ease-out 0.2s backwards"
                    }}>
                      <div style={{
                        width: 64,
                        height: 64,
                        borderRadius: "50%",
                        background: "rgba(0,145,218,0.1)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 16px"
                      }}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0091DA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="23 4 23 10 17 10" />
                          <polyline points="1 20 1 14 7 14" />
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                      </div>
                      <p style={{
                        fontSize: 18,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.8)",
                        margin: "0 0 8px"
                      }}>
                        No re-runs yet
                      </p>
                      <p style={{
                        fontSize: 14,
                        color: "rgba(255,255,255,0.5)",
                        margin: 0
                      }}>
                        Click "Re-run Audit" on any report to start tracking improvement
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Score Progression Chart */}
                      <div className="chart-card" style={{
                        animation: "fadeIn 0.6s ease-out 0.2s backwards"
                      }}>
                        <h3 style={{
                          fontSize: 18,
                          fontWeight: 700,
                          color: "#1E293B",
                          margin: "0 0 16px"
                        }}>
                          Score Progression
                        </h3>
                        <ResponsiveContainer width="100%" height={300}>
                          <LineChart data={scoreProgressionData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis dataKey="name" stroke="#64748B" style={{ fontSize: 12 }} />
                            <YAxis domain={[0, 100]} stroke="#64748B" style={{ fontSize: 12 }} />
                            <Tooltip
                              contentStyle={{
                                background: "white",
                                border: "1px solid #E2E8F0",
                                borderRadius: 0,
                                fontSize: 12
                              }}
                            />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Line
                              type="monotone"
                              dataKey="score"
                              stroke="#0091DA"
                              strokeWidth={3}
                              dot={{ fill: "#00338D", r: 5 }}
                              activeDot={{ r: 7 }}
                              name="Overall Score"
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Principle Scores Across Runs */}
                      {principleComparisonData.length > 0 && (
                        <div className="chart-card" style={{
                          animation: "fadeIn 0.6s ease-out 0.3s backwards"
                        }}>
                          <h3 style={{
                            fontSize: 18,
                            fontWeight: 700,
                            color: "#1E293B",
                            margin: "0 0 16px"
                          }}>
                            Principle Scores Across Runs
                          </h3>
                          <ResponsiveContainer width="100%" height={400}>
                            <BarChart data={principleComparisonData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                              <XAxis dataKey="principle" stroke="#64748B" style={{ fontSize: 11 }} angle={-45} textAnchor="end" height={100} />
                              <YAxis domain={[0, 100]} stroke="#64748B" style={{ fontSize: 12 }} />
                              <Tooltip
                                contentStyle={{
                                  background: "white",
                                  border: "1px solid #E2E8F0",
                                  borderRadius: 0,
                                  fontSize: 12
                                }}
                              />
                              <Legend wrapperStyle={{ fontSize: 12 }} />
                              {selectedGroup.runs.map((run, idx) => {
                                const runLabel = run.rerun_sequence ? `R${run.rerun_sequence}` : "Baseline";
                                return (
                                  <Bar
                                    key={runLabel}
                                    dataKey={runLabel}
                                    fill={CHART_COLORS[idx % CHART_COLORS.length]}
                                    radius={[4, 4, 0, 0]}
                                  />
                                );
                              })}
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* Run Timeline */}
                      <div style={{
                        animation: "fadeIn 0.6s ease-out 0.4s backwards"
                      }}>
                        <h3 style={{
                          fontSize: 18,
                          fontWeight: 700,
                          color: "#F1F5F9",
                          margin: "0 0 16px"
                        }}>
                          Run Timeline
                        </h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                          {selectedGroup.runs.map((run) => {
                            const delta = run.delta_summary;
                            const scoreChange = delta?.overall_score_change ?? 0;
                            const { color, bg } = scoreGrade(run.overall_score);

                            return (
                              <div
                                key={run.audit_id}
                                className="run-card"
                                onClick={() => handleAuditClick(run)}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 12 }}>
                                  <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                      <span style={{
                                        fontSize: 16,
                                        fontWeight: 700,
                                        color: "#1E293B"
                                      }}>
                                        {run.rerun_sequence ? `Re-run ${run.rerun_sequence}` : "Baseline"}
                                      </span>
                                      {scoreChange !== 0 && (
                                        <span className={scoreChange > 0 ? "badge badge-positive" : "badge badge-negative"}>
                                          {scoreChange > 0 ? "+" : ""}{scoreChange.toFixed(1)}
                                        </span>
                                      )}
                                    </div>
                                    <p style={{
                                      fontSize: 13,
                                      color: "#64748B",
                                      margin: 0
                                    }}>
                                      {fmtDateTime(run.created_at)}
                                      {run.rerun_scope && (
                                        <span style={{ marginLeft: 8, fontWeight: 600 }}>
                                          • {run.rerun_scope}
                                        </span>
                                      )}
                                    </p>
                                  </div>
                                  <div style={{
                                    padding: "8px 16px",
                                    borderRadius: 0,
                                    background: bg,
                                    color: color,
                                    fontSize: 20,
                                    fontWeight: 800
                                  }}>
                                    {run.overall_score}
                                  </div>
                                </div>

                                {run.operator_change_context && (
                                  <div style={{
                                    background: "#F8FAFC",
                                    border: "1px solid #E2E8F0",
                                    borderRadius: 0,
                                    padding: 12,
                                    marginBottom: 12,
                                    fontSize: 13,
                                    color: "#475569"
                                  }}>
                                    <strong>Context:</strong> {run.operator_change_context}
                                  </div>
                                )}

                                {delta && (
                                  <div style={{
                                    display: "flex",
                                    gap: 16,
                                    flexWrap: "wrap"
                                  }}>
                                    {delta.resolved_count > 0 && (
                                      <div>
                                        <span style={{ fontSize: 12, color: "#64748B" }}>Resolved: </span>
                                        <span style={{ fontSize: 14, fontWeight: 700, color: "#059669" }}>
                                          {delta.resolved_count}
                                        </span>
                                      </div>
                                    )}
                                    {delta.new_finding_count > 0 && (
                                      <div>
                                        <span style={{ fontSize: 12, color: "#64748B" }}>New: </span>
                                        <span style={{ fontSize: 14, fontWeight: 700, color: "#DC2626" }}>
                                          {delta.new_finding_count}
                                        </span>
                                      </div>
                                    )}
                                    {delta.improving_count > 0 && (
                                      <div>
                                        <span style={{ fontSize: 12, color: "#64748B" }}>Improving: </span>
                                        <span style={{ fontSize: 14, fontWeight: 700, color: "#0891B2" }}>
                                          {delta.improving_count}
                                        </span>
                                      </div>
                                    )}
                                    {delta.worsening_count > 0 && (
                                      <div>
                                        <span style={{ fontSize: 12, color: "#64748B" }}>Worsening: </span>
                                        <span style={{ fontSize: 14, fontWeight: 700, color: "#F59E0B" }}>
                                          {delta.worsening_count}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                )}

                                <button style={{
                                  marginTop: 12,
                                  padding: "8px 16px",
                                  background: "#00338D",
                                  color: "white",
                                  border: "none",
                                  borderRadius: 0,
                                  fontSize: 13,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  transition: "all 0.2s"
                                }}
                                onMouseEnter={(e) => {
                                  (e.target as HTMLButtonElement).style.background = "#005EB8";
                                }}
                                onMouseLeave={(e) => {
                                  (e.target as HTMLButtonElement).style.background = "#00338D";
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAuditClick(run);
                                }}>
                                  View Report →
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}