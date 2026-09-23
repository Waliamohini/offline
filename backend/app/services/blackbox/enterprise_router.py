import re
from typing import Optional
from fastapi import HTTPException

# ═══════════════════════════════════════════════════════════════════════════
#  PLATFORM PROFILES
# ═══════════════════════════════════════════════════════════════════════════

PLATFORM_PROFILES = [
    {
        "id":            "chatgpt",
        "label":         "ChatGPT Enterprise",
        "url_patterns":  [r"chat\.openai\.com", r"chatgpt\.com"],
        "name_keywords": ["chatgpt", "chat gpt", "openai"],
        "preferred_mode": "ui",
        "stealth":        True,
        "needs_cookies":  True,
        "notes": "ChatGPT requires login. Export cookies from chat.openai.com via Cookie-Editor.",
        "input_selectors_override":    ["div#prompt-textarea[contenteditable='true']", "#prompt-textarea"],
        "response_selectors_override": ["[data-message-author-role='assistant']", ".agent-turn"],
        "submit_selectors_override":   ["button[data-testid='send-button']", "button[aria-label='Send prompt']"],
    },
    {
        "id":            "azure_openai",
        "label":         "Azure OpenAI / Copilot Studio",
        "url_patterns":  [r"oai\.azure\.com", r"ai\.azure\.com", r"portal\.azure\.com", r"copilotstudio\.microsoft\.com"],
        "name_keywords": ["azure", "azure openai", "copilot studio", "azure ai"],
        "preferred_mode": "api",
        "stealth":        False,
        "needs_cookies":  True,
        "notes": "Azure OpenAI has a REST API — API mode recommended. For UI mode export cookies from Azure portal.",
        "input_selectors_override":    ["[data-automation-id='chat-input']", "textarea[placeholder*='Type a message' i]"],
        "response_selectors_override": ["[data-automation-id='chat-message-content']", ".assistant-message"],
        "submit_selectors_override":   ["[data-automation-id='send-button']"],
    },
    {
        "id":            "gemini",
        "label":         "Gemini for Workspace",
        "url_patterns":  [r"gemini\.google\.com", r"bard\.google\.com"],
        "name_keywords": ["gemini", "bard", "google ai"],
        "preferred_mode": "ui",
        "stealth":        True,
        "needs_cookies":  True,
        "notes": "Gemini requires Google login. Export cookies from gemini.google.com via Cookie-Editor.",
        "input_selectors_override":    ["rich-textarea div[contenteditable='true']", "div.ql-editor[contenteditable='true']"],
        "response_selectors_override": ["model-response", ".model-response-text", "message-content"],
        "submit_selectors_override":   ["button[aria-label='Send message']", "button.send-button"],
    },
    {
        "id":            "ms_copilot",
        "label":         "Microsoft Copilot",
        "url_patterns":  [r"copilot\.microsoft\.com", r"bing\.com/chat"],
        "name_keywords": ["microsoft copilot", "bing chat", "copilot"],
        "preferred_mode": "ui",
        "stealth":        True,
        "needs_cookies":  True,
        "notes": "Microsoft Copilot requires Microsoft account login. Export cookies from copilot.microsoft.com.",
        "input_selectors_override":    ["textarea[placeholder*='Ask me anything' i]", "textarea[placeholder*='Message Copilot' i]", "#searchbox"],
        "response_selectors_override": ["cib-message-group cib-message", ".ac-textBlock", "[data-testid='message-content']"],
        "submit_selectors_override":   ["button#search-button", "button[aria-label*='Send' i]"],
    },
]

CUSTOM_APP_PROFILE = {
    "id":            "custom",
    "label":         "Custom App",
    "url_patterns":  [],
    "name_keywords": [],
    "preferred_mode": "ui",
    "stealth":        False,
    "needs_cookies":  False,
    "notes":          "Custom deployment — using generic UI mode.",
    "input_selectors_override":    [],
    "response_selectors_override": [],
    "submit_selectors_override":   [],
}


# ═══════════════════════════════════════════════════════════════════════════
#  PLATFORM DETECTION
# ═══════════════════════════════════════════════════════════════════════════

def detect_platform(ui_url: str = "", ai_name: str = "") -> dict:
    url_lower  = (ui_url or "").lower()
    name_lower = (ai_name or "").lower()
    for profile in PLATFORM_PROFILES:
        for pattern in profile["url_patterns"]:
            if re.search(pattern, url_lower):
                return profile
        for keyword in profile["name_keywords"]:
            if keyword in name_lower:
                return profile
    return CUSTOM_APP_PROFILE


# ═══════════════════════════════════════════════════════════════════════════
#  SELECTOR PATCHING — merges platform selectors to front of global lists
# ═══════════════════════════════════════════════════════════════════════════

def _patch_selectors(ui_auditor_module, profile: dict):
    for override_key, module_attr in [
        ("input_selectors_override",    "INPUT_SELECTORS"),
        ("response_selectors_override", "RESPONSE_SELECTORS"),
        ("submit_selectors_override",   "SUBMIT_SELECTORS"),
    ]:
        overrides = profile.get(override_key, [])
        if overrides:
            current = getattr(ui_auditor_module, module_attr, [])
            merged  = overrides + [s for s in current if s not in overrides]
            setattr(ui_auditor_module, module_attr, merged)


# ═══════════════════════════════════════════════════════════════════════════
#  STEALTH PATCHES
# ═══════════════════════════════════════════════════════════════════════════

def apply_stealth(context):
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
#  MAIN ROUTER
# ═══════════════════════════════════════════════════════════════════════════

async def route_audit(
    ai_name:  str,
    mode:     str,
    ui_url:   str  = "",
    endpoint: str  = "",
    api_key:  str  = "",
    cookies=None,
) -> dict:
    """
    Single entry point for all audit types.
    mode = "api"  → calls orchestrator.run_blackbox_pipeline directly
    mode = "ui"   → patches selectors, calls ui_auditor.run_ui_blackbox_pipeline
    mode = "extension" → results already collected, just call /audit/score endpoint
    """
    profile = detect_platform(ui_url=ui_url, ai_name=ai_name)

    cookie_warning = None
    if mode == "ui" and profile["needs_cookies"] and not cookies:
        cookie_warning = (
            f"{profile['label']} requires login. No cookies provided. "
            f"Export cookies from the target site using Cookie-Editor."
        )

    # ── API MODE ─────────────────────────────────────────────────────────
    if mode == "api":
        from app.services.blackbox.orchestrator import run_blackbox_pipeline
        result = await run_blackbox_pipeline(
            ai_name=ai_name, mode="api", endpoint=endpoint, api_key=api_key
        )
        result["platform_detected"] = profile["label"]
        result["platform_notes"]    = profile["notes"]
        if cookie_warning:
            result["warning"] = cookie_warning
        return result

    # ── UI MODE ───────────────────────────────────────────────────────────
    if mode == "ui":
        if not ui_url:
            raise HTTPException(status_code=422, detail="ui_url is required for UI mode.")
        from app.services.blackbox import ui_auditor
        _patch_selectors(ui_auditor, profile)
        result = await ui_auditor.run_ui_blackbox_pipeline(
            ai_name=ai_name,
            ui_url=ui_url,
            cookies=cookies,
            stealth=profile["stealth"],
        )
        result["platform_detected"] = profile["label"]
        result["platform_notes"]    = profile["notes"]
        if cookie_warning:
            result["warning"] = cookie_warning
        return result

    raise HTTPException(status_code=422, detail=f"Unknown mode '{mode}'. Use 'api' or 'ui'.")


# ── Convenience: list all known platforms (for frontend dropdowns) ─────────
def list_platforms() -> list:
    return [
        {
            "id":             p["id"],
            "label":          p["label"],
            "preferred_mode": p["preferred_mode"],
            "needs_cookies":  p["needs_cookies"],
            "notes":          p["notes"],
        }
        for p in PLATFORM_PROFILES
    ] + [{
        "id": "custom", "label": "Custom / Other",
        "preferred_mode": "ui", "needs_cookies": False,
        "notes": CUSTOM_APP_PROFILE["notes"],
    }]
