"""quality gate, seeds, golden regression set

Revision ID: 0008
Revises: 0007
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("identities") as batch:
        batch.add_column(sa.Column("render_seed", sa.Integer(), nullable=False, server_default="20261016"))
    with op.batch_alter_table("videos") as batch:
        batch.add_column(sa.Column("quality_score", sa.Float()))
        batch.add_column(sa.Column("quality_method", sa.String(30)))
        batch.add_column(sa.Column("render_seed", sa.Integer()))
        batch.add_column(sa.Column("render_attempts", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("engine_version", sa.String(80)))
    with op.batch_alter_table("engine_trials") as batch:
        batch.add_column(sa.Column("is_golden", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("golden_of", sa.String(32)))
        batch.add_column(sa.Column("quality_score", sa.Float()))
        batch.add_column(sa.Column("quality_method", sa.String(30)))
        batch.add_column(sa.Column("seed", sa.Integer()))
        batch.add_column(sa.Column("engine_version", sa.String(80)))
        batch.create_index("ix_engine_trials_golden_of", ["golden_of"])


def downgrade() -> None:
    with op.batch_alter_table("engine_trials") as batch:
        batch.drop_index("ix_engine_trials_golden_of")
        for c in ("engine_version", "seed", "quality_method", "quality_score", "golden_of", "is_golden"):
            batch.drop_column(c)
    with op.batch_alter_table("videos") as batch:
        for c in ("engine_version", "render_attempts", "render_seed", "quality_method", "quality_score"):
            batch.drop_column(c)
    with op.batch_alter_table("identities") as batch:
        batch.drop_column("render_seed")
