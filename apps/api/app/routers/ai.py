from __future__ import annotations

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from app.adapters import llm
from app.deps import ApiError, CanEdit, Ctx
from app.schemas import GuardrailOut, ScriptHelpIn, ScriptHelpOut
from app.services.estimate import count_words, estimate_seconds
from app.services.guardrails import check_script

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/script", response_model=ScriptHelpOut)
async def script_help(body: ScriptHelpIn, ctx: Ctx = CanEdit) -> ScriptHelpOut:
    """P1 script helper. Prompt text lives in prompts/script_helper.v1.md."""
    target_words = round(body.target_seconds / 60 * 150)
    language = {"en": "English", "hi": "Hindi", "hinglish": "Hinglish"}[body.language]
    try:
        result = await run_in_threadpool(
            llm.complete, "script_helper",
            {"target_seconds": body.target_seconds, "target_words": target_words, "brief": body.brief.strip(),
             "audience": body.audience.strip(), "language": language},
            "sonnet", 2048,
        )
    except llm.LLMUnavailable as e:
        raise ApiError(503, "assistant_unavailable", str(e))
    if result.refused:
        raise ApiError(422, "declined", "The assistant could not write this brief. Rephrase it and try again.")
    hits = check_script(result.text)
    return ScriptHelpOut(
        script=result.text, words=count_words(result.text), seconds=estimate_seconds(result.text, body.language),
        model=result.model, guardrails=[GuardrailOut(category=h.category, excerpt=h.excerpt, message=h.message) for h in hits],
    )
