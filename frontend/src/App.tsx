import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import Home                from "./pages/Home";
import Glossary            from "./pages/Glossary";
import Login               from "./pages/Login";
import Register            from "./pages/Register";
import Dashboard           from "./pages/Dashboard";
import Report              from "./pages/Report";
import RegisterAI          from "./pages/RegisterAi";
import Profile             from "./pages/Profile";
import AdminPanel          from "./pages/AdminPanel";
import MainLayout          from "./layout/MainLayout";
import ExecutiveSummary    from "./pages/ExecutiveSummary";
import RegulatoryAlignment from "./pages/RegulatoryAlignment";
import RiskIntelligence    from "./pages/RiskIntelligence";
import LlmAnalysis         from "./pages/LlmAnalysis";
import GovernancePrinciples from "./pages/GovernancePrinciples";
import AgentBehaviour      from "./pages/AgentBehaviour";
import Recommendations     from "./pages/Recommendations";
import DownloadReport      from "./pages/DownloadReport";
import TafTaxonomy        from "./pages/TafTaxonomy";
import CodeBuildRisk       from "./pages/CodeBuildRisk";

import ProtectedRoute from "./components/ProtectedRoute";
import AdminRoute     from "./components/AdminRoute";

function App() {
  return (
    <BrowserRouter>
      {/*
        Global toast mount point.
        - One <Toaster /> here handles all pages.
        - Individual pages should NOT add their own <Toaster />.
        - Import toast helpers from src/utils/toast.ts everywhere.
      */}
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 14,
            borderRadius: 0,
            border: "1px solid #E3EAF3",
            boxShadow: "0 4px 16px rgba(0,51,141,0.10)",
            maxWidth: 420,
          },
          success: {
            duration: 3500,
            iconTheme: { primary: "#059669", secondary: "#fff" },
          },
          error: {
            duration: 5000,
            iconTheme: { primary: "#DC2626", secondary: "#fff" },
          },
          loading: {
            duration: Infinity,
          },
        }}
      />

      <Routes>
        {/* PUBLIC — no sidebar */}
        <Route path="/"         element={<Glossary />} />
        <Route path="/home"     element={<Home />} />
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* PROTECTED — sidebar layout */}
        <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
          <Route path="/dashboard"             element={<Dashboard />} />
          <Route path="/register-ai"           element={<RegisterAI />} />
          <Route path="/report"                element={<Report />} />
          <Route path="/profile"               element={<Profile />} />
          {/* Order below matches the audit flow in Sidebar.tsx / AuditContextBar.tsx:
              Executive Summary → Data Quality → LLM Analysis → Governance Principles →
              Risk Taxonomy → Regulatory Alignment → Build Vulnerabilities →
              Risk Profile → Recommendations → Export */}
          <Route path="/audit-overview"        element={<ExecutiveSummary />} />
          <Route path="/agent-behaviour"       element={<AgentBehaviour />} />
          <Route path="/llm-analysis"          element={<LlmAnalysis />} />
          <Route path="/governance-principles" element={<GovernancePrinciples />} />
          <Route path="/taf-taxonomy"          element={<TafTaxonomy />} />
          <Route path="/regulatory-alignment"  element={<RegulatoryAlignment />} />
          <Route path="/code-build-risk"       element={<CodeBuildRisk />} />
          <Route path="/risk-intelligence"     element={<RiskIntelligence />} />
          <Route path="/recommendations"       element={<Recommendations />} />
          <Route path="/download-report"       element={<DownloadReport />} />
        </Route>

        {/* ADMIN ONLY */}
        <Route element={<AdminRoute><MainLayout /></AdminRoute>}>
          <Route path="/admin" element={<AdminPanel />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;