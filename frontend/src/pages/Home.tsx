import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

/* ─── hooks ─────────────────────────────────────────────────────────────── */
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const o = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setV(true); o.disconnect(); } },
      { threshold }
    );
    o.observe(el);
    return () => o.disconnect();
  }, [threshold]);
  return { ref, v };
}

function useScrollProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const h = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(docHeight > 0 ? scrollTop / docHeight : 0);
    };
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);
  return progress;
}

function useCountUp(target: number, active: boolean, duration = 1400) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) return;
    let start: number | null = null;
    const step = (ts: number) => {
      if (!start) start = ts;
      const elapsed = ts - start;
      const pct = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - pct, 3);
      setVal(Math.round(ease * target));
      if (pct < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [active, target, duration]);
  return val;
}

function useMouseParallax() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const h = (e: MouseEvent) => setPos({
      x: (e.clientX / window.innerWidth - 0.5) * 2,
      y: (e.clientY / window.innerHeight - 0.5) * 2,
    });
    window.addEventListener("mousemove", h);
    return () => window.removeEventListener("mousemove", h);
  }, []);
  return pos;
}

/* ─── animated primitives ───────────────────────────────────────────────── */
function Reveal({ children, delay = 0, from = "bottom" }: {
  children: React.ReactNode; delay?: number; from?: "bottom" | "left" | "right" | "top";
}) {
  const { ref, v } = useInView(0.12);
  const transforms: Record<string, string> = {
    bottom: "translateY(48px)", top: "translateY(-48px)",
    left: "translateX(-48px)", right: "translateX(48px)",
  };
  return (
    <div ref={ref} style={{
      opacity: v ? 1 : 0,
      transform: v ? "none" : transforms[from],
      transition: `opacity 0.9s cubic-bezier(.16,1,.3,1) ${delay}s, transform 0.9s cubic-bezier(.16,1,.3,1) ${delay}s`,
    }}>{children}</div>
  );
}

function ScaleReveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const { ref, v } = useInView(0.1);
  return (
    <div ref={ref} style={{
      opacity: v ? 1 : 0,
      transform: v ? "scale(1) translateY(0)" : "scale(0.9) translateY(24px)",
      transition: `opacity 0.85s cubic-bezier(.16,1,.3,1) ${delay}s, transform 0.85s cubic-bezier(.16,1,.3,1) ${delay}s`,
    }}>{children}</div>
  );
}

// Not currently used anywhere in this file, unlike its siblings Reveal/
// ScaleReveal above — exported rather than deleted since it's a real,
// working animation variant that may just not have been applied yet.
export function BlurReveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const { ref, v } = useInView(0.1);
  return (
    <div ref={ref} style={{
      opacity: v ? 1 : 0,
      filter: v ? "blur(0px)" : "blur(6px)",
      transform: v ? "translateY(0)" : "translateY(20px)",
      transition: `opacity 0.8s cubic-bezier(.16,1,.3,1) ${delay}s, filter 0.8s cubic-bezier(.16,1,.3,1) ${delay}s, transform 0.8s cubic-bezier(.16,1,.3,1) ${delay}s`,
    }}>{children}</div>
  );
}

function StaggerReveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const { ref, v } = useInView(0.08);
  return (
    <div ref={ref} style={{
      opacity: v ? 1 : 0,
      transform: v ? "none" : "translateY(36px)",
      transition: `opacity 0.75s ease ${delay}s, transform 0.75s cubic-bezier(.16,1,.3,1) ${delay}s`,
    }}>{children}</div>
  );
}

function CountStat({ value, suffix = "", label }: { value: number; suffix?: string; label: string }) {
  const { ref, v } = useInView(0.2);
  const count = useCountUp(value, v);
  return (
    <div ref={ref} className="stat-item">
      <div className="stat-number">{count}{suffix}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

const Home = () => {
  const navigate = useNavigate();
  const mouse = useMouseParallax();
  const progress = useScrollProgress();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }, []);

  return (
    <div style={{ minHeight: "100vh", fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", background: "#F4F7FB", color: "#0B1F33" }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }

        /* PROGRESS BAR */
        .hm-progress {
          position: fixed; top: 0; left: 0; height: 3px; z-index: 500;
          background: linear-gradient(90deg, #00338D, #0091DA, #00A3A1);
          border-radius: 0 2px 0;
          transition: width 0.1s linear;
        }

        /* NAVBAR */
        .home-navbar {
          background: ${scrolled ? "rgba(255,255,255,0.96)" : "transparent"};
          backdrop-filter: ${scrolled ? "blur(24px)" : "none"};
          border-bottom: ${scrolled ? "1px solid rgba(0,51,141,0.07)" : "1px solid transparent"};
          box-shadow: ${scrolled ? "0 4px 40px rgba(0,51,141,0.06)" : "none"};
          padding: 0 48px;
          height: 72px;
          position: fixed;
          top: 0; left: 0; right: 0;
          z-index: 300;
          transition: background 0.4s, backdrop-filter 0.4s, border-color 0.4s, box-shadow 0.4s;
        }

        .home-nav-inner {
          max-width: 1400px;
          margin: 0 auto;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .home-nav-logo img { height: 72px; }

        .home-nav-links {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .nav-link {
          padding: 9px 16px;
          border-radius: 0px;
          font-size: 13px;
          font-weight: 600;
          color: #6B7C93;
          cursor: pointer;
          border: none;
          background: transparent;
          transition: all 0.2s;
          font-family: 'Plus Jakarta Sans', sans-serif;
        }
        .nav-link:hover { background: rgba(0,51,141,0.06); color: #005EB8; }

        .nav-ghost {
          padding: 9px 20px;
          border-radius: 0px;
          font-size: 13px;
          font-weight: 700;
          color: #00338D;
          cursor: pointer;
          border: 1.5px solid #C7D9F5;
          background: transparent;
          transition: all 0.2s;
          font-family: 'Plus Jakarta Sans', sans-serif;
        }
        .nav-ghost:hover { background: #EEF4FF; border-color: #005EB8; }

        .nav-cta {
          padding: 10px 22px;
          border-radius: 0px;
          font-size: 13px;
          font-weight: 700;
          color: white;
          cursor: pointer;
          border: none;
          background: linear-gradient(135deg, #00338D, #005EB8);
          transition: all 0.3s;
          font-family: 'Plus Jakarta Sans', sans-serif;
          box-shadow: 0 4px 14px rgba(0,51,141,0.25);
        }
        .nav-cta:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(0,51,141,0.3); }

        /* HERO */
        .home-hero {
          min-height: 100vh;
          padding: 100px 60px 60px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 80px;
          max-width: 1280px;
          margin: 0 auto;
          position: relative;
        }

        .home-hero-left { max-width: 560px; }

        .hero-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          background: linear-gradient(135deg, #EEF4FF, #E6F7F7);
          border: 1px solid rgba(0,94,184,0.18);
          color: #00338D;
          font-size: 11.5px;
          font-weight: 700;
          padding: 7px 16px;
          border-radius: 0px;
          margin-bottom: 28px;
          letter-spacing: 1px;
          text-transform: uppercase;
          animation: heroUp 0.8s cubic-bezier(.16,1,.3,1) 0.1s both;
        }

        .hero-pill-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: linear-gradient(135deg, #005EB8, #00A3A1);
          animation: pillPulse 2.2s ease-in-out infinite;
        }
        @keyframes pillPulse { 0%,100%{transform:scale(1);opacity:1;} 50%{transform:scale(1.5);opacity:0.5;} }

        .hero-title {
          font-size: clamp(38px, 5.5vw, 72px);
          font-weight: 900;
          line-height: 1.05;
          letter-spacing: -2.5px;
          color: #00338D;
          margin-bottom: 24px;
          animation: heroUp 0.9s cubic-bezier(.16,1,.3,1) 0.18s both;
        }

        .hero-title-accent {
          background: linear-gradient(135deg, #005EB8, #0091DA, #00A3A1);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .hero-desc {
          font-size: clamp(15px, 1.6vw, 18px);
          color: #4A6080;
          line-height: 1.8;
          margin-bottom: 40px;
          max-width: 480px;
          animation: heroUp 0.9s cubic-bezier(.16,1,.3,1) 0.26s both;
        }

        .hero-btns {
          display: flex; gap: 14px; flex-wrap: wrap;
          animation: heroUp 0.9s cubic-bezier(.16,1,.3,1) 0.34s both;
        }

        @keyframes heroUp { from{opacity:0;transform:translateY(28px);}to{opacity:1;transform:translateY(0);} }

        .btn-primary {
          padding: 15px 34px;
          border-radius: 0px;
          border: none;
          background: linear-gradient(135deg, #00338D, #005EB8);
          color: white;
          font-weight: 700;
          font-size: 15px;
          cursor: pointer;
          font-family: 'Plus Jakarta Sans', sans-serif;
          transition: all 0.3s;
          box-shadow: 0 8px 24px rgba(0,51,141,0.28);
        }
        .btn-primary:hover { transform: translateY(-3px); box-shadow: 0 16px 40px rgba(0,51,141,0.35); }

        .btn-secondary {
          padding: 15px 34px;
          border-radius: 0px;
          border: 2px solid #C7D9F5;
          background: rgba(255,255,255,0.85);
          backdrop-filter: blur(8px);
          color: #00338D;
          font-weight: 700;
          font-size: 15px;
          cursor: pointer;
          font-family: 'Plus Jakarta Sans', sans-serif;
          transition: all 0.3s;
        }
        .btn-secondary:hover { border-color: #005EB8; background: #EEF4FF; transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0,51,141,0.1); }

        /* TRUST BADGES */
        .trust-row {
          display: flex;
          align-items: center;
          gap: 20px;
          margin-top: 32px;
          flex-wrap: wrap;
          animation: heroUp 0.9s cubic-bezier(.16,1,.3,1) 0.42s both;
        }
        .trust-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #8FA3BF;
          font-weight: 600;
        }
        .trust-badge span:first-child { font-size: 14px; }

        /* RIGHT SIDE — visual panel */
        .hero-right {
          flex-shrink: 0;
          width: 520px;
          animation: heroRight 1s cubic-bezier(.16,1,.3,1) 0.5s both;
        }
        @keyframes heroRight { from{opacity:0;transform:translateX(48px);}to{opacity:1;transform:translateX(0);} }

        .score-panel {
          background: white;
          border-radius: 0px;
          border: 1px solid #E3EAF3;
          box-shadow: 0 24px 80px rgba(0,51,141,0.12);
          overflow: hidden;
        }

        .score-panel-header {
          background: linear-gradient(135deg, #00338D, #005EB8);
          padding: 24px 28px;
          color: white;
          position: relative;
          overflow: hidden;
        }
        .score-panel-header::before {
          content: '';
          position: absolute; inset: 0;
          background-image: linear-gradient(rgba(255,255,255,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.04) 1px,transparent 1px);
          background-size: 24px 24px;
          pointer-events: none;
        }

        .score-panel-header h3 {
          font-size: 11px;
          font-weight: 700;
          opacity: 0.65;
          margin-bottom: 6px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          position: relative;
        }

        .score-panel-header .ai-name {
          font-size: 18px;
          font-weight: 800;
          position: relative;
          letter-spacing: -0.3px;
        }

        .score-panel-body { padding: 24px 28px; }

        .principle-bars { display: flex; flex-direction: column; gap: 10px; }

        .principle-bar-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .principle-bar-label {
          font-size: 12px;
          color: #6B7C93;
          width: 110px;
          flex-shrink: 0;
          font-weight: 500;
        }

        .principle-bar-track {
          flex: 1;
          height: 6px;
          background: #F1F5F9;
          border-radius: 0px;
          overflow: hidden;
        }

        .principle-bar-fill {
          height: 100%;
          border-radius: 0px;
          background: linear-gradient(90deg, #00338D, #0091DA);
          transform-origin: left;
          animation: barGrow 1.2s cubic-bezier(.16,1,.3,1) both;
        }
        @keyframes barGrow { from{transform:scaleX(0);}to{transform:scaleX(1);} }

        .principle-bar-val {
          font-size: 12px;
          font-weight: 700;
          color: #00338D;
          width: 28px;
          text-align: right;
          flex-shrink: 0;
        }

        /* FEATURES SECTION */
        .features-section {
          padding: 100px 60px;
          max-width: 1280px;
          margin: 0 auto;
        }

        .section-label {
          font-size: 11px;
          font-weight: 800;
          color: #005EB8;
          text-transform: uppercase;
          letter-spacing: 3px;
          margin-bottom: 14px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .section-label::before {
          content: '';
          width: 28px; height: 2px;
          background: linear-gradient(to right, #005EB8, #0091DA);
          border-radius: 0px;
          flex-shrink: 0;
        }

        .section-title {
          font-size: clamp(28px, 4vw, 48px);
          font-weight: 900;
          color: #00338D;
          letter-spacing: -1.5px;
          line-height: 1.1;
          margin-bottom: 16px;
        }
        .section-title em {
          font-style: normal;
          background: linear-gradient(135deg, #005EB8, #0091DA);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .section-desc {
          font-size: 17px;
          color: #5A7090;
          line-height: 1.78;
          max-width: 560px;
          margin-bottom: 60px;
        }

        .features-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
        }

        .feature-card {
          background: white;
          border-radius: 0px;
          padding: 34px 28px;
          border: 1.5px solid #E3EAF3;
          transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
          cursor: default;
          position: relative;
          overflow: hidden;
        }

        .feature-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 3px;
          background: linear-gradient(90deg, #00338D, #0091DA);
          opacity: 0;
          transition: opacity 0.3s;
          border-radius: 0 0 0;
        }

        .feature-card:hover {
          border-color: #C7D9F5;
          transform: translateY(-7px);
          box-shadow: 0 24px 56px rgba(0,51,141,0.1);
        }

        .feature-card:hover::before { opacity: 1; }

        .feature-icon {
          width: 48px;
          height: 48px;
          border-radius: 0px;
          background: #E6F2FB;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          margin-bottom: 18px;
          border: 1px solid rgba(0,94,184,0.15);
        }

        .feature-card h3 {
          font-size: 16px;
          font-weight: 800;
          color: #00338D;
          margin-bottom: 10px;
          letter-spacing: -0.2px;
        }

        .feature-card p {
          font-size: 13.5px;
          color: #6B7C93;
          line-height: 1.7;
        }

        /* STATS STRIP */
        .stats-strip {
          background: linear-gradient(135deg, #00338D, #005EB8 55%, #0091DA 100%);
          padding: 72px 60px;
          position: relative;
          overflow: hidden;
        }
        .stats-strip::before {
          content: '';
          position: absolute; inset: 0;
          background-image: linear-gradient(rgba(255,255,255,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.04) 1px,transparent 1px);
          background-size: 52px 52px;
          pointer-events: none;
        }

        .stats-inner {
          max-width: 900px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 40px;
          position: relative;
        }

        .stat-item { text-align: center; }

        .stat-number {
          font-size: clamp(32px, 4vw, 52px);
          font-weight: 900;
          color: white;
          letter-spacing: -2px;
          line-height: 1;
          margin-bottom: 10px;
        }

        .stat-label {
          font-size: 13px;
          color: rgba(255,255,255,0.6);
          font-weight: 600;
          letter-spacing: 0.3px;
        }

        /* FRAMEWORKS */
        .frameworks-section {
          padding: 80px 60px;
          background: linear-gradient(160deg, #F7FAFF 0%, #EEF4FF 55%, #F0FAFA 100%);
        }
        .frameworks-inner {
          max-width: 1280px;
          margin: 0 auto;
        }

        .frameworks-row {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-top: 48px;
        }

        .framework-card {
          padding: 32px 24px;
          background: white;
          border: 1.5px solid #E8EEF6;
          border-radius: 0px;
          font-size: 14px;
          font-weight: 600;
          color: #0B1F33;
          transition: all 0.35s cubic-bezier(.16,1,.3,1);
          position: relative;
          overflow: hidden;
        }
        .framework-card::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 3px;
          background: var(--fc);
          border-radius: 0 10px 10px;
        }
        .framework-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 24px 56px rgba(0,51,141,0.1);
          border-color: var(--fc);
        }
        .framework-card-name {
          font-size: 20px;
          font-weight: 900;
          color: #00338D;
          margin-bottom: 10px;
          letter-spacing: -0.5px;
        }
        .framework-card-desc {
          font-size: 13.5px;
          color: #6B7C93;
          line-height: 1.65;
        }

        /* FOOTER */
        .home-footer {
          background: #F7FAFF;
          border-top: 1px solid #E8EEF6;
          padding: 40px 60px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .home-footer-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .home-footer-left img { height: 30px; opacity: 0.6; }
        .home-footer-copy { font-size: 13px; color: #8FA3BF; }
        .home-footer-right { font-size: 13px; color: #8FA3BF; }

        /* RESPONSIVE */
        @media (max-width: 1100px) {
          .home-hero { flex-direction: column; gap: 60px; padding: 100px 40px 60px; }
          .hero-right { width: 100%; max-width: 520px; }
          .features-grid { grid-template-columns: repeat(2, 1fr); }
          .stats-inner { grid-template-columns: repeat(2, 1fr); gap: 32px; }
          .frameworks-row { grid-template-columns: repeat(2, 1fr); }
        }

        @media (max-width: 640px) {
          .home-navbar { padding: 0 20px; }
          .home-hero { padding: 90px 20px 50px; gap: 40px; }
          .hero-title { font-size: 2.4rem; letter-spacing: -1.5px; }
          .features-section { padding: 60px 20px; }
          .features-grid { grid-template-columns: 1fr; }
          .stats-strip { padding: 48px 20px; }
          .stats-inner { grid-template-columns: repeat(2, 1fr); gap: 24px; }
          .frameworks-section { padding: 60px 20px; }
          .frameworks-row { grid-template-columns: 1fr; }
          .home-footer { flex-direction: column; gap: 14px; text-align: center; padding: 28px 20px; }
        }

        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>

      {/* SCROLL PROGRESS BAR */}
      <div className="hm-progress" style={{ width: `${progress * 100}%` }} />

      {/* NAVBAR */}
      <nav className="home-navbar">
        <div className="home-nav-inner">
          <div className="home-nav-logo">
            <img src="/kpmg-logo.png" alt="KPMG" />
          </div>
          <div className="home-nav-links">
            <button className="nav-link" onClick={() => scrollTo("features")}>Features</button>
            <button className="nav-link" onClick={() => scrollTo("frameworks")}>Compliance</button>
            <button className="nav-ghost" onClick={() => navigate("/login")}>Sign In</button>
            <button className="nav-cta" onClick={() => navigate("/register")}>Get Started →</button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="home-hero">
        {/* Parallax orbs */}
        <div style={{ position:"absolute", width:640, height:640, borderRadius:"50%", background:"radial-gradient(circle,rgba(0,94,184,0.07),transparent)", top:-80, right:-100, transform:`translate(${mouse.x*-18}px,${mouse.y*-18}px)`, transition:"transform 0.14s linear", pointerEvents:"none", filter:"blur(60px)", zIndex:0 }} />
        <div style={{ position:"absolute", width:400, height:400, borderRadius:"50%", background:"radial-gradient(circle,rgba(0,163,161,0.07),transparent)", bottom:20, left:-60, transform:`translate(${mouse.x*14}px,${mouse.y*14}px)`, transition:"transform 0.14s linear", pointerEvents:"none", filter:"blur(50px)", zIndex:0 }} />

        <div className="home-hero-left" style={{ position:"relative", zIndex:1 }}>
          <div className="hero-eyebrow">
            <div className="hero-pill-dot" />
            KPMG Trusted AI Framework
          </div>
          <h1 className="hero-title">
            AI Governance<br />
            <span className="hero-title-accent">Built for Enterprise.</span>
          </h1>
          <p className="hero-desc">
            Audit, score, and certify your AI systems against EU AI Act, ISO 42001, and NIST AI RMF — with real-time risk intelligence and regulatory-grade reporting.
          </p>
          <div className="hero-btns">
            <button className="btn-primary" onClick={() => navigate("/login")}>Start Audit →</button>
            <button className="btn-secondary" onClick={() => navigate("/register")}>Create Account</button>
          </div>
          <div className="trust-row">
            <div className="trust-badge"><span>🇪🇺</span><span>EU AI Act Ready</span></div>
            <div className="trust-badge"><span>📋</span><span>ISO 42001 Aligned</span></div>
            <div className="trust-badge"><span>🏛️</span><span>NIST AI RMF</span></div>
          </div>
        </div>

        <div className="hero-right">
          <div className="score-panel">
            <div className="score-panel-header">
              <h3>Why TrustShield AI?</h3>
              <div className="ai-name">Enterprise-grade governance, built for scale.</div>
            </div>
            <div className="score-panel-body">
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {[
                  { icon: "🎯", title: "Detect governance gaps before regulators do", desc: "Proactive auditing across 10 KPMG Trusted AI Principles." },
                  { icon: "🌍", title: "EU AI Act & ISO 42001 ready", desc: "Automated compliance mapping against global standards." },
                  { icon: "🔒", title: "Black-box auditing", desc: "Audit any AI — with or without access to the model." },
                  { icon: "📄", title: "Regulatory-grade PDF reports", desc: "Client-ready documentation for auditors and boards." },
                  { icon: "✅", title: "Powered by KPMG Trusted AI Framework", desc: "Built on the same framework used by enterprise clients globally." },
                ].map((item, i) => (
                  <div key={item.title} style={{ display: "flex", gap: 14, alignItems: "flex-start",
                    opacity: 1, animation: `heroUp 0.7s cubic-bezier(.16,1,.3,1) ${0.6 + i * 0.1}s both` }}>
                    <div style={{ width: 36, height: 36, borderRadius: 0, background: "#EEF4FF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0, border: "1px solid rgba(0,51,141,0.1)" }}>{item.icon}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#0B1F33", marginBottom: 2 }}>{item.title}</div>
                      <div style={{ fontSize: 12, color: "#6B7C93", lineHeight: 1.5 }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* STATS — count-up on scroll */}
      <div className="stats-strip" id="stats">
        <div className="stats-inner">
          <CountStat value={10}  suffix=""  label="Governance Principles" />
          <CountStat value={4}   suffix=""  label="Regulatory Frameworks" />
          <CountStat value={50}  suffix="+" label="Sub-parameters Scored" />
          <CountStat value={2}   suffix=""  label="Audit Modes" />
        </div>
      </div>

      {/* FEATURES */}
      <section className="features-section" id="features">
        <Reveal>
          <div className="section-label">Platform Capabilities</div>
          <h2 className="section-title">Everything you need to <em>govern AI</em></h2>
          <p className="section-desc">From automated log ingestion to regulatory-grade PDF reports — one platform for your entire AI governance programme.</p>
        </Reveal>
        <div className="features-grid">
          {[
            { icon: "📋", title: "AI Register",           desc: "Centralise all your AI models with metadata, risk classification, and ownership tracking in one place." },
            { icon: "⚡", title: "Smart Ingestion",       desc: "Upload audit logs or use SDCC for automatic data classification and schema detection." },
            { icon: "🔍", title: "Blackbox Testing",      desc: "Generate synthetic probes and run adversarial evaluations when real data is unavailable." },
            { icon: "📊", title: "Full Governance Audit", desc: "Score across 10 Trusted AI principles with 50+ sub-parameters and detailed calculation transparency." },
            { icon: "📄", title: "Regulatory Reports",    desc: "Generate professional PDF reports aligned with EU AI Act, ISO 42001, and NIST AI RMF standards." },
            { icon: "🔔", title: "Continuous Monitoring", desc: "Track governance scores over time, detect drift, and receive alerts on compliance degradation." },
          ].map((f, i) => (
            <StaggerReveal key={f.title} delay={i * 0.08}>
              <div className="feature-card">
                <div className="feature-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            </StaggerReveal>
          ))}
        </div>
      </section>

      {/* FRAMEWORKS */}
      <section className="frameworks-section" id="frameworks">
        <div className="frameworks-inner">
          <Reveal>
            <div className="section-label">Regulatory Coverage</div>
            <h2 className="section-title">Aligned with <em>global AI standards</em></h2>
            <p className="section-desc" style={{ marginBottom: 0 }}>Your audit report automatically maps your TAF scores to the four leading AI governance frameworks.</p>
          </Reveal>
          <div className="frameworks-row">
            {[
              { name: "EU AI Act",    color: "#005EB8", desc: "The EU's binding regulation for high-risk AI systems — your TAF scores map directly to its technical requirements." },
              { name: "ISO 42001",    color: "#00A3A1", desc: "The international standard for AI management systems — your report shows readiness against ISO 42001 controls." },
              { name: "NIST AI RMF", color: "#0091DA", desc: "The US AI Risk Management Framework — aligned to its Govern, Map, Measure, and Manage functions." },
              { name: "KPMG TAF",    color: "#00338D", desc: "KPMG's Trusted AI Framework — 10 principles, one score, the backbone of every TrustShield AI report." },
            ].map((f, i) => (
              <ScaleReveal key={f.name} delay={i * 0.09}>
                <div className="framework-card" style={{ "--fc": f.color } as React.CSSProperties}>
                  <div className="framework-card-name">{f.name}</div>
                  <div className="framework-card-desc">{f.desc}</div>
                </div>
              </ScaleReveal>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="home-footer">
        <div className="home-footer-left">
          <img src="/kpmg-logo.png" alt="KPMG" />
          <span className="home-footer-copy">© 2026 TrustShield AI. All rights reserved.</span>
        </div>
        <div className="home-footer-right">
          Powered by KPMG Trusted AI Framework · Built for enterprise governance
        </div>
      </footer>
    </div>
  );
};

export default Home;