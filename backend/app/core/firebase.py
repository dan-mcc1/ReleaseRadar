import json
import os
import firebase_admin
from firebase_admin import credentials, auth

_firebase_credentials = os.getenv("FIREBASE_CREDENTIALS")
if _firebase_credentials:
    cred = credentials.Certificate(json.loads(_firebase_credentials))
else:
    cred = credentials.Certificate("firebase-service.json")

firebase_admin.initialize_app(cred)


def verify_token(token: str):
    return auth.verify_id_token(token)
