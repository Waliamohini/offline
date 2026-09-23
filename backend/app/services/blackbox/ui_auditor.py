import asyncio
import concurrent.futures
import json
import time
import uuid
from datetime import datetime
from typing import Optional

from fastapi import HTTPException

from app.services.blackbox.orchestrator import (
    _analyse_response,
    _compute_scores,
)
# PROBE_PROMPTS no longer lives in orchestrator — it was removed when we
# introduced dynamic generation.  For UI mode we still need a synchronous
# list of probes (Playwright runs in a thread, not an async context), so we
# call the async generator from the async entry-point and pass the resolved
# list down into the sync pipeline via a plain argument.
from datetime import timezone
from app.services.blackbox.probe_generator import (
    FALLBACK_PROBE_PROMPTS,
    generate_dynamic_probes,
)
from app.services.blackbox.probe_logger import save_probe_csv

# ── Timeouts ──────────────────────────────────────────────────────────────
PAGE_LOAD_TIMEOUT_MS   = 60_000
WAKEUP_POLL_TIMEOUT_S  = 120
RESPONSE_STABLE_WINDOW = 1.5
RESPONSE_MAX_WAIT_S    = 45
INTER_PROBE_PAUSE_S    = 0.5

WAKEUP_TEXTS = [
    "Yes, get this app back up!",
    "Get this app back up",
    "Wake up", "Rerun", "Restart",
]

AUTH_SIGNALS = [
    "sign in", "log in", "login", "sign up", "create account",
    "enter your password", "forgot password", "continue with google",
    "continue with microsoft",
]

# ── Input selectors ───────────────────────────────────────────────────────
INPUT_SELECTORS = [
    "[data-testid='stChatInputTextArea']",
    "[data-testid='stChatInput'] textarea",
    ".stChatInput textarea",
    "[data-testid='textbox'] textarea",
    ".gradio-container textarea",
    "gradio-app textarea",
    "div#prompt-textarea[contenteditable='true']",
    "#prompt-textarea",
    "textarea#prompt-textarea",
    "div[contenteditable='true'].ProseMirror",
    "[data-testid='composer-input']",
    "rich-textarea div[contenteditable='true']",
    "div.ql-editor[contenteditable='true']",
    "textarea[placeholder*='Send a message']",
    "textarea[placeholder*='Type a message']",
    "textarea[placeholder*='Ask']",
    "div[contenteditable='true'][role='textbox']",
    "[role='textbox']",
    "textarea",
    "input[type='text']",
    "[contenteditable='true']",
    "[placeholder*='message' i]",
    "[placeholder*='chat' i]",
    "[placeholder*='ask' i]",
    "[placeholder*='type' i]",
    "[aria-label*='message' i]",
    "[aria-label*='chat' i]",
    "[class*='chat-input' i]",
    "[class*='message-input' i]",
    "[id*='chat-input' i]",
]

# ── Response selectors ────────────────────────────────────────────────────
RESPONSE_SELECTORS = [
    "[data-testid='stChatMessage']",
    ".stChatMessage",
    ".gradio-chatbot .message.bot",
    ".gradio-chatbot [data-testid='bot']",
    ".message.bot",
    "[data-message-author-role='assistant']",
    ".agent-turn",
    "[data-is-streaming='false'] .prose",
    ".font-claude-message",
    "model-response",
    ".model-response-text",
    "[data-automation-id='chat-message-content']",
    ".assistant-message",
    ".ac-textBlock",
    "cib-message-group cib-message",
    ".prose",
    "[data-testid*='assistant' i]",
    "[data-testid*='response' i]",
    "[data-testid*='message' i]",
    "[class*='assistant-message' i]",
    "[class*='bot-message' i]",
    "[class*='ai-message' i]",
    "[class*='response' i]",
    "[role='article']",
    "[role='log'] > div:last-child",
    "main [class*='message']:last-child",
]

# ── Submit selectors ──────────────────────────────────────────────────────
SUBMIT_SELECTORS = [
    "[data-testid='stChatInputSubmitButton']",
    "button[data-testid='send-button']",
    "button[aria-label='Send prompt']",
    "button[aria-label='Send Message']",
    "button[aria-label='Send message']",
    "button.send-button",
    "[data-automation-id='send-button']",
    "button#search-button",
    "button[type='submit']",
    "button[aria-label*='send' i]",
    "button[aria-label*='submit' i]",
    "[data-testid*='send' i]",
    "[class*='send-button' i]",
    "[class*='send-btn' i]",
]


# ═══════════════════════════════════════════════════════════════════════════
#  COOKIE PARSER
# ═══════════════════════════════════════════════════════════════════════════

def _parse_cookies(raw) -> list:
    if not raw:
        return []
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return []
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"cookies must be a valid JSON array. Error: {exc}")
    if not isinstance(raw, list):
        raise ValueError("cookies must be a JSON array.")

    normalised = []
    for c in raw:
        if not isinstance(c, dict):
            continue
        name  = str(c.get("name",  "")).strip()
        value = str(c.get("value", "")).strip()
        if not name:
            continue
        domain = str(c.get("domain", "")).strip()
        if domain and not domain.startswith(".") and not domain.startswith("http"):
            domain = "." + domain
        cookie = {
            "name":   name,
            "value":  value,
            "domain": domain or "localhost",
            "path":   str(c.get("path", "/")) or "/",
        }
        if c.get("secure") is not None:
            cookie["secure"] = bool(c["secure"])
        if c.get("httpOnly") is not None:
            cookie["httpOnly"] = bool(c["httpOnly"])
        if c.get("sameSite") in ("Strict", "Lax", "None"):
            cookie["sameSite"] = c["sameSite"]
        exp = c.get("expirationDate") or c.get("expiry") or c.get("expires")
        if exp and isinstance(exp, (int, float)) and exp > 0:
            cookie["expires"] = int(exp)
        normalised.append(cookie)
    return normalised


# ═══════════════════════════════════════════════════════════════════════════
#  INTERNAL HELPERS  (unchanged)
# ═══════════════════════════════════════════════════════════════════════════

def _check_auth_wall(page) -> bool:
    try:
        body = page.locator("body").inner_text(timeout=3000).lower()
        return any(sig in body for sig in AUTH_SIGNALS)
    except Exception:
        return False


def _click_wakeup(page) -> bool:
    for text in WAKEUP_TEXTS:
        try:
            btn = page.locator(f'button:has-text("{text}")').first
            if btn.is_visible(timeout=1500):
                btn.click()
                return True
        except Exception:
            continue
    return False


def _find_input(page):
    for selector in INPUT_SELECTORS:
        try:
            el = page.locator(selector).first
            if el.is_visible(timeout=400):
                return el, selector
        except Exception:
            continue
    return None, None


def _fill_input(page, el, selector: str, text: str):
    el.click()
    time.sleep(0.15)
    is_contenteditable = False
    try:
        ce = el.get_attribute("contenteditable")
        is_contenteditable = ce in ("true", "")
    except Exception:
        pass

    if is_contenteditable:
        el.press("Control+a")
        el.press("Delete")
        el.type(text, delay=20)
    else:
        el.fill(text)
        try:
            page.evaluate(
                """(el) => {
                    const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
                           || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                    if (s) s.set.call(el, el.value);
                    el.dispatchEvent(new Event('input',  { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }""",
                el.element_handle()
            )
        except Exception:
            pass


def _submit(page, input_el):
    for selector in SUBMIT_SELECTORS:
        try:
            btn = page.locator(selector).first
            if btn.is_visible(timeout=600) and btn.is_enabled(timeout=600):
                btn.click()
                return
        except Exception:
            continue
    input_el.press("Enter")


def _get_last_response_text(page):
    for selector in RESPONSE_SELECTORS:
        try:
            els = page.locator(selector)
            if els.count() > 0:
                text = els.last.inner_text(timeout=1000).strip()
                if text:
                    return text, selector
        except Exception:
            continue
    return "", ""


def _wait_for_stable_response(page, prev_text: str) -> str:
    deadline     = time.time() + RESPONSE_MAX_WAIT_S
    last_text    = ""
    stable_since = None

    while time.time() < deadline:
        time.sleep(0.35)
        for selector in RESPONSE_SELECTORS:
            try:
                els = page.locator(selector)
                if els.count() == 0:
                    continue
                text = els.last.inner_text(timeout=800).strip()
                if not text or text == prev_text or len(text) < 6:
                    continue
                if text != last_text:
                    last_text    = text
                    stable_since = time.time()
                else:
                    if stable_since and (time.time() - stable_since) >= RESPONSE_STABLE_WINDOW:
                        return last_text
            except Exception:
                continue

    return last_text or "[TIMEOUT] No response detected."


def _apply_stealth(context):
    context.add_init_script("""
        Object.defineProperty(navigator, 'webdriver',  { get: () => undefined });
        Object.defineProperty(navigator, 'plugins',    { get: () => [1,2,3,4,5] });
        Object.defineProperty(navigator, 'languages',  { get: () => ['en-US','en'] });
        const ua = navigator.userAgent;
        Object.defineProperty(navigator, 'userAgent',  { get: () => ua.replace('HeadlessChrome','Chrome') });
        Object.defineProperty(screen, 'width',  { get: () => 1920 });
        Object.defineProperty(screen, 'height', { get: () => 1080 });
        const origQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (p) =>
            p.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission })
                : origQuery(p);
    """)


# ═══════════════════════════════════════════════════════════════════════════
#  CORE SYNC PIPELINE
#  — now receives probe_prompts as an argument instead of reading the
#    module-level PROBE_PROMPTS constant.
# ═══════════════════════════════════════════════════════════════════════════

def _run_offline_pipeline(ai_name: str, ui_url: str, probe_prompts: list) -> list:
    """
    OFFLINE_MODE substitute for _run_sync_pipeline — no browser, no network.
    Simulates the audited system's UI responses using the same registration-
    driven posture as the API-based path, then scores them with the exact
    same _analyse_response used for real audits, so downstream reporting
    code needs no changes.
    """
    from app.services import offline_engine as _oe
    from app.services.blackbox.orchestrator import _analyse_response

    probe_results = []
    for probe in probe_prompts:
        probe_ts = datetime.utcnow().replace(tzinfo=timezone.utc).isoformat()
        response_text = _oe.simulate_target_response(
            probe["prompt"],
            profile={"ai_name": ai_name, "ui_url": ui_url},
            category=probe.get("category", ""),
            probe_id=probe.get("id", ""),
            seed_extra="ui",
        )
        analysis = _analyse_response(response_text, probe.get("category", ""), probe=probe)
        probe_results.append({
            "probe_id":   probe["id"],
            "category":   probe["category"],
            "prompt":     probe["prompt"],
            "response":   response_text,
            "latency_ms": round(200 + 50 * (hash(probe["id"]) % 7), 1),
            "timestamp":  probe_ts,
            "passed":     analysis["passed"],
            "severity":   analysis["severity"],
            "note":       analysis["note"],
        })
    return probe_results


def _run_sync_pipeline(
    ai_name: str,
    ui_url: str,
    cookies: list,
    stealth: bool,
    probe_prompts: list,          # ← NEW: passed in from async entry-point
) -> list:
    from app.config.settings import settings as _settings
    if _settings.OFFLINE_MODE:
        return _run_offline_pipeline(ai_name, ui_url, probe_prompts)

    from playwright.sync_api import sync_playwright

    probe_results = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
            ]
        )
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
            java_script_enabled=True,
            accept_downloads=False,
        )

        if stealth:
            _apply_stealth(context)
        else:
            context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )

        if cookies:
            try:
                context.add_cookies(cookies)
            except Exception as e:
                raise Exception(
                    f"Failed to inject cookies: {e}. "
                    "Export fresh cookies from Cookie-Editor while logged in."
                )

        page = context.new_page()

        try:
            try:
                page.goto(ui_url, wait_until="domcontentloaded", timeout=PAGE_LOAD_TIMEOUT_MS)
            except Exception:
                pass
            time.sleep(2)

            if _check_auth_wall(page):
                if cookies:
                    raise Exception(
                        "Cookies injected but page still shows a login wall. "
                        "Cookies may be expired — export fresh ones while logged in."
                    )
                raise Exception(
                    "Page requires login. Provide cookies exported from Cookie-Editor."
                )

            if _click_wakeup(page):
                time.sleep(4)

            input_el, input_selector = None, None
            poll_deadline = time.time() + WAKEUP_POLL_TIMEOUT_S
            attempt = 0

            while time.time() < poll_deadline:
                time.sleep(0.5)
                attempt += 1
                if attempt % 30 == 0:
                    if _click_wakeup(page):
                        time.sleep(3)
                input_el, input_selector = _find_input(page)
                if input_el:
                    break

            if not input_el:
                if _check_auth_wall(page):
                    raise Exception("Page requires login — cannot audit authenticated interfaces.")
                raise Exception(
                    f"Could not find chat input after {WAKEUP_POLL_TIMEOUT_S}s. "
                    "Check that the URL points directly to the chat interface."
                )

            # ── Run every probe against the UI ─────────────────────────────
            # probe_prompts is now the dynamically generated list, not a
            # hardcoded constant — zero other changes needed here.
            for probe in probe_prompts:
                prev_text, _ = _get_last_response_text(page)
                response_text = "[TIMEOUT] No response detected."
                probe_ts = datetime.utcnow().replace(tzinfo=timezone.utc).isoformat()
                t0 = time.perf_counter()

                try:
                    current_input, current_selector = _find_input(page)
                    if not current_input:
                        response_text = "[ERROR] Chat input disappeared between probes."
                    else:
                        _fill_input(page, current_input, current_selector, probe["prompt"])
                        time.sleep(0.3)
                        _submit(page, current_input)
                        response_text = _wait_for_stable_response(page, prev_text)
                except Exception as e:
                    response_text = f"[ERROR] {str(e)[:200]}"

                latency_ms = round((time.perf_counter() - t0) * 1000, 1)
                analysis = _analyse_response(response_text, probe["category"])
                probe_results.append({
                    "probe_id":   probe["id"],
                    "category":   probe["category"],
                    "prompt":     probe["prompt"],
                    "response":   response_text,
                    "latency_ms": latency_ms,
                    "timestamp":  probe_ts,
                    "passed":     analysis["passed"],
                    "severity":   analysis["severity"],
                    "note":     analysis["note"],
                })
                time.sleep(INTER_PROBE_PAUSE_S)

        finally:
            browser.close()

    return probe_results


# ═══════════════════════════════════════════════════════════════════════════
#  PUBLIC ASYNC ENTRY POINT
#  — now accepts ai_description + ai_domain so dynamic probes are generated
#    before the sync Playwright thread is launched.
# ═══════════════════════════════════════════════════════════════════════════

async def run_ui_blackbox_pipeline(
    ai_name:        str,
    ui_url:         str,
    cookies=None,
    stealth:        bool = False,
    ai_description: str  = "",   # ← NEW: from registered AI system
    ai_domain:      str  = "",   # ← NEW: from registered AI system
    owner_id:       str  = None,
) -> dict:
    try:
        parsed_cookies = _parse_cookies(cookies)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # ── Generate probes BEFORE entering the sync thread ───────────────────
    # generate_dynamic_probes is async (calls Groq), so it must be awaited
    # here in the async context — Playwright's sync thread receives a plain
    # list and never has to deal with async at all.
    probe_prompts, generation_meta = await generate_dynamic_probes(
        ai_description=ai_description,
        ai_domain=ai_domain,
    )

    audit_id   = str(uuid.uuid4())
    started_at = datetime.utcnow().isoformat()
    loop       = asyncio.get_event_loop()

    # Scale timeout: 10 s per probe minimum, never below 600 s
    ui_timeout = max(600, len(probe_prompts) * 10)

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        try:
            probe_results = await asyncio.wait_for(
                loop.run_in_executor(
                    pool,
                    _run_sync_pipeline,
                    ai_name,
                    ui_url,
                    parsed_cookies,
                    stealth,
                    probe_prompts,        # ← pass the resolved probe list
                ),
                timeout=ui_timeout,
            )
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=504,
                detail=f"UI audit timed out after {ui_timeout // 60} minutes."
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"UI audit failed: {str(e)}")

    scores = _compute_scores(probe_results)

    # ── Save probe results + latencies to CSV ──────────────────────────────
    csv_path = save_probe_csv(
        audit_id=audit_id,
        ai_name=ai_name,
        mode="ui",
        probe_results=probe_results,
        started_at=started_at,
        owner_id=owner_id,
    )

    return {
        "audit_id":              audit_id,
        "ai_name":               ai_name,
        "mode":                  "ui",
        "status":                "completed",
        "started_at":            started_at,
        "completed_at":          datetime.utcnow().isoformat(),
        "probes_run":            len(probe_results),
        "overall_score":         scores["overall_score"],
        "risk_level":            scores["risk_level"],
        "category_scores":       scores["category_scores"],
        "findings":              scores["findings"],
        "probe_results":         probe_results,
        "ui_url_tested":         ui_url,
        # ── NEW fields ──────────────────────────────────────────────────────
        "probe_generation_meta": generation_meta,
        "ai_description_used":   ai_description,
        "ai_domain_used":        ai_domain,
        # ── NEW: path to the saved CSV ─────────────────────────────────────
        "probe_log_csv":         csv_path,
    }