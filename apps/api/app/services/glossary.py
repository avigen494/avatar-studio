"""
Brand glossary: term → pronunciation, applied to the text that is SPOKEN.
Captions and transcripts keep the original spelling.

Workspace.glossary is a list like [{"term": "IYA", "pronunciation": "eye why ay"}].
Longest terms are replaced first so "Avatar Studio" wins over "Avatar".
"""
from __future__ import annotations

import re


def apply(text: str, glossary: list[dict] | None) -> str:
    if not glossary:
        return text
    entries = [(str(g.get("term", "")).strip(), str(g.get("pronunciation", "")).strip()) for g in glossary]
    entries = [(t, p) for t, p in entries if t and p]
    for term, pron in sorted(entries, key=lambda e: -len(e[0])):
        pattern = re.compile(rf"(?<![\w]){re.escape(term)}(?![\w])", re.IGNORECASE)
        text = pattern.sub(pron, text)
    return text
