"""
app/routes/admin_routes.py
==========================
Admin endpoints — updated for PostgreSQL via PgCollection shim.
"""

from fastapi import APIRouter, HTTPException, Depends
from app.dependencies import get_current_user
from app.database import users_collection, reports_collection, sdcc_collection

router = APIRouter()


def require_admin(current_user=Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def _serialize(doc: dict) -> dict:
    """Normalise id/_id for JSON serialisation."""
    if doc is None:
        return {}
    d = dict(doc)
    d["id"] = str(d.get("id") or d.get("_id") or "")
    d.pop("_id", None)
    # Datetime → ISO string
    for k, v in d.items():
        from datetime import datetime
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    return d


@router.get("/users")
def list_users(admin=Depends(require_admin)):
    users = users_collection.find({})
    return [_serialize({k: v for k, v in u.items() if k != "password"}) for u in users]


@router.get("/audits")
def list_audits(admin=Depends(require_admin)):
    docs = reports_collection.find({})
    if not docs:
        docs = sdcc_collection.find({})
    return [_serialize(d) for d in docs]


@router.get("/audits/{audit_id}")
def get_audit(audit_id: str, admin=Depends(require_admin)):
    doc = reports_collection.find_one({"report_id": audit_id})
    if not doc:
        doc = reports_collection.find_one({"id": audit_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Audit not found")
    return _serialize(doc)
