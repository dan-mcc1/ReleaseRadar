# app/dependencies/auth.py
from fastapi import Depends, HTTPException
from firebase_admin import auth
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import firebase_admin
from firebase_admin import credentials
from app.config import settings

if not firebase_admin._apps:
    cred = credentials.Certificate(settings.FIREBASE_CREDS_PATH)
    firebase_admin.initialize_app(cred)

bearer_scheme = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    try:
        decoded_token = auth.verify_id_token(credentials.credentials)
        uid = decoded_token["uid"]
        return uid
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
