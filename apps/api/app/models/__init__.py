"""Import every model so Base.metadata knows all tables."""
from app.models.avatars import Identity, Look
from app.models.billing import Payment, Subscription
from app.models.core import Membership, User, Workspace
from app.models.credits import CreditEntry
from app.models.platform import EngineTrial, PlatformSetting
from app.models.team import ApiKey, Invite, Webhook, WebhookDelivery
from app.models.videos import Job, Project, Reaction, Video
from app.models.voices import Voice

__all__ = [
    "User",
    "Workspace",
    "Membership",
    "Identity",
    "Look",
    "Voice",
    "Project",
    "Video",
    "Job",
    "Reaction",
    "CreditEntry",
    "PlatformSetting",
    "EngineTrial",
    "Subscription",
    "Payment",
    "Invite",
    "ApiKey",
    "Webhook",
    "WebhookDelivery",
]
