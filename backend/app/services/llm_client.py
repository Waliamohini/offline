"""
llm_client.py — Primary LLM provider factory for TrustShield-AI.

Returns an OpenAI-compatible client for probe generation, black-box audits,
chat, rerun/reconciliation, and SDCC recommendation synthesis — every call
site that used to talk to Groq's REST API directly.

Switch provider by setting LLM_PROVIDER in .env — zero code changes.

  LLM_PROVIDER=groq   → Groq (free tier, fast, good for dev)
  LLM_PROVIDER=azure  → Azure OpenAI (enterprise SLA, UAT/Prod)
  LLM_PROVIDER=gemini → Google Gemini (OpenAI-compatible endpoint)

NOTE: This is the PRIMARY LLM only. The SDCC 3-judge panel (llm_judge.py)
and the Phase-4 detector tiebreaker (detector.py) have their own provider
selection (always Groq + OpenRouter + Together AI) and are NOT affected
by LLM_PROVIDER.

Both a sync and an async client are exposed because the codebase mixes
sync call sites (chat_routes.py) with async ones (probe_generator.py,
orchestrator.py, rerun_orchestrator.py, unified_pipeline.py,
adaptive_prober.py, rec_synthesizer.py). Retries on 429 / transient
5xx are handled by the openai SDK itself (max_retries, exponential
backoff with jitter, and it respects a Retry-After header when the
provider sends one) — callers no longer need bespoke retry loops.
"""
from __future__ import annotations

import logging
from functools import lru_cache

try:
    from openai import AsyncAzureOpenAI, AsyncOpenAI, AzureOpenAI, OpenAI
except ImportError:
    # Only ever instantiated by the live-provider branches below, all of
    # which are skipped when OFFLINE_MODE=true (see get_llm_client /
    # get_async_llm_client) — so the openai package isn't needed at all
    # for the offline build. Flip OFFLINE_MODE=false and pip install
    # openai to use a real provider again.
    AsyncAzureOpenAI = AsyncOpenAI = AzureOpenAI = OpenAI = None

from app.config.settings import settings
from app.services import offline_engine

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────
# OFFLINE MODE — see app/services/offline_engine.py for the full design.
# These two tiny shim classes give the rest of the codebase an object that
# looks like an OpenAI client (`.chat.completions.create(**kwargs)` →
# something with `.choices[0].message.content`), backed by the offline
# engine instead of a network call. No other call site needs to change.
# ─────────────────────────────────────────────────────────────────────────

class _Msg:
    def __init__(self, content: str):
        self.content = content


class _Choice:
    def __init__(self, content: str):
        self.message = _Msg(content)


class _Completion:
    def __init__(self, content: str):
        self.choices = [_Choice(content)]


class _OfflineChatCompletions:
    def create(self, **kwargs):
        content = offline_engine.mock_complete(
            messages=kwargs.get("messages", []),
            response_format=kwargs.get("response_format"),
        )
        return _Completion(content)


class _OfflineAsyncChatCompletions:
    async def create(self, **kwargs):
        content = offline_engine.mock_complete(
            messages=kwargs.get("messages", []),
            response_format=kwargs.get("response_format"),
        )
        return _Completion(content)


class _OfflineChatNamespace:
    def __init__(self, async_mode: bool = False):
        self.completions = _OfflineAsyncChatCompletions() if async_mode else _OfflineChatCompletions()


class OfflineLLMClient:
    """Sync offline stand-in for OpenAI/AzureOpenAI clients."""
    def __init__(self):
        self.chat = _OfflineChatNamespace(async_mode=False)


class OfflineAsyncLLMClient:
    """Async offline stand-in for AsyncOpenAI/AsyncAzureOpenAI clients."""
    def __init__(self):
        self.chat = _OfflineChatNamespace(async_mode=True)

# How many times the SDK itself retries a 429/5xx before giving up and
# raising, per call. Kept generous because probe generation historically
# tolerated up to 4 retries with Groq's free-tier rate limits.
_DEFAULT_MAX_RETRIES = 4
_DEFAULT_TIMEOUT = 90.0


@lru_cache(maxsize=None)
def get_llm_client() -> OpenAI:
    """
    Return a cached sync OpenAI-compatible client for the active LLM_PROVIDER.
    Call this once per module — the instance is reused across requests.
    """
    if settings.OFFLINE_MODE:
        return OfflineLLMClient()

    if settings.LLM_PROVIDER == "azure":
        if not settings.AZURE_OPENAI_API_KEY:
            raise RuntimeError(
                "LLM_PROVIDER=azure but AZURE_OPENAI_API_KEY is not set. "
                "Add it to backend/.env"
            )
        return AzureOpenAI(
            api_key=settings.AZURE_OPENAI_API_KEY,
            azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
            api_version=settings.AZURE_OPENAI_API_VERSION,
            max_retries=_DEFAULT_MAX_RETRIES,
            timeout=_DEFAULT_TIMEOUT,
        )

    if settings.LLM_PROVIDER == "gemini":
        if not settings.GEMINI_API_KEY:
            raise RuntimeError(
                "LLM_PROVIDER=gemini but GEMINI_API_KEY is not set. "
                "Add it to backend/.env"
            )
        return OpenAI(
            api_key=settings.GEMINI_API_KEY,
            base_url=settings.GEMINI_BASE_URL,
            max_retries=_DEFAULT_MAX_RETRIES,
            timeout=_DEFAULT_TIMEOUT,
        )

    # Default: groq (OpenAI-compatible endpoint)
    return OpenAI(
        api_key=settings.GROQ_API_KEY,
        base_url=settings.GROQ_BASE_URL,
        max_retries=_DEFAULT_MAX_RETRIES,
        timeout=_DEFAULT_TIMEOUT,
    )


@lru_cache(maxsize=None)
def get_async_llm_client() -> AsyncOpenAI:
    """
    Return a cached async OpenAI-compatible client for the active LLM_PROVIDER.
    Use this from async call sites instead of raw httpx + manual 429 parsing —
    the SDK already retries on 429/5xx with backoff.
    """
    if settings.OFFLINE_MODE:
        return OfflineAsyncLLMClient()

    if settings.LLM_PROVIDER == "azure":
        if not settings.AZURE_OPENAI_API_KEY:
            raise RuntimeError(
                "LLM_PROVIDER=azure but AZURE_OPENAI_API_KEY is not set. "
                "Add it to backend/.env"
            )
        return AsyncAzureOpenAI(
            api_key=settings.AZURE_OPENAI_API_KEY,
            azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
            api_version=settings.AZURE_OPENAI_API_VERSION,
            max_retries=_DEFAULT_MAX_RETRIES,
            timeout=_DEFAULT_TIMEOUT,
        )

    if settings.LLM_PROVIDER == "gemini":
        if not settings.GEMINI_API_KEY:
            raise RuntimeError(
                "LLM_PROVIDER=gemini but GEMINI_API_KEY is not set. "
                "Add it to backend/.env"
            )
        return AsyncOpenAI(
            api_key=settings.GEMINI_API_KEY,
            base_url=settings.GEMINI_BASE_URL,
            max_retries=_DEFAULT_MAX_RETRIES,
            timeout=_DEFAULT_TIMEOUT,
        )

    # Default: groq (OpenAI-compatible endpoint)
    return AsyncOpenAI(
        api_key=settings.GROQ_API_KEY,
        base_url=settings.GROQ_BASE_URL,
        max_retries=_DEFAULT_MAX_RETRIES,
        timeout=_DEFAULT_TIMEOUT,
    )


def is_llm_configured() -> bool:
    """
    True if the active LLM_PROVIDER has the credentials it needs.
    Replaces the old pattern of call sites checking `GROQ_API_KEY` directly
    as a proxy for "should I even attempt an LLM call" — that check needs to
    follow whichever provider is actually active.
    """
    if settings.OFFLINE_MODE:
        return True

    if settings.LLM_PROVIDER == "azure":
        return bool(settings.AZURE_OPENAI_API_KEY and settings.AZURE_OPENAI_ENDPOINT)
    if settings.LLM_PROVIDER == "gemini":
        return bool(settings.GEMINI_API_KEY)
    return bool(settings.GROQ_API_KEY)


def get_primary_model() -> str:
    """Return the primary (heavy) model name for the active provider."""
    return settings.chat_model


def get_light_model() -> str:
    """Return the light/fast model name for the active provider."""
    return settings.light_model


def chat_complete(
    messages: list[dict],
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: str | None = None,
    response_format: dict | None = None,
) -> str:
    """
    Sync convenience wrapper — call primary LLM and return the reply text.
    Use this in routes/services to avoid repeating client boilerplate.

    Example:
        from app.services.llm_client import chat_complete
        reply = chat_complete([{"role": "user", "content": "Hello"}])
    """
    client = get_llm_client()
    kwargs = dict(
        model=model or get_primary_model(),
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    if response_format is not None:
        kwargs["response_format"] = response_format
    completion = client.chat.completions.create(**kwargs)
    return completion.choices[0].message.content


async def achat_complete(
    messages: list[dict],
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: str | None = None,
    response_format: dict | None = None,
) -> str | None:
    """
    Async convenience wrapper — call primary LLM and return the reply text,
    or None if every retry attempt failed (mirrors the old raw-httpx callers'
    "return None → fallback probes/results" contract used throughout
    probe_generator.py, orchestrator.py, rerun_orchestrator.py, etc.).

    Retries on 429 / transient errors are handled by the SDK's max_retries —
    no bespoke Retry-After parsing needed here.
    """
    client = get_async_llm_client()
    kwargs = dict(
        model=model or get_primary_model(),
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    if response_format is not None:
        kwargs["response_format"] = response_format
    try:
        completion = await client.chat.completions.create(**kwargs)
        return completion.choices[0].message.content
    except Exception as e:
        logger.warning("[llm_client] achat_complete failed after retries: %s", e)
        return None
