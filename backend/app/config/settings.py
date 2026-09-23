"""
settings.py — Centralized config for TrustShield-AI.

How to switch LLM provider:
  Dev   → LLM_PROVIDER=groq   + GROQ_API_KEY
  UAT   → LLM_PROVIDER=azure  + AZURE_OPENAI_* vars
  Prod  → LLM_PROVIDER=azure  + AZURE_OPENAI_* vars  (or gemini)

The SDCC 3-judge panel (Groq + OpenRouter + Together AI) is SEPARATE
from the primary LLM — it always uses all 3 providers simultaneously
and is NOT controlled by LLM_PROVIDER. Configure judges independently
via JUDGE_* vars and their respective API keys.

The Phase-4 SDCC detector tiebreaker (DETECTOR_GROQ_MODEL) is also
independent of LLM_PROVIDER — it always uses Groq specifically, same
as the judge panel's judge 1.
"""
from __future__ import annotations

import pathlib
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config/settings.py → parents[2] = backend/
_ENV_FILE = str(pathlib.Path(__file__).resolve().parents[2] / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    # ── App ───────────────────────────────────────────────────────────────────
    ENVIRONMENT: Literal["development", "production", "local"] = "development"
    LOG_LEVEL: str = "INFO"

    # ── Offline / static demo mode ───────────────────────────────────────────
    # When true, every network call this app would otherwise make (primary
    # LLM, 3-judge panel, Phase-4 detector, and probing the audited system)
    # is replaced by app.services.offline_engine — deterministic, seeded by
    # each AI system's own registration data. No API keys, no internet, no
    # heavy ML downloads required. Set to false to restore live behavior.
    OFFLINE_MODE: bool = True
    PORT: int = 8000

    # ── CORS ──────────────────────────────────────────────────────────────────
    ALLOWED_ORIGINS: str = "http://localhost:5173,chrome-extension://*"
    # dev default matches the origins main.py hardcoded before this refactor.
    # prod: comma-separated real domains, e.g. https://trustshield.kpmg.com

    @property
    def allowed_origins_list(self) -> list[str]:
        if self.ALLOWED_ORIGINS.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    # ── Database ──────────────────────────────────────────────────────────────
    # JSON-file storage — see app/database.py. Optional; defaults to
    # backend/data/ if left blank. No server, no schema, no install needed.
    JSON_DATA_DIR: str = ""

    # ── Auth ──────────────────────────────────────────────────────────────────
    SECRET_KEY: str = Field(..., description='JWT secret — python -c "import secrets; print(secrets.token_hex(32))"')
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    # ── Default Seed User ─────────────────────────────────────────────────────
    DEFAULT_USER_EMAIL: str = ""
    DEFAULT_USER_PASSWORD: str = ""
    DEFAULT_USER_NAME: str = ""

    # ── Google OAuth (optional) ───────────────────────────────────────────────
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""

   
    LLM_PROVIDER: Literal["groq", "azure", "gemini"] = "groq"

    # Groq (default — dev / free tier) ───────────────────────────────────────
    GROQ_API_KEY: str = ""
    GROQ_API_KEY_2: str = ""  # optional second key — rec_synthesizer rotates to this on 429
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"
    GROQ_PRIMARY_MODEL: str = "openai/gpt-oss-120b"   # heavy — probe gen, analysis
    GROQ_LIGHT_MODEL: str = "openai/gpt-oss-20b"      # fast — chat, simple tasks

    # Azure OpenAI (UAT / Prod) ───────────────────────────────────────────────
    AZURE_OPENAI_API_KEY: str = ""
    AZURE_OPENAI_ENDPOINT: str = ""          # https://your-resource.openai.azure.com
    AZURE_OPENAI_DEPLOYMENT: str = ""        # primary deployment, e.g. gpt-4o
    AZURE_OPENAI_DEPLOYMENT_LIGHT: str = ""  # light deployment, e.g. gpt-4o-mini
    AZURE_OPENAI_API_VERSION: str = "2024-12-01-preview"

    # Google Gemini (alternative — OpenAI-compatible endpoint) ────────────────
    GEMINI_API_KEY: str = ""
    GEMINI_BASE_URL: str = "https://generativelanguage.googleapis.com/v1beta/openai/"
    GEMINI_PRIMARY_MODEL: str = "gemini-2.0-flash"      # heavy
    GEMINI_LIGHT_MODEL: str = "gemini-2.0-flash-lite"   # fast

    @property
    def chat_model(self) -> str:
        """Active primary model name — determined by LLM_PROVIDER."""
        if self.LLM_PROVIDER == "groq":
            return self.GROQ_PRIMARY_MODEL
        if self.LLM_PROVIDER == "azure":
            return self.AZURE_OPENAI_DEPLOYMENT
        return self.GEMINI_PRIMARY_MODEL

    @property
    def light_model(self) -> str:
        """Active light/fast model name — determined by LLM_PROVIDER."""
        if self.LLM_PROVIDER == "groq":
            return self.GROQ_LIGHT_MODEL
        if self.LLM_PROVIDER == "azure":
            return self.AZURE_OPENAI_DEPLOYMENT_LIGHT or self.AZURE_OPENAI_DEPLOYMENT
        return self.GEMINI_LIGHT_MODEL

    # ════════════════════════════════════════════════════════════════════════
    # SDCC JUDGE PANEL  (always 3 independent providers — do not touch)
    # Judge 1 = Groq,  Judge 2 = OpenRouter,  Judge 3 = Together AI
    # Having 3 different architectures/training sets is the point.
    # ════════════════════════════════════════════════════════════════════════
    JUDGE_GROQ_MODEL:       str = "openai/gpt-oss-120b"
    JUDGE_OPENROUTER_MODEL: str = "mistralai/mistral-large"
    JUDGE_TOGETHER_MODEL:   str = "Qwen/Qwen2.5-72B-Instruct"
    JUDGE_GROQ_API_KEY:     str = ""   # falls back to GROQ_API_KEY if empty
    OPENROUTER_API_KEY:     str = ""   # empty → judge 2 disabled
    TOGETHER_API_KEY:       str = ""   # empty → judge 3 disabled

    @property
    def judge_groq_key(self) -> str:
        """Judge 1 key — dedicated key takes priority, falls back to primary Groq key."""
        return self.JUDGE_GROQ_API_KEY or self.GROQ_API_KEY

    # ── SDCC Phase-4 detector tiebreaker (always Groq, independent of LLM_PROVIDER) ──
    DETECTOR_GROQ_MODEL: str = "openai/gpt-oss-20b"

    
    STORAGE_PROVIDER: Literal["local", "azure_blob"] = "local"
    LOCAL_STORAGE_PATH: str = "./storage"
    AZURE_STORAGE_CONNECTION_STRING: str = ""
    AZURE_STORAGE_CONTAINER_KB: str = "knowledge-base"
    KB_TTL_HOURS: int = 24


settings = Settings()