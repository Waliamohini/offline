#!/usr/bin/env node
/**
 * dev.js — runs the backend (FastAPI/uvicorn) and frontend (Vite) together
 * from a single `npm run dev` at the project root.
 *
 * Uses only Node's built-in child_process — no extra npm packages needed
 * just to launch two dev servers.
 *
 * Backend Python resolution, in order:
 *   1. backend/venv (if you created one — the usual, isolated way)
 *   2. a global `python`/`python3`/`py` on PATH (for locked-down machines
 *      where creating a venv isn't allowed — install deps with
 *      `pip install -r requirements.txt` directly instead)
 * Whichever is found first is used; if neither is, this exits with a
 * clear message instead of a confusing spawn error.
 */
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const isWindows = process.platform === "win32";
const root = __dirname;
const backendDir = path.join(root, "backend");
const frontendDir = path.join(root, "frontend");

const venvPython = isWindows
  ? path.join(backendDir, "venv", "Scripts", "python.exe")
  : path.join(backendDir, "venv", "bin", "python");

// ── Find a usable Python: prefer the venv, fall back to whatever's on PATH.
function findGlobalPython() {
  const candidates = isWindows ? ["python", "py", "python3"] : ["python3", "python"];
  for (const cmd of candidates) {
    const result = spawnSync(cmd, ["--version"], { shell: isWindows });
    if (result.status === 0) return cmd;
  }
  return null;
}

let pythonCmd = null;
let usingVenv = false;
if (fs.existsSync(venvPython)) {
  pythonCmd = venvPython;
  usingVenv = true;
} else {
  pythonCmd = findGlobalPython();
}

function setupHint() {
  console.error("\nOne-time setup needed first — pick ONE of these two:\n");
  console.error("  Option A — virtual environment (if your machine allows it):");
  console.error("    cd backend");
  console.error(isWindows ? "    python -m venv venv" : "    python3 -m venv venv");
  console.error(isWindows ? "    venv\\Scripts\\pip install -r requirements.txt" : "    ./venv/bin/pip install -r requirements.txt");
  console.error("");
  console.error("  Option B — no venv (for locked-down / office machines that block venv):");
  console.error("    cd backend");
  console.error(isWindows ? "    pip install -r requirements.txt" : "    pip3 install -r requirements.txt");
  console.error("    (add --user to that command if it complains about permissions)");
  console.error("");
  console.error("  Then either way:");
  console.error("    cd ../frontend");
  console.error("    npm install");
  console.error("\nThen run `npm run dev` again from the project root.\n");
}

if (!pythonCmd) {
  console.error("✗ No usable Python found — checked for a venv at:");
  console.error(`  ${venvPython}`);
  console.error("  ...and for a global python/python3/py on your PATH, but none responded.");
  setupHint();
  process.exit(1);
}
if (!fs.existsSync(path.join(frontendDir, "node_modules"))) {
  console.error(`✗ Frontend dependencies not installed (no frontend/node_modules).`);
  setupHint();
  process.exit(1);
}

console.log(usingVenv
  ? "Using backend virtual environment."
  : `No venv found — using global Python ("${pythonCmd}"). Make sure you ran ` +
    `"pip install -r requirements.txt" in backend/ without a venv, or this will fail below.`);

// ── Launch both, with colored, prefixed output so it's clear which
// process logged what in one shared terminal. ─────────────────────────────
const COLORS = { backend: "\x1b[34m", frontend: "\x1b[35m", reset: "\x1b[0m" };

function run(name, command, args, cwd) {
  const proc = spawn(command, args, { cwd, shell: isWindows });
  const prefix = `${COLORS[name]}[${name}]${COLORS.reset} `;

  const pipe = (stream, out) => {
    stream.on("data", (data) => {
      data.toString().split(/\r?\n/).filter(Boolean).forEach((line) => out(prefix + line));
    });
  };
  pipe(proc.stdout, console.log);
  pipe(proc.stderr, console.error);

  proc.on("exit", (code) => {
    console.log(`${prefix}exited with code ${code}`);
  });
  return proc;
}

console.log("Starting backend (http://localhost:8000) and frontend (http://localhost:5173)...\n");

const backend = run(
  "backend",
  pythonCmd,
  ["-m", "uvicorn", "app.main:app", "--reload", "--host", "0.0.0.0", "--port", "8000"],
  backendDir
);
const frontend = run("frontend", "npm", ["run", "dev"], frontendDir);

function shutdown() {
  console.log("\nShutting down both servers...");
  backend.kill();
  frontend.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);