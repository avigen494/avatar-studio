"""Unit tests for the pure services: estimate, guardrails, prompts, captions."""
from __future__ import annotations

import pytest

from app.services import captions, prompts
from app.services.estimate import estimate_seconds, estimate_video, resolve_engine
from app.services.guardrails import check_script

SCRIPT_60 = " ".join(["word"] * 150)  # 150 words = 60 s at 150 wpm


def test_estimate_seconds_matches_wpm():
    assert estimate_seconds(SCRIPT_60, "en") == 61  # +1 s tail
    assert estimate_seconds("", "en") == 0


def test_estimate_credits_per_prd_table():
    # Photo-mode minute at 720p = 10 credits; one minute plus a second rounds up to 11.
    e = estimate_video(SCRIPT_60, "en", "photo", "720p")
    assert e.credits == 11 and e.inr == 22
    assert estimate_video(SCRIPT_60, "en", "real_footage", "720p").credits == 7
    assert estimate_video(SCRIPT_60, "en", "mouth_only", "720p").credits == 5
    # 1080p adds 1 credit per minute, 4K adds 2.
    assert estimate_video(SCRIPT_60, "en", "photo", "1080p").credits == 12
    assert estimate_video(SCRIPT_60, "en", "photo", "4k").credits == 13


def test_resolve_engine_auto():
    assert resolve_engine("auto", "real_person", True) == "real_footage"
    assert resolve_engine("auto", "real_person", False) == "photo"
    assert resolve_engine("auto", "designed", False) == "photo"
    assert resolve_engine("mouth_only", "real_person", False) == "photo"  # no clip -> fall back
    assert resolve_engine("mouth_only", "real_person", True) == "mouth_only"


@pytest.mark.parametrize("text,category", [
    ("This oil cures diabetes in ten days.", "medical_claim"),
    ("Join now for guaranteed income of 50,000 a month.", "income_claim"),
    ("Hi, I am Elon Musk and I love this product.", "impersonation"),
])
def test_guardrails_block_banned_claims(text, category):
    hits = check_script(text)
    assert hits and hits[0].category == category
    assert hits[0].message  # plain-English reason


def test_guardrails_allow_normal_script():
    assert check_script("Today I will show you three ways to plan your week. Start with one task.") == []


def test_guardrails_owner_can_speak_as_self():
    assert check_script("Hi, I am Narendra Modi, welcome back.", owner_name="Narendra Modi") == []


def test_prompt_render_fills_only_variables():
    text = prompts.render("script_helper", {
        "target_seconds": 60, "target_words": 150, "brief": "B", "audience": "A", "language": "English",
    })
    assert "{{" not in text and "Brief: B" in text


def test_prompt_render_rejects_missing_variable():
    with pytest.raises(prompts.PromptError):
        prompts.render("summary", {})


def test_motion_prompt_from_p2():
    p = prompts.build_motion_prompt("confident", "wave", "camera")
    assert p.startswith("confident steady expression, waves hello near the start, looking at the camera;")
    p2 = prompts.build_motion_prompt("calm", "none", "ahead")
    assert "calm relaxed face, looking slightly ahead;" in p2


def test_captions_timing_and_srt():
    cues = captions.timings("First sentence here. Second one is a little longer than the first.", 10.0)
    assert cues[0].start < cues[1].start and cues[-1].end <= 10.0
    srt = captions.to_srt(cues)
    assert srt.startswith("1\n00:00:00,200 --> ")


def test_elevenlabs_errors_are_plain_english():
    import httpx
    import pytest as _pytest

    from app.adapters.voice.elevenlabs import ElevenLabsError, raise_for_status

    body = {"detail": {"type": "payment_required", "code": "payment_issue", "message": "x", "status": "payment_issue"}}
    r = httpx.Response(401, json=body, request=httpx.Request("POST", "https://api.elevenlabs.io/v1/x"))
    with _pytest.raises(ElevenLabsError) as e:
        raise_for_status(r)
    assert "failed or incomplete payment" in str(e.value)
    ok = httpx.Response(200, content=b"audio", request=httpx.Request("POST", "https://api.elevenlabs.io/v1/x"))
    raise_for_status(ok)  # no exception
