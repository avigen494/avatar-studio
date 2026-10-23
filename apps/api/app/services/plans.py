"""
Plans and prices (PRD section 9). One place for every number.

Amounts are in the smallest unit: paise for INR, cents for USD.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Plan:
    id: str
    name: str
    inr_month: int            # paise
    inr_year_month: int | None  # paise per month when billed yearly (Creator only)
    usd_month: int            # cents
    credits_month: int
    max_avatars: int
    max_members: int
    watermark: bool
    max_quality: str
    includes: tuple[str, ...]
    rollover_months: int | None  # None = never expire
    seat_inr_month: int = 0   # extra seat, paise
    seat_usd_month: int = 0
    features: dict = field(default_factory=dict)


PLANS: dict[str, Plan] = {
    "free": Plan("free", "Free", 0, None, 0, 30, 1, 1, True, "720p",
                 ("Watermark", "720p", "15-second previews", "AI-assisted label on"), None),
    "creator": Plan("creator", "Creator", 99_900, 79_900, 1_200, 600, 2, 1, False, "1080p",
                    ("No watermark", "1080p", "Hinglish voices", "Rollover 1 month", "30-minute videos"), 1),
    "pro": Plan("pro", "Pro", 249_900, None, 2_900, 2_000, 5, 3, False, "4k",
                ("4K", "Style training included once", "API access", "Priority queue"), None),
    "team": Plan("team", "Team", 599_900, None, 6_900, 6_000, 15, 15, False, "4k",
                 ("Members and roles", "Brand kits", "Batch", "Webhooks", "15 seats included"), None,
                 seat_inr_month=49_900, seat_usd_month=600),
}

TOPUP = {"credits": 100, "inr": 19_900, "usd": 300}  # 100 credits for ₹199 / $3, paid plans only
GST_RATE = 0.18

PAID_RANK = {"free": 0, "creator": 1, "pro": 2, "team": 3}


def plan_for(plan_id: str) -> Plan:
    return PLANS.get(plan_id, PLANS["free"])


def price(plan_id: str, currency: str, yearly: bool = False) -> int:
    p = plan_for(plan_id)
    if currency == "USD":
        return p.usd_month
    return (p.inr_year_month or p.inr_month) if yearly else p.inr_month


def gst_split(gross_paise: int) -> tuple[int, int]:
    """Prices are GST-inclusive for consumers in India: (net, gst)."""
    net = round(gross_paise / (1 + GST_RATE))
    return net, gross_paise - net


def apply_plan_to_workspace(ws, plan_id: str) -> None:
    p = plan_for(plan_id)
    ws.plan = p.id
    ws.max_avatars = p.max_avatars
    ws.watermark_enabled = p.watermark
    if p.id != "free" and ws.settings.get("ai_label_user_choice") is not None:
        ws.ai_label_enabled = bool(ws.settings["ai_label_user_choice"])


def public_plans() -> list[dict]:
    out = []
    for p in PLANS.values():
        out.append({
            "id": p.id, "name": p.name,
            "inr_month": p.inr_month, "inr_year_month": p.inr_year_month, "usd_month": p.usd_month,
            "credits_month": p.credits_month, "minutes_estimate": f"{p.credits_month // 10}–{p.credits_month // 6}",
            "max_avatars": p.max_avatars, "max_members": p.max_members, "watermark": p.watermark,
            "max_quality": p.max_quality, "includes": list(p.includes), "rollover_months": p.rollover_months,
            "seat_inr_month": p.seat_inr_month, "seat_usd_month": p.seat_usd_month,
        })
    return out
