/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * pages/Register.tsx
 * ==================
 * User / Admin registration page.
 * Changes from original:
 *   1. Uses react-hot-toast for all error feedback (no inline error div).
 *   2. Field-length guards via validateLength() before submission.
 *   3. Backend now backed by PostgreSQL — error strings come from FastAPI
 *      as plain human-readable detail strings, shown directly in the toast.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { loginUser, registerUser, registerAdmin } from "../services/api";
import { toast, toastApiError, validateLength } from "../utils/toast";

// ── Field limits (must match Postgres column sizes) ───────────────────────────
const MAX_NAME     = 200;
const MAX_EMAIL    = 320;
const MAX_PASSWORD = 500;   // bcrypt truncates at 72 bytes anyway

const Register = () => {
  const navigate = useNavigate();
  const [name,        setName]        = useState("");
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [loading,     setLoading]     = useState(false);

  // ── Inline length indicator helpers ────────────────────────────────────────
  const nameOver    = name.length    > MAX_NAME;
  const emailOver   = email.length   > MAX_EMAIL;
  const passShort   = password.length > 0 && password.length < 8;
  const passOver    = password.length > MAX_PASSWORD;

  const handleRegister = async () => {
    // ── Client-side guards ──────────────────────────────────────────────────
    if (!validateLength("Name",     name,     MAX_NAME))     return;
    if (!validateLength("Email",    email,    MAX_EMAIL))    return;
    if (!validateLength("Password", password, MAX_PASSWORD)) return;
    if (password.length < 8) {
      toast.fieldError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    const loadId = toast.loading(
      isAdminMode ? "Creating admin account…" : "Creating account…",
    );

    try {
      if (isAdminMode) {
        await registerAdmin({ name, email, password });
        const loginRes = await loginUser({ email, password });
        localStorage.setItem("token", loginRes.data.access_token);
        toast.dismiss(loadId);
        toast.success("Admin account created!");
        navigate("/admin");
      } else {
        await registerUser({ name, email, password });
        const loginRes = await loginUser({ email, password });
        localStorage.setItem("token", loginRes.data.access_token);
        toast.dismiss(loadId);
        toast.success("Account created — let's register your AI.");
        navigate("/register-ai");
      }
    } catch (err: any) {
      toast.dismiss(loadId);
      toastApiError(err, "Registration failed — please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        fontFamily: "'Plus Jakarta Sans','Inter',sans-serif",
        overflow: "hidden",
      }}
    >
      {/* react-hot-toast mount point — one per page tree is fine here */}
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            fontFamily: "'Plus Jakarta Sans','Inter',sans-serif",
            fontSize: 14,
            borderRadius: 0,
            border: "1px solid #E3EAF3",
            boxShadow: "0 4px 16px rgba(0,51,141,0.10)",
          },
          success: { iconTheme: { primary: "#059669", secondary: "#fff" } },
          error:   { iconTheme: { primary: "#DC2626", secondary: "#fff" } },
        }}
      />

      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        .ri{width:100%;padding:14px 16px;border-radius:0;border:1.5px solid #E3EAF3;font-size:14px;font-family:inherit;color:#0B1F33;background:#fff;transition:all 0.2s;outline:none;}
        .ri:focus{border-color:#005EB8;box-shadow:0 0 0 4px rgba(0,94,184,0.1);}
        .ri::placeholder{color:#A0B4CC;}
        .ri.over{border-color:#DC2626!important;}
        .ri.warn{border-color:#D97706!important;}
        .char-hint{font-size:11px;margin-top:3px;text-align:right;}
        .rs{width:100%;padding:15px;border-radius:0;border:none;background:linear-gradient(135deg,#00338D,#005EB8);color:#fff;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;transition:all 0.3s;box-shadow:0 6px 20px rgba(0,51,141,0.25);}
        .rs:hover{transform:translateY(-2px);box-shadow:0 12px 32px rgba(0,51,141,0.35);}
        .rs:disabled{opacity:0.55;cursor:not-allowed;transform:none;}
        .rlp{flex:1;background:linear-gradient(145deg,#00338D 0%,#005EB8 55%,#0091DA 100%);display:flex;flex-direction:column;justify-content:center;padding:64px;position:relative;overflow:hidden;}
        .rlp::before{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.04) 1px,transparent 1px);background-size:52px 52px;pointer-events:none;}
        .rorb{position:absolute;border-radius:50%;filter:blur(80px);pointer-events:none;}
        .rrp{width:500px;flex-shrink:0;display:flex;flex-direction:column;justify-content:center;padding:56px;background:#fff;overflow-y:auto;}
        .rpill{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.9);font-size:11px;font-weight:700;padding:6px 14px;border-radius:0;letter-spacing:1px;text-transform:uppercase;margin-bottom:32px;backdrop-filter:blur(8px);}
        .rpd{width:6px;height:6px;border-radius:50%;background:#00A3A1;animation:rpulse 2s ease-in-out infinite;}
        @keyframes rpulse{0%,100%{transform:scale(1);}50%{transform:scale(1.5);opacity:0.6;}}
        @keyframes regUp{from{opacity:0;transform:translateY(22px);}to{opacity:1;transform:translateY(0);}}
        @media(max-width:768px){.rlp{display:none;}.rrp{width:100%;padding:40px 28px;}}
      `}</style>

      {/* ── LEFT panel ────────────────────────────────────────────────────── */}
      <div className="rlp">
        <div className="rorb" style={{ width: 420, height: 420, background: "rgba(255,255,255,0.05)", top: -100, right: -80 }} />
        <div className="rorb" style={{ width: 300, height: 300, background: "rgba(0,163,161,0.14)", bottom: -80, left: -60 }} />
        <div style={{ position: "relative" }}>
          <div className="rpill"><div className="rpd" />KPMG Trusted AI Framework</div>
          <h1 style={{ fontSize: "clamp(30px,3vw,46px)", fontWeight: 900, color: "#fff", letterSpacing: "-1.5px", lineHeight: 1.1, marginBottom: 14 }}>
            Start auditing<br />your AI today.
          </h1>
          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.6)", lineHeight: 1.75, maxWidth: 360 }}>
            Join organisations using TrustShield AI to achieve trusted, explainable, and well-governed AI.
          </p>
        </div>
      </div>

      {/* ── RIGHT panel ───────────────────────────────────────────────────── */}
      <div className="rrp">
        <div style={{ animation: "regUp 0.7s cubic-bezier(.16,1,.3,1) both" }}>
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#005EB8", letterSpacing: "2.5px", textTransform: "uppercase", marginBottom: 10 }}>
              Get started
            </div>
            <h2 style={{ fontSize: 32, fontWeight: 900, color: "#00338D", letterSpacing: "-1px", marginBottom: 8 }}>
              Create account
            </h2>
            <p style={{ fontSize: 14, color: "#8FA3BF", lineHeight: 1.6 }}>
              Set up your audit workspace in under a minute.
            </p>
          </div>

          {/* ── Fields ──────────────────────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {/* Name */}
            <div>
              <input
                className={`ri${nameOver ? " over" : ""}`}
                placeholder="Full name"
                value={name}
                maxLength={MAX_NAME + 20}   // allow slight overage so hint shows
                onChange={e => setName(e.target.value)}
              />
              {name.length > MAX_NAME * 0.85 && (
                <div className="char-hint" style={{ color: nameOver ? "#DC2626" : "#D97706" }}>
                  {name.length} / {MAX_NAME}
                </div>
              )}
            </div>

            {/* Email */}
            <div style={{ marginTop: 10 }}>
              <input
                className={`ri${emailOver ? " over" : ""}`}
                type="email"
                placeholder="Email address"
                value={email}
                maxLength={MAX_EMAIL + 20}
                onChange={e => setEmail(e.target.value)}
              />
              {email.length > MAX_EMAIL * 0.85 && (
                <div className="char-hint" style={{ color: emailOver ? "#DC2626" : "#D97706" }}>
                  {email.length} / {MAX_EMAIL}
                </div>
              )}
            </div>

            {/* Password */}
            <div style={{ marginTop: 10 }}>
              <input
                className={`ri${passOver ? " over" : passShort ? " warn" : ""}`}
                type="password"
                placeholder="Password (min. 8 characters)"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e =>
                  e.key === "Enter" &&
                  !(!name || !email || !password || loading) &&
                  handleRegister()
                }
              />
              {passShort && (
                <div className="char-hint" style={{ color: "#D97706" }}>
                  {password.length} / 8 minimum
                </div>
              )}
              {passOver && (
                <div className="char-hint" style={{ color: "#DC2626" }}>
                  Too long — {password.length} chars
                </div>
              )}
            </div>
          </div>

          {/* ── Admin toggle ─────────────────────────────────────────────── */}
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={() => setIsAdminMode(!isAdminMode)}
              style={{
                width: 36, height: 20, borderRadius: 0, border: "none",
                cursor: "pointer", padding: 2,
                background: isAdminMode ? "#00338D" : "#E3EAF3",
                transition: "background 0.2s", position: "relative", flexShrink: 0,
              }}
            >
              <div style={{
                width: 16, height: 16, borderRadius: "50%", background: "white",
                boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                transition: "transform 0.2s",
                transform: isAdminMode ? "translateX(16px)" : "translateX(0)",
              }} />
            </button>
            <span style={{ fontSize: 13, color: "#6B7C93", fontWeight: 500 }}>
              Register as Admin
            </span>
          </div>

          {/* ── Submit ───────────────────────────────────────────────────── */}
          <button
            className="rs"
            style={{ marginTop: 24 }}
            onClick={handleRegister}
            disabled={!name || !email || !password || loading || nameOver || emailOver || passOver}
          >
            {loading
              ? "Creating account…"
              : isAdminMode
              ? "Create Admin Account →"
              : "Create Account →"}
          </button>

          <p style={{ fontSize: 12, color: "#A0B4CC", textAlign: "center", marginTop: 14, lineHeight: 1.6 }}>
            By creating an account you agree to our terms of service.
          </p>

          <div style={{ marginTop: 20, textAlign: "center", fontSize: 14, color: "#8FA3BF" }}>
            Already have an account?{" "}
            <span
              style={{ color: "#005EB8", fontWeight: 700, cursor: "pointer" }}
              onClick={() => navigate("/login")}
            >
              Sign in
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;