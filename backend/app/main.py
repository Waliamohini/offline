import logging
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config.settings import settings
from app.routes.auth_routes import router as auth_router
from app.routes.ai_routes import router as ai_router
from app.routes.blackbox_routes import router as blackbox_router
from app.routes.reports import router as reports_router
from app.routes.audit_extension_route import router as extension_router
from app.routes.chat_routes import router as chat_router
from app.routes.report_audit_routes import router as report_audit_router
from app.routes.admin_routes import router as admin_router
from app.routes.taf_routes import router as taf_router

logger = logging.getLogger(__name__)

app = FastAPI(title="TrustShield AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/auth", tags=["Authentication"])
app.include_router(reports_router, prefix="/reports", tags=["Reports"])
app.include_router(admin_router, prefix="/api/admin", tags=["Admin"])
app.include_router(ai_router)
app.include_router(blackbox_router)
app.include_router(extension_router)
app.include_router(chat_router)
app.include_router(report_audit_router)
app.include_router(taf_router, prefix="/taf", tags=["TAF Taxonomy"])


@app.get("/")
def root():
    return {"message": "Backend Running"}


@app.get("/health")
def health():
    return {"status": "ok", "provider": settings.LLM_PROVIDER, "env": settings.ENVIRONMENT}


@app.on_event("startup")
def seed_default_user() -> None:
    """
    Env-driven seed user — no-op when DEFAULT_USER_EMAIL/PASSWORD are unset.
    Leave both blank in production .env files to disable seeding entirely.
    Replaces the previous pattern of literal admin credentials in source.
    """
    if not (settings.DEFAULT_USER_EMAIL and settings.DEFAULT_USER_PASSWORD):
        return

    # Local imports to avoid any import-order issues with app.database's
    # module-level init_db() call.
    from app.database import users_collection
    from app.utils.security import hash_password

    if users_collection.find_one({"email": settings.DEFAULT_USER_EMAIL}):
        return

    users_collection.insert_one({
        "name":        settings.DEFAULT_USER_NAME or settings.DEFAULT_USER_EMAIL,
        "email":       settings.DEFAULT_USER_EMAIL,
        "password":    hash_password(settings.DEFAULT_USER_PASSWORD),
        "role":        "admin",
        "is_active":   True,
        "created_at":  datetime.utcnow(),
        "last_login":  None,
        "audit_count": 0,
    })
    logger.info("Seeded default user %s", settings.DEFAULT_USER_EMAIL)
