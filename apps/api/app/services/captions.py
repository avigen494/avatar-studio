"""
Caption timing.

v1 builds captions from the script and the measured audio length: each
sentence gets a share of the duration proportional to its word count. That
is accurate to within a second for TTS audio, which speaks evenly. A forced
aligner can replace `timings()` later without touching the callers.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?।])\s+")
_MAX_CHARS = 42  # one caption line on a 390 px phone


@dataclass
class Cue:
    index: int
    start: float
    end: float
    text: str


def _chunks(script: str) -> list[str]:
    """
    Split into caption-sized pieces. A long sentence is cut into roughly
    equal parts (not greedy fill) so no caption is left with one orphan word.
    """
    import math

    sentences = [s.strip() for s in _SENTENCE_SPLIT.split(script.strip()) if s.strip()]
    out: list[str] = []
    for s in sentences:
        words = s.split()
        if len(s) <= _MAX_CHARS or len(words) < 2:
            out.append(s)
            continue
        parts = math.ceil(len(s) / _MAX_CHARS)
        per = math.ceil(len(words) / parts)
        for i in range(0, len(words), per):
            out.append(" ".join(words[i:i + per]))
    return out


def timings(script: str, duration: float, lead_in: float = 0.2) -> list[Cue]:
    chunks = _chunks(script)
    total_words = sum(len(c.split()) for c in chunks) or 1
    usable = max(duration - lead_in, 0.5)
    cues: list[Cue] = []
    t = lead_in
    for i, c in enumerate(chunks, 1):
        share = len(c.split()) / total_words * usable
        start, end = t, t + share
        cues.append(Cue(i, round(start, 3), round(max(end - 0.05, start + 0.3), 3), c))
        t = end
    return cues


def _ts(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def to_srt(cues: list[Cue]) -> str:
    return "\n".join(f"{c.index}\n{_ts(c.start)} --> {_ts(c.end)}\n{c.text}\n" for c in cues)


def clip(cues: list[Cue], max_seconds: float) -> list[Cue]:
    out = []
    for c in cues:
        if c.start >= max_seconds:
            break
        out.append(Cue(c.index, c.start, min(c.end, max_seconds), c.text))
    return out
