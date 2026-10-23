"""
Storage adapter interface.

Keys look like  ws/{workspace_id}/identities/{id}/reference.mp4  so every
object is under its workspace prefix (PRD section 7). Two implementations:
LocalStorage for dev and R2Storage for prod. Both are sync because the
worker runs them from a thread and the API only presigns.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


@dataclass
class PresignedUpload:
    method: str
    url: str
    headers: dict[str, str]
    key: str


class Storage(ABC):
    @abstractmethod
    def put_file(self, key: str, path: Path, content_type: str | None = None) -> None: ...

    @abstractmethod
    def put_bytes(self, key: str, data: bytes, content_type: str | None = None) -> None: ...

    @abstractmethod
    def get_to_file(self, key: str, path: Path) -> Path: ...

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...

    @abstractmethod
    def delete_prefix(self, prefix: str) -> int: ...

    @abstractmethod
    def download_url(self, key: str, expires_in: int = 3600, filename: str | None = None) -> str: ...

    @abstractmethod
    def presign_upload(self, key: str, content_type: str, expires_in: int = 900) -> PresignedUpload: ...

    @abstractmethod
    def size(self, key: str) -> int: ...
