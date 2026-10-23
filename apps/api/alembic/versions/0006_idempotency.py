"""idempotency key on videos

Revision ID: 0006
Revises: 0005
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("videos") as batch:
        batch.add_column(sa.Column("idempotency_key", sa.String(120)))
        batch.create_index("ix_videos_idempotency_key", ["idempotency_key"])


def downgrade() -> None:
    with op.batch_alter_table("videos") as batch:
        batch.drop_index("ix_videos_idempotency_key")
        batch.drop_column("idempotency_key")
