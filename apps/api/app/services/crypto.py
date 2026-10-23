"""
Small crypto helpers: encrypt BYO voice keys at rest, sign local media URLs,
hash share-page passwords. All derive from SECRET_KEY so there is one secret
to rotate.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


def _fernet() -> Fernet:
    key = hashlib.sha256(settings.secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt(text: str) -> str:
    return _fernet().encrypt(text.encode()).decode()


def decrypt(token: str) -> str | None:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None


def sign_media(key: str, expires_in: int = 3600) -> tuple[int, str]:
    exp = int(time.time()) + expires_in
    sig = hmac.new(settings.secret_key.encode(), f"{key}:{exp}".encode(), hashlib.sha256).hexdigest()[:32]
    return exp, sig


def verify_media(key: str, exp: int, sig: str) -> bool:
    if exp < int(time.time()):
        return False
    expected = hmac.new(settings.secret_key.encode(), f"{key}:{exp}".encode(), hashlib.sha256).hexdigest()[:32]
    return hmac.compare_digest(expected, sig)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(8)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    return f"{salt}${digest}"


def check_password(password: str, stored: str) -> bool:
    try:
        salt, digest = stored.split("$", 1)
    except ValueError:
        return False
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    return hmac.compare_digest(candidate, digest)


def new_token(nbytes: int = 12) -> str:
    return secrets.token_urlsafe(nbytes)
