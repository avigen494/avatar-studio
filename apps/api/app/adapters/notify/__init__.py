"""
Notifications when a long task finishes (PRD section 5: "push/WhatsApp
notification when done (v3)").

  WhatsAppCloud  Meta WhatsApp Cloud API, one approved template per event
  MockNotifier   logs the message (dev and tests)

Per-user opt-in: User.phone (E.164) + User.notify_whatsapp. Messages are
plain English and never contain the script.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod

import httpx

from app.services.runtime_config import cfg

log = logging.getLogger("notify")


class Notifier(ABC):
    name = "base"

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    def send(self, phone: str, template: str, variables: list[str], link: str | None = None) -> bool: ...


class WhatsAppCloud(Notifier):
    """Templates must exist in the WhatsApp Business account with these names and {{n}} slots."""

    name = "whatsapp"
    TEMPLATES = {
        "video_ready": "avatar_video_ready",      # {{1}} = title, button url = video page
        "video_failed": "avatar_video_failed",    # {{1}} = title, {{2}} = reason
        "style_ready": "avatar_style_ready",      # {{1}} = avatar name
    }

    def available(self) -> bool:
        return bool(cfg("whatsapp_token") and cfg("whatsapp_phone_number_id"))

    def send(self, phone: str, template: str, variables: list[str], link: str | None = None) -> bool:
        name = self.TEMPLATES.get(template, template)
        components: list[dict] = []
        if variables:
            components.append({"type": "body", "parameters": [{"type": "text", "text": v[:200]} for v in variables]})
        if link:
            components.append({"type": "button", "sub_type": "url", "index": "0", "parameters": [{"type": "text", "text": link}]})
        payload = {"messaging_product": "whatsapp", "to": phone.lstrip("+"), "type": "template",
                   "template": {"name": name, "language": {"code": cfg("whatsapp_template_language") or "en"}, "components": components}}
        with httpx.Client(timeout=20) as client:
            r = client.post(f"https://graph.facebook.com/v21.0/{cfg('whatsapp_phone_number_id')}/messages",
                            headers={"Authorization": f"Bearer {cfg('whatsapp_token')}"}, json=payload)
        if r.status_code >= 400:
            log.warning("WhatsApp send failed %s: %s", r.status_code, r.text[:300])
            return False
        return True


class MockNotifier(Notifier):
    name = "mock"
    sent: list[dict] = []

    def available(self) -> bool:
        return True

    def send(self, phone: str, template: str, variables: list[str], link: str | None = None) -> bool:
        MockNotifier.sent.append({"phone": phone, "template": template, "variables": variables, "link": link})
        log.info("notify(mock) %s %s %s %s", phone, template, variables, link)
        return True


def get_notifier() -> Notifier:
    wa = WhatsAppCloud()
    return wa if wa.available() else MockNotifier()


def notify_user(db, user_id: str | None, template: str, variables: list[str], link: str | None = None) -> bool:
    """Send if the user opted in. Sync (worker)."""
    from app.models.core import User

    if not user_id:
        return False
    user = db.get(User, user_id)
    if not user or not user.phone or not user.notify_whatsapp:
        return False
    try:
        return get_notifier().send(user.phone, template, variables, link)
    except Exception as e:  # noqa: BLE001  notifications never break a job
        log.warning("notify failed: %s", e)
        return False
