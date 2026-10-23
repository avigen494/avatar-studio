"""Local-disk storage for development. Files live under data/storage/<key>."""
from __future__ import annotations

import shutil
from pathlib import Path
from urllib.parse import quote

from app.adapters.storage.base import PresignedUpload, Storage
from app.config import settings
from app.services.crypto import sign_media


class LocalStorage(Storage):
    def __init__(self, root: str | None = None):
        self.root = Path(root or settings.local_storage_root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        clean = key.lstrip("/")
        if ".." in Path(clean).parts:
            raise ValueError("Invalid storage key")
        return self.root / clean

    def put_file(self, key: str, path: Path, content_type: str | None = None) -> None:
        dst = self._path(key)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, dst)

    def put_bytes(self, key: str, data: bytes, content_type: str | None = None) -> None:
        dst = self._path(key)
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(data)

    def get_to_file(self, key: str, path: Path) -> Path:
        src = self._path(key)
        if not src.exists():
            raise FileNotFoundError(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, path)
        return path

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def delete(self, key: str) -> None:
        p = self._path(key)
        if p.exists():
            p.unlink()

    def delete_prefix(self, prefix: str) -> int:
        p = self._path(prefix)
        if not p.exists():
            return 0
        count = sum(1 for _ in p.rglob("*") if _.is_file())
        shutil.rmtree(p, ignore_errors=True)
        return count

    def size(self, key: str) -> int:
        return self._path(key).stat().st_size

    def download_url(self, key: str, expires_in: int = 3600, filename: str | None = None) -> str:
        exp, sig = sign_media(key, expires_in)
        url = f"{settings.api_base_url}/media/{quote(key)}?exp={exp}&sig={sig}"
        if filename:
            url += f"&dl={quote(filename)}"
        return url

    def presign_upload(self, key: str, content_type: str, expires_in: int = 900) -> PresignedUpload:
        exp, sig = sign_media(key, expires_in)
        return PresignedUpload(
            method="PUT",
            url=f"{settings.api_base_url}/uploads/local/{quote(key)}?exp={exp}&sig={sig}",
            headers={"Content-Type": content_type},
            key=key,
        )
