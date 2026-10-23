"""v3 features: notification prefs, clip/translation links

Revision ID: 0007
Revises: 0006
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("phone", sa.String(20)))
        batch.add_column(sa.Column("notify_whatsapp", sa.Boolean(), nullable=False, server_default=sa.false()))
    with op.batch_alter_table("videos") as batch:
        batch.add_column(sa.Column("source_video_id", sa.String(32)))
        batch.add_column(sa.Column("kind", sa.String(20), nullable=False, server_default="video"))
        batch.create_index("ix_videos_source_video_id", ["source_video_id"])


def downgrade() -> None:
    with op.batch_alter_table("videos") as batch:
        batch.drop_index("ix_videos_source_video_id")
        batch.drop_column("kind")
        batch.drop_column("source_video_id")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("notify_whatsapp")
        batch.drop_column("phone")
