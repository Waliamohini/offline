from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime


class RegisterSchema(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=8)


class LoginSchema(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: str
    audit_count: int = 0
    created_at: datetime
    last_login: Optional[datetime] = None

    class Config:
        from_attributes = True