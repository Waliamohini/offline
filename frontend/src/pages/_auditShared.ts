// Shared design tokens for all audit workspace pages

export const AU = {
  blue900: "#00338D",
  blue700: "#005EB8",
  blue500: "#0091DA",
  blue100: "#EEF4FF",
  blue50:  "#F0F7FF",

  gray950: "#0A0F1E",
  gray900: "#0F172A",
  gray700: "#334155",
  gray500: "#64748B",
  gray300: "#CBD5E1",
  gray200: "#E2E8F0",
  gray100: "#F1F5F9",
  gray50:  "#F8FAFC",

  green:   "#059669",
  greenBg: "#DCFCE7",
  amber:   "#D97706",
  amberBg: "#FFF7ED",
  red:     "#DC2626",
  redBg:   "#FEE2E2",

  radius:  16,
  shadow:  "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.05)",
  shadowMd:"0 4px 20px rgba(0,0,0,0.08)",
};

export function scoreColor(s: number) {
  return s >= 75 ? AU.green : s >= 50 ? AU.blue700 : AU.red;
}
export function scoreBg(s: number) {
  return s >= 75 ? AU.greenBg : s >= 50 ? AU.blue100 : AU.redBg;
}
export function scoreBand(s: number) {
  return s >= 75 ? "Strong" : s >= 50 ? "Watch" : "Critical";
}

export const PAGE_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #F8FAFC; }
  .au-card {
    background: white;
    border-radius: 16px;
    border: 1px solid #E2E8F0;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05), 0 4px 12px rgba(0,0,0,0.04);
    transition: box-shadow 0.2s;
  }
  .au-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
  .au-section-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: #94A3B8;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .au-section-label::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #E2E8F0;
  }
  .au-kpi {
    background: white;
    border-radius: 14px;
    border: 1px solid #E2E8F0;
    padding: 20px 18px;
    transition: all 0.2s;
  }
  .au-kpi:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(0,51,141,0.08);
    border-color: #C7D9F5;
  }
  .param-row { transition: all 0.18s ease; }
  .param-row:hover { background: rgba(0,94,184,0.05) !important; border-color: rgba(0,94,184,0.25) !important; }
  @keyframes auFade { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  .au-fade { animation: auFade 0.4s cubic-bezier(.22,1,.36,1) both; }
  .au-fade-1 { animation: auFade 0.4s 0.06s cubic-bezier(.22,1,.36,1) both; }
  .au-fade-2 { animation: auFade 0.4s 0.12s cubic-bezier(.22,1,.36,1) both; }
  .au-fade-3 { animation: auFade 0.4s 0.18s cubic-bezier(.22,1,.36,1) both; }
`;

export const HEADER_STYLE = {
  background: "linear-gradient(135deg, #00338D 0%, #005EB8 100%)",
  padding: "28px 40px 26px",
  position: "relative" as const,
  overflow: "hidden" as const,
};

export const GRID_OVERLAY = {
  position: "absolute" as const,
  inset: 0,
  backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.04) 1px,transparent 1px)",
  backgroundSize: "32px 32px",
  pointerEvents: "none" as const,
};

/* Helper used by all lens pages to load report data */
export function loadReportData(locationState: any): any {
  const fromState = locationState?.data;
  if (fromState) return fromState;
  try {
    const s = sessionStorage.getItem("lastReportData");
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
