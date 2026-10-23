"""v3: subscriptions, payments, invites, api keys, webhooks, per-avatar access

Revision ID: 0005
Revises: 0004
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def _ts(name, nullable=True):
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def _base(extra):
    return [sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("workspace_id", sa.String(32), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            *extra, _ts("created_at", False), _ts("updated_at", False)]


def upgrade() -> None:
    op.create_table("subscriptions", *_base([
        sa.Column("provider", sa.String(20), nullable=False), sa.Column("provider_subscription_id", sa.String(120)),
        sa.Column("provider_customer_id", sa.String(120)), sa.Column("plan", sa.String(20), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False), sa.Column("yearly", sa.Boolean(), nullable=False),
        sa.Column("seats", sa.Integer(), nullable=False), sa.Column("status", sa.String(20), nullable=False),
        _ts("current_period_start"), _ts("current_period_end"), sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False),
        _ts("last_granted_period_start"), sa.Column("meta", sa.JSON(), nullable=False)]))
    op.create_index("ix_subscriptions_workspace_id", "subscriptions", ["workspace_id"])
    op.create_index("ix_subscriptions_provider_subscription_id", "subscriptions", ["provider_subscription_id"])
    op.create_table("payments", *_base([
        sa.Column("provider", sa.String(20), nullable=False), sa.Column("provider_order_id", sa.String(120)),
        sa.Column("provider_payment_id", sa.String(120)), sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("plan", sa.String(20)), sa.Column("amount", sa.Integer(), nullable=False), sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("net_amount", sa.Integer(), nullable=False), sa.Column("tax_amount", sa.Integer(), nullable=False),
        sa.Column("credits", sa.Integer(), nullable=False), sa.Column("status", sa.String(20), nullable=False),
        sa.Column("invoice_number", sa.String(30), unique=True), _ts("paid_at"), sa.Column("description", sa.String(200), nullable=False),
        sa.Column("buyer", sa.JSON(), nullable=False), sa.Column("raw", sa.JSON(), nullable=False), sa.Column("error", sa.Text())]),
        sa.UniqueConstraint("provider", "provider_payment_id", name="uq_payment_provider_id"))
    op.create_index("ix_payments_workspace_id", "payments", ["workspace_id"])
    op.create_index("ix_payments_provider_order_id", "payments", ["provider_order_id"])
    op.create_table("invites", *_base([
        sa.Column("email", sa.String(320), nullable=False), sa.Column("role", sa.String(20), nullable=False),
        sa.Column("token", sa.String(64), nullable=False, unique=True), sa.Column("invited_by", sa.String(32)),
        _ts("expires_at", False), _ts("accepted_at"), sa.Column("accepted_by", sa.String(32))]))
    op.create_index("ix_invites_workspace_id", "invites", ["workspace_id"])
    op.create_index("ix_invites_email", "invites", ["email"])
    op.create_table("api_keys", *_base([
        sa.Column("name", sa.String(120), nullable=False), sa.Column("prefix", sa.String(12), nullable=False),
        sa.Column("key_hash", sa.String(64), nullable=False, unique=True), sa.Column("scopes", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.String(32)), _ts("last_used_at"), _ts("revoked_at")]))
    op.create_index("ix_api_keys_workspace_id", "api_keys", ["workspace_id"])
    op.create_index("ix_api_keys_prefix", "api_keys", ["prefix"])
    op.create_table("webhooks", *_base([
        sa.Column("url", sa.String(1000), nullable=False), sa.Column("secret", sa.String(64), nullable=False),
        sa.Column("events", sa.JSON(), nullable=False), sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("description", sa.String(200), nullable=False)]))
    op.create_index("ix_webhooks_workspace_id", "webhooks", ["workspace_id"])
    op.create_table("webhook_deliveries", *_base([
        sa.Column("webhook_id", sa.String(32), nullable=False), sa.Column("event", sa.String(40), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False), sa.Column("status", sa.String(20), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False), _ts("next_attempt_at"), sa.Column("last_status_code", sa.Integer()),
        sa.Column("last_error", sa.Text()), _ts("delivered_at")]))
    op.create_index("ix_webhook_deliveries_workspace_id", "webhook_deliveries", ["workspace_id"])
    op.create_index("ix_webhook_deliveries_webhook_id", "webhook_deliveries", ["webhook_id"])
    with op.batch_alter_table("identities") as batch:
        batch.add_column(sa.Column("allowed_user_ids", sa.JSON(), nullable=False, server_default="[]"))


def downgrade() -> None:
    with op.batch_alter_table("identities") as batch:
        batch.drop_column("allowed_user_ids")
    for t in ("webhook_deliveries", "webhooks", "api_keys", "invites", "payments", "subscriptions"):
        op.drop_table(t)
