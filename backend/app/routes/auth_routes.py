"""
app/routes/auth_routes.py
=========================
Authentication endpoints — identical business logic, now backed by PostgreSQL
via the PgCollection shim.  Adds toast-friendly error responses: every 4xx
detail is a short human-readable string the frontend can display in a toast.
"""

from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field
from typing import Optional

from app.schemas import RegisterSchema, LoginSchema, TokenResponse
from app.database import users_collection
from app.utils.security import hash_password, verify_password, create_access_token
from app.dependencies import get_current_user

router = APIRouter()


# ── Register (auditor) ────────────────────────────────────────────────────────
@router.post("/register")
def register(user: RegisterSchema):
    if users_collection.find_one({"email": user.email}):
        raise HTTPException(
            status_code=400,
            detail="An account with this email already exists.",   # toast-ready
        )
    users_collection.insert_one({
        "name":        user.name,
        "email":       user.email,
        "password":    hash_password(user.password),
        "role":        "auditor",
        "is_active":   True,
        "created_at":  datetime.utcnow(),
        "last_login":  None,
        "audit_count": 0,
    })
    return {"message": "User registered successfully"}


# ── Register Admin ─────────────────────────────────────────────────────────────
class AdminRegisterSchema(BaseModel):
    name:     str   = Field(..., min_length=2, max_length=100)
    email:    EmailStr
    password: str   = Field(..., min_length=8)


@router.post("/register-admin")
def register_admin(user: AdminRegisterSchema):
    if users_collection.find_one({"email": user.email}):
        raise HTTPException(status_code=400, detail="An account with this email already exists.")
    users_collection.insert_one({
        "name":        user.name,
        "email":       user.email,
        "password":    hash_password(user.password),
        "role":        "admin",
        "is_active":   True,
        "created_at":  datetime.utcnow(),
        "last_login":  None,
        "audit_count": 0,
    })
    return {"message": "Admin registered successfully"}


# ── Login ──────────────────────────────────────────────────────────────────────
@router.post("/login", response_model=TokenResponse)
def login(user: LoginSchema):
    db_user = users_collection.find_one({"email": user.email})
    if not db_user:
        raise HTTPException(status_code=400, detail="Invalid email or password.")

    stored = db_user.get("password", "")
    if not stored.startswith("$2b$") and not stored.startswith("$2a$"):
        raise HTTPException(
            status_code=400,
            detail="Account password is corrupted — please re-register.",
        )
    if not verify_password(user.password, stored):
        raise HTTPException(status_code=400, detail="Invalid email or password.")

    users_collection.update_one(
        {"email": user.email},
        {"$set": {"last_login": datetime.utcnow()}},
    )

    token = create_access_token({
        "sub":     db_user["email"],
        "user_id": str(db_user.get("id") or db_user.get("_id")),
        "role":    db_user["role"],
    })
    return {"access_token": token, "token_type": "bearer"}


# ── Get Profile ────────────────────────────────────────────────────────────────
@router.get("/me")
def get_profile(current_user=Depends(get_current_user)):
    created = current_user.get("created_at")
    last    = current_user.get("last_login")
    return {
        "id":          str(current_user.get("id") or current_user.get("_id")),
        "name":        current_user["name"],
        "email":       current_user["email"],
        "role":        current_user["role"],
        "audit_count": current_user.get("audit_count", 0),
        "created_at":  created.isoformat() if isinstance(created, datetime) else None,
        "last_login":  last.isoformat()    if isinstance(last,    datetime) else None,
    }


# ── Update Profile ─────────────────────────────────────────────────────────────
class UpdateProfileSchema(BaseModel):
    name: Optional[str] = None


@router.patch("/me")
def update_profile(payload: UpdateProfileSchema, current_user=Depends(get_current_user)):
    updates: dict = {}
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty.")
        updates["name"] = name
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update.")

    users_collection.update_one(
        {"email": current_user["email"]},
        {"$set": updates},
    )
    return {"message": "Profile updated successfully", **updates}
