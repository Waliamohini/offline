"""
app/dependencies.py
===================
FastAPI auth dependency — unchanged API, updated to use PostgreSQL via
the PgCollection shim in app/database.py.
"""

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
import uuid
from app.database import users_collection
from app.config.settings import settings

SECRET_KEY = settings.SECRET_KEY
ALGORITHM  = settings.ALGORITHM

security = HTTPBearer()


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email   = payload.get("sub")
        user    = users_collection.find_one({"email": email})
        if not user:
            raise HTTPException(status_code=401, detail="Invalid user")
        return user
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
