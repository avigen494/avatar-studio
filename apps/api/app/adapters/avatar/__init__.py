from app.adapters.avatar.base import AvatarEngine, RenderRequest, RenderResult
from app.config import settings
from app.services.runtime_config import cfg

_engines: dict[str, AvatarEngine] = {}


def current_backend() -> str:
    return cfg("avatar_engine_backend") or "mock"


def get_avatar_engine(backend: str | None = None) -> AvatarEngine:
    """The engine for the live backend setting (changes apply without restart)."""
    name = backend or current_backend()
    if name not in _engines:
        if name == "runpod":
            from app.adapters.avatar.runpod import RunPodAvatarEngine

            _engines[name] = RunPodAvatarEngine()
        else:
            from app.adapters.avatar.mock import MockAvatarEngine

            _engines[name] = MockAvatarEngine()
    return _engines[name]


def engine_name_for(resolved_mode: str) -> str:
    """Map the user-facing mode to the concrete model the GPU should load."""
    photo = cfg("default_engine_photo") or settings.default_engine_photo
    return {
        "photo": photo,
        "real_footage": settings.default_engine_real_footage,
        "mouth_only": settings.default_engine_mouth_only,
    }.get(resolved_mode, photo)


__all__ = ["AvatarEngine", "RenderRequest", "RenderResult", "get_avatar_engine", "engine_name_for"]
