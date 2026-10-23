"""
Credit and duration estimates (PRD section 9, hard rule 4).

    Photo-mode minute (720p)     10 credits
    Real-footage minute           6 credits
    Mouth-only minute             4 credits
    1080p finish per minute      +1 credit
    4K finish per minute         +2 credits

Credits are prorated to the second and rounded up to a whole credit. A
preview is always free. One credit = 2 rupees list price.
"""
from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass

from app.config import settings

RATE_PER_MINUTE = {"photo": 10, "real_footage": 6, "mouth_only": 4}
QUALITY_SURCHARGE = {"720p": 0, "1080p": 1, "4k": 2}
# Hindi and Hinglish are spoken a little slower than English on average.
WPM_BY_LANGUAGE = {"en": settings.words_per_minute, "hi": 130, "hinglish": 140}

# Credits for other work, from the same table.
TRAIN_STYLE_CREDITS = 40
NEW_LOOK_CREDITS = 2
TRANSLATE_PER_MINUTE = 6


@dataclass
class Estimate:
    seconds: int
    minutes: float
    credits: int
    engine: str
    quality: str
    inr: int
    words: int
    breakdown: dict

    def to_dict(self) -> dict:
        return asdict(self)


def count_words(script: str) -> int:
    return len([w for w in re.split(r"\s+", script.strip()) if w])


def estimate_seconds(script: str, language: str = "en") -> int:
    words = count_words(script)
    wpm = WPM_BY_LANGUAGE.get(language, settings.words_per_minute)
    if words == 0:
        return 0
    # Add a short lead-in and tail so the number matches the finished file.
    return max(3, math.ceil(words / wpm * 60) + 1)


def resolve_engine(engine_mode: str, identity_kind: str, has_reference_clip: bool) -> str:
    """
    'auto' picks the cheapest engine that can produce a good result:
    real footage when the user recorded a clip, photo mode otherwise.
    Designed avatars have no real footage, so they always use photo mode.
    """
    if engine_mode in RATE_PER_MINUTE:
        if engine_mode in ("real_footage", "mouth_only") and not has_reference_clip:
            return "photo"
        return engine_mode
    if identity_kind == "real_person" and has_reference_clip:
        return "real_footage"
    return "photo"


def estimate_video(script: str, language: str, engine: str, quality: str) -> Estimate:
    seconds = estimate_seconds(script, language)
    minutes = seconds / 60
    rate = RATE_PER_MINUTE.get(engine, RATE_PER_MINUTE["photo"])
    surcharge = QUALITY_SURCHARGE.get(quality, 0)
    base = minutes * rate
    extra = minutes * surcharge
    credits = math.ceil(base + extra) if seconds else 0
    return Estimate(
        seconds=seconds,
        minutes=round(minutes, 2),
        credits=credits,
        engine=engine,
        quality=quality,
        inr=credits * settings.credit_price_inr,
        words=count_words(script),
        breakdown={
            "rate_per_minute": rate,
            "quality_surcharge_per_minute": surcharge,
            "base_credits": round(base, 2),
            "quality_credits": round(extra, 2),
        },
    )
