import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { loginUser } from "../services/api";


const Login = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError("");
   setLoading(true);
    try {
      const response = await loginUser({ email, password });
      const token = response.data.access_token;
      localStorage.setItem("token", token);
      // Decode role from JWT and redirect accordingly
      try {
        const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));
        if (payload.role === "admin") { navigate("/admin"); return; }
      } catch {}
      navigate("/register-ai");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Login failed.");
    } finally {
      setLoading(false);
    }
  };


  return (
    <div style={{ display:"flex", height:"100vh", fontFamily:"'Plus Jakarta Sans','Inter',sans-serif", overflow:"hidden" }}>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        .ai{width:100%;padding:14px 16px;border-radius: 0px;border:1.5px solid #E3EAF3;font-size:14px;font-family:inherit;color:#0B1F33;background:#fff;transition:all 0.2s;outline:none;}
        .ai:focus{border-color:#005EB8;box-shadow:0 0 0 4px rgba(0,94,184,0.1);}
        .ai::placeholder{color:#A0B4CC;}
        .as{width:100%;padding:15px;border-radius: 0px;border:none;background:linear-gradient(135deg,#00338D,#005EB8);color:#fff;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;transition:all 0.3s;box-shadow:0 6px 20px rgba(0,51,141,0.25);}
        .as:hover{transform:translateY(-2px);box-shadow:0 12px 32px rgba(0,51,141,0.35);}
        .as:disabled{opacity:0.55;cursor:not-allowed;transform:none;}
        .alp{flex:1;background:linear-gradient(145deg,#00338D 0%,#005EB8 55%,#0091DA 100%);display:flex;flex-direction:column;justify-content:center;padding:64px;position:relative;overflow:hidden;}
        .alp::before{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.04) 1px,transparent 1px);background-size:52px 52px;pointer-events:none;}
        .aorb{position:absolute;border-radius: 50%;filter:blur(80px);pointer-events:none;}
        .arp{width:480px;flex-shrink:0;display:flex;flex-direction:column;justify-content:center;padding:64px 56px;background:#fff;overflow-y:auto;}
        .apill{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.9);font-size:11px;font-weight:700;padding:6px 14px;border-radius: 0px;letter-spacing:1px;text-transform:uppercase;margin-bottom:32px;backdrop-filter:blur(8px);}
        .apd{width:6px;height:6px;border-radius: 50%;background:#00A3A1;animation:apulse 2s ease-in-out infinite;}
        @keyframes apulse{0%,100%{transform:scale(1);}50%{transform:scale(1.5);opacity:0.6;}}
        @keyframes authUp{from{opacity:0;transform:translateY(22px);}to{opacity:1;transform:translateY(0);}}
        @media(max-width:768px){.alp{display:none;}.arp{width:100%;padding:40px 28px;}}
      `}</style>

      {/* LEFT */}
      <div className="alp">
        <div className="aorb" style={{ width:420, height:420, background:"rgba(255,255,255,0.05)", top:-100, right:-80 }} />
        <div className="aorb" style={{ width:300, height:300, background:"rgba(0,163,161,0.14)", bottom:-80, left:-60 }} />
        <div style={{ position:"relative" }}>
          <div className="apill"><div className="apd" />KPMG Trusted AI Framework</div>
          <h1 style={{ fontSize:"clamp(30px,3vw,46px)", fontWeight:900, color:"#fff", letterSpacing:"-1.5px", lineHeight:1.1, marginBottom:14 }}>
            Audit your AI.<br />Trust your results.
          </h1>
          <p style={{ fontSize:15, color:"rgba(255,255,255,0.6)", lineHeight:1.75, maxWidth:360 }}>
            Enterprise AI governance scored across 10 KPMG Trusted AI principles.
          </p>
        </div>
      </div>

      {/* RIGHT */}
      <div className="arp">
        <div style={{ animation:"authUp 0.7s cubic-bezier(.16,1,.3,1) both" }}>
          <div style={{ marginBottom:36 }}>
            <div style={{ fontSize:11, fontWeight:800, color:"#005EB8", letterSpacing:"2.5px", textTransform:"uppercase", marginBottom:10 }}>Welcome back</div>
            <h2 style={{ fontSize:32, fontWeight:900, color:"#00338D", letterSpacing:"-1px", marginBottom:8 }}>Sign in</h2>
            <p style={{ fontSize:14, color:"#8FA3BF", lineHeight:1.6 }}>Enter your credentials to access your audit workspace.</p>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <input className="ai" type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} />
            <input className="ai" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !(!email || !password || loading) && handleLogin()} />
          </div>

          {error && (
            <div style={{ marginTop:14, padding:"12px 16px", background:"#FFF5F5", border:"1px solid #FED7D7", borderRadius:0, fontSize:13, color:"#C53030" }}>
              {error}
            </div>
          )}

          <button className="as" style={{ marginTop:24 }} onClick={handleLogin} disabled={!email || !password || loading}>
            {loading ? "Signing in…" : "Sign In →"}
          </button>

          <div style={{ marginTop:28, textAlign:"center", fontSize:14, color:"#8FA3BF" }}>
            Don't have an account?{" "}
            <span style={{ color:"#005EB8", fontWeight:700, cursor:"pointer" }} onClick={() => navigate("/register")}>Create one</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
