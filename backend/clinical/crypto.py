import base64
import hashlib
import json
import os

from cryptography.fernet import Fernet
from django.conf import settings
from django.utils.crypto import salted_hmac


def _fallback_key():
    digest = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def fernet():
    key = os.environ.get("FIELD_ENCRYPTION_KEY")
    if key:
        return Fernet(key.encode("utf-8"))
    return Fernet(_fallback_key())


def encrypt_json(payload):
    data = json.dumps(payload or {}, ensure_ascii=True, sort_keys=True).encode("utf-8")
    return fernet().encrypt(data).decode("utf-8")


def decrypt_json(token):
    if not token:
        return {}
    data = fernet().decrypt(token.encode("utf-8"))
    return json.loads(data.decode("utf-8"))


def normalize_lookup(value):
    return "".join(str(value or "").strip().upper().split())


def lookup_hash(value, namespace):
    normalized = normalize_lookup(value)
    return salted_hmac(f"hitop.{namespace}", normalized, secret=settings.SECRET_KEY).hexdigest()
