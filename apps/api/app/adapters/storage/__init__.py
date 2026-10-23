from app.adapters.storage.base import PresignedUpload, Storage
from app.services.runtime_config import cfg

_instances: dict[str, Storage] = {}


def current_backend() -> str:
    return cfg("storage_backend") or "local"


def get_storage(backend: str | None = None) -> Storage:
    """Storage for the live backend setting. R2 is rebuilt when its keys change."""
    name = backend or current_backend()
    if name == "r2":
        sig = "r2:" + ":".join(cfg(k) or "" for k in ("r2_account_id", "r2_access_key_id", "r2_bucket"))
        if sig not in _instances:
            from app.adapters.storage.r2 import R2Storage

            _instances.clear()
            _instances[sig] = R2Storage()
        return _instances[sig]
    if "local" not in _instances:
        from app.adapters.storage.local import LocalStorage

        _instances["local"] = LocalStorage()
    return _instances["local"]


__all__ = ["Storage", "PresignedUpload", "get_storage"]
