# app/dependencies/auth.py
from fastapi import Depends, HTTPException
from firebase_admin import auth, initialize_app
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import firebase_admin
from firebase_admin import credentials

cred = credentials.Certificate("./firebase-service.json")
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
