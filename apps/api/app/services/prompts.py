"""
Prompt loader (hard rule 12 and PRD section 10).

Prompts live in /prompts/<name>.v<N>.md. Code may fill the {{variables}} and
nothing else. This module is the only way to read a prompt; it refuses to
render if a variable is missing, so a typo is caught before an LLM call.
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

from app.config import settings

_VAR = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


class PromptError(RuntimeError):
    pass


@lru_cache(maxsize=64)
def _read(name: str, version: int) -> str:
    path: Path = settings.prompts_dir / f"{name}.v{version}.md"
    if not path.exists():
        raise PromptError(f"Prompt file not found: {path}")
    return path.read_text(encoding="utf-8").strip()


def variables_of(name: str, version: int = 1) -> set[str]:
    return set(_VAR.findall(_read(name, version)))


def render(name: str, variables: dict[str, object], version: int = 1) -> str:
    """Return the prompt text with every {{var}} filled. Raises on missing vars."""
    text = _read(name, version)
    needed = set(_VAR.findall(text))
    missing = needed - set(variables)
    if missing:
        raise PromptError(f"Prompt {name}.v{version} is missing variables: {sorted(missing)}")

    def sub(match: re.Match) -> str:
        return str(variables[match.group(1)])

    return _VAR.sub(sub, text)


def parse_motion_table(version: int = 1) -> dict[str, dict[str, str]]:
    """
    P2 (motion.v1.md) is a template, not an LLM prompt. The file holds the
    phrase lookup tables inline so a prompt reviewer sees everything in one
    place. This parses lines like:  expression: calm="..." confident="..."
    """
    text = _read("motion", version)
    tables: dict[str, dict[str, str]] = {}
    for line in text.splitlines():
        m = re.match(r"^(expression|gesture|gaze):\s*(.*)$", line.strip())
        if not m:
            continue
        key, rest = m.group(1), m.group(2)
        tables[key] = dict(re.findall(r'([a-z_]+)="([^"]*)"', rest))
    return tables


def build_motion_prompt(expression: str, gesture: str, gaze: str, version: int = 1) -> str:
    """Fill the first line of P2 with the chosen chip phrases."""
    tables = parse_motion_table(version)
    exp = tables.get("expression", {}).get(expression, tables.get("expression", {}).get("calm", ""))
    ges = tables.get("gesture", {}).get(gesture, "")
    gz = tables.get("gaze", {}).get(gaze, tables.get("gaze", {}).get("camera", ""))
    first_line = _read("motion", version).splitlines()[0]
    out = (
        first_line.replace("{{expression_phrase}}", exp)
        .replace("{{gesture_phrase}}", ges)
        .replace("{{gaze_phrase}}", gz)
    )
    # Tidy the punctuation when a gesture is empty: "a, , b" -> "a, b".
    out = re.sub(r",\s*,", ",", out)
    out = re.sub(r",\s*;", ";", out)
    return out.strip()
