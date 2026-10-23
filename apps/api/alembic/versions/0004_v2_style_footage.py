"""v2: style training fields and footage on identities

Revision ID: 0004
Revises: 0003
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("identities") as batch:
        batch.add_column(sa.Column("style_trained_at", sa.DateTime(timezone=True)))
        batch.add_column(sa.Column("style_footage_seconds", sa.Float()))
        batch.add_column(sa.Column("style_error", sa.String(500)))
        batch.add_column(sa.Column("footage_keys", sa.JSON(), nullable=False, server_default="[]"))


def downgrade() -> None:
    with op.batch_alter_table("identities") as batch:
        batch.drop_column("footage_keys")
        batch.drop_column("style_error")
        batch.drop_column("style_footage_seconds")
        batch.drop_column("style_trained_at")
