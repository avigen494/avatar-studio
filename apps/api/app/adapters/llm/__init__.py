"""
LLM adapter. Every call goes through `complete()`, which takes a prompt
NAME (never inline text) so hard rule 12 holds: prompts come from /prompts.

Tiers map to models in settings: "sonnet" for script help, translation and
planning; "haiku" for delivery tags and share-page summaries.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from app.config import settings
from app.services.runtime_config import cfg
from app.services import prompts


@dataclass
class LLMResult:
    text: str
    model: str
    refused: bool = False
    refusal_reason: str | None = None


class LLMUnavailable(RuntimeError):
    pass


def _model_for(tier: str) -> str:
    return (cfg("llm_model_haiku") or settings.llm_model_haiku) if tier == "haiku" else (cfg("llm_model_sonnet") or settings.llm_model_sonnet)


def available() -> bool:
    return bool(cfg("anthropic_api_key"))


def complete(prompt_name: str, variables: dict, tier: str = "sonnet", max_tokens: int = 2048,
             version: int = 1) -> LLMResult:
    """Render the prompt file and run it as a single user turn."""
    text = prompts.render(prompt_name, variables, version)
    if not available():
        return _mock(prompt_name, variables, text)

    import anthropic

    client = anthropic.Anthropic(api_key=cfg("anthropic_api_key"))
    model = _model_for(tier)
    try:
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": text}],
        )
    except anthropic.RateLimitError as e:
        raise LLMUnavailable("The writing assistant is busy. Try again in a minute.") from e
    except anthropic.APIStatusError as e:
        raise LLMUnavailable(f"The writing assistant returned an error ({e.status_code}).") from e
    except anthropic.APIConnectionError as e:
        raise LLMUnavailable("Could not reach the writing assistant.") from e

    if response.stop_reason == "refusal":
        reason = None
        if getattr(response, "stop_details", None) is not None:
            reason = getattr(response.stop_details, "explanation", None)
        return LLMResult(text="", model=model, refused=True, refusal_reason=reason)

    out = "".join(block.text for block in response.content if getattr(block, "type", "") == "text")
    return LLMResult(text=out.strip(), model=model)


def complete_json(prompt_name: str, variables: dict, tier: str = "sonnet", version: int = 1) -> dict:
    result = complete(prompt_name, variables, tier, max_tokens=4096, version=version)
    if result.refused:
        raise LLMUnavailable("The planner declined this brief.")
    raw = result.text.strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
    return json.loads(raw)


# --- Offline fallback --------------------------------------------------------
def _mock(prompt_name: str, variables: dict, rendered: str) -> LLMResult:
    """
    Deterministic stand-ins so the product works without an API key. These
    never pretend to be good writing; they keep the flow unblocked.
    """
    if prompt_name == "script_helper":
        brief = str(variables.get("brief", "")).strip()
        words = int(variables.get("target_words", 120))
        base = (
            f"Here is the one thing you need to know about {brief[:80]}. "
            "Most people get this wrong because nobody explains it simply. "
            "Today I will show you the short version. "
            "First, start with the result you want. "
            "Second, remove every step that does not move you there. "
            "Third, do it today, not next week. "
            "If you want the full checklist, tap the link below."
        )
        out = base
        while len(out.split()) < words * 0.8:
            out += " " + base
        return LLMResult(text=" ".join(out.split()[:words]), model="mock")
    if prompt_name == "delivery":
        return LLMResult(text=str(variables.get("script", "")), model="mock")
    if prompt_name == "translate":
        return LLMResult(text=str(variables.get("script", "")), model="mock")
    if prompt_name == "summary":
        words = str(variables.get("transcript", "")).split()
        return LLMResult(text=" ".join(words[:22]) + ("..." if len(words) > 22 else ""), model="mock")
    if prompt_name == "planner":
        secs = int(variables.get("target_seconds", 60))
        plan = {
            "title": str(variables.get("brief", "Video"))[:60],
            "orientation": "9:16",
            "language": "en",
            "scenes": [
                {"name": "Hook", "start_s": 0, "end_s": 6, "type": "A", "visual": "Presenter close-up.",
                 "voiceover": "Here is the one mistake that costs you the most."},
                {"name": "Point", "start_s": 6, "end_s": secs - 8, "type": "A", "visual": "Presenter mid shot.",
                 "voiceover": "Let me explain the simple fix."},
                {"name": "Call to action", "start_s": secs - 8, "end_s": secs, "type": "A",
                 "visual": "Presenter smiling.", "voiceover": "Follow for the next one."},
            ],
        }
        return LLMResult(text=json.dumps(plan), model="mock")
    return LLMResult(text=rendered[:200], model="mock")
