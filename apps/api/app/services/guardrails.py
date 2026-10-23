"""
Script guardrails (PRD section 10, closing paragraph).

Scripts are checked for banned claims before a render is queued:
  - medical cures
  - guaranteed income
  - impersonation of a named real person other than the avatar owner

A hit blocks the render and tells the user why in plain words. The lists are
deliberately short and readable; add to them in a pull request with examples.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

MEDICAL_CURE = [
    r"\bcures?\b.{0,40}\b(cancer|diabetes|hiv|aids|covid|alzheimer|arthritis|depression|anxiety|autism)\b",
    r"\b(cancer|diabetes|hiv|aids|covid|alzheimer|arthritis)\b.{0,40}\b(cure|cured|reverses?|heal(s|ed)?)\b",
    r"\bmiracle (cure|treatment|drug|remedy)\b",
    r"\b(permanent(ly)?|100 ?%|guaranteed) (cure|heal|reverse)",
    r"\bno side effects\b.{0,30}\b(cure|treat)",
]

GUARANTEED_INCOME = [
    r"\bguaranteed? (income|profit|returns?|earnings|money)\b",
    r"\b(earn|make|get) .{0,20}(guaranteed|risk[- ]free|without fail)\b",
    r"\b(double|triple) your money\b.{0,20}\b(guaranteed|in \d+ days)\b",
    r"\b100 ?% (returns?|profit|success rate)\b",
    r"\bcan'?t lose\b",
    r"\bget rich quick\b",
]

# Well-known public figures. Impersonation is only flagged when the script
# speaks AS one of them in first person ("I am ...", "this is ... speaking").
PUBLIC_FIGURES = [
    "narendra modi", "rahul gandhi", "amitabh bachchan", "shah rukh khan", "virat kohli",
    "mukesh ambani", "ratan tata", "elon musk", "donald trump", "joe biden", "barack obama",
    "bill gates", "mark zuckerberg", "sundar pichai", "taylor swift", "oprah winfrey",
    "mrbeast", "sam altman", "jeff bezos", "warren buffett", "cristiano ronaldo", "lionel messi",
]

_FIRST_PERSON = [
    r"\b(i am|i'm|this is|it's me|its me|main hoon|mai hu|main hu)\s+{name}\b",
    r"\b{name}\s+(here|speaking|bol raha hoon|bol rahi hoon)\b",
]


@dataclass
class GuardrailHit:
    category: str
    excerpt: str
    message: str


def check_script(script: str, owner_name: str | None = None) -> list[GuardrailHit]:
    text = " ".join(script.split())
    low = text.lower()
    hits: list[GuardrailHit] = []

    def excerpt(m: re.Match) -> str:
        start = max(0, m.start() - 30)
        end = min(len(text), m.end() + 30)
        return text[start:end].strip()

    for pat in MEDICAL_CURE:
        m = re.search(pat, low)
        if m:
            hits.append(GuardrailHit(
                "medical_claim", excerpt(m),
                "This script promises a medical cure. Change it to describe benefits without claiming a cure.",
            ))
            break

    for pat in GUARANTEED_INCOME:
        m = re.search(pat, low)
        if m:
            hits.append(GuardrailHit(
                "income_claim", excerpt(m),
                "This script guarantees income or returns. Remove the guarantee or say results vary.",
            ))
            break

    owner = (owner_name or "").strip().lower()
    for name in PUBLIC_FIGURES:
        if owner and name == owner:
            continue
        for tmpl in _FIRST_PERSON:
            m = re.search(tmpl.format(name=re.escape(name)), low)
            if m:
                hits.append(GuardrailHit(
                    "impersonation", excerpt(m),
                    f"This script speaks as {name.title()}. An avatar can only speak as its owner.",
                ))
                break
        if any(h.category == "impersonation" for h in hits):
            break

    return hits
