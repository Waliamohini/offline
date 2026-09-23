import bcrypt
from jose import jwt, JWTError
from datetime import datetime, timedelta

from app.config.settings import settings

SECRET_KEY = settings.SECRET_KEY
ALGORITHM = settings.ALGORITHM

# 🔥 Separate expiry configs
ACCESS_TOKEN_EXPIRE_MINUTES = settings.ACCESS_TOKEN_EXPIRE_MINUTES
REFRESH_TOKEN_EXPIRE_DAYS = 7


# ── PASSWORD HASHING ─────────────────────────────────────
def hash_password(password: str) -> str:
    return bcrypt.hashpw(
        password.encode("utf-8"),
        bcrypt.gensalt()
    ).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(
            plain.encode("utf-8"),
            hashed.encode("utf-8")
        )
    except Exception:
        return False


# ── TOKEN CREATION ───────────────────────────────────────
def create_access_token(data: dict) -> str:
    to_encode = data.copy()

    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({
        "exp": expire,
        "type": "access"   # 🔥 IMPORTANT
    })

    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()

    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    to_encode.update({
        "exp": expire,
        "type": "refresh"
    })

    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# ── TOKEN VERIFY (VERY IMPORTANT) ────────────────────────
def decode_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None