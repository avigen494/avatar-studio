"""platform settings (Connections) and engine trials (Engine Lab)

Revision ID: 0003
Revises: 0002
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_settings",
        sa.Column("key", sa.String(80), primary_key=True),
        sa.Column("value_encrypted", sa.Text(), nullable=False),
        sa.Column("is_secret", sa.Boolean(), nullable=False),
        sa.Column("updated_by", sa.String(32)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_test_ok", sa.Boolean()),
        sa.Column("last_test_message", sa.String(500)),
        sa.Column("last_tested_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "engine_trials",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("workspace_id", sa.String(32), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("engine", sa.String(40), nullable=False),
        sa.Column("gpu", sa.String(40), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("script", sa.Text(), nullable=False),
        sa.Column("voice_id", sa.String(32)),
        sa.Column("look_key", sa.String(500)),
        sa.Column("reference_key", sa.String(500)),
        sa.Column("aspect", sa.String(10), nullable=False),
        sa.Column("steps", sa.Integer(), nullable=False),
        sa.Column("output_key", sa.String(500)),
        sa.Column("thumbnail_key", sa.String(500)),
        sa.Column("duration_s", sa.Float()),
        sa.Column("wall_seconds", sa.Float()),
        sa.Column("gpu_seconds", sa.Float()),
        sa.Column("cost_inr", sa.Float()),
        sa.Column("vram_gb", sa.Float()),
        sa.Column("error", sa.Text()),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("is_benchmark", sa.Boolean(), nullable=False),
        sa.Column("scores", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_engine_trials_workspace_id", "engine_trials", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("ix_engine_trials_workspace_id", table_name="engine_trials")
    op.drop_table("engine_trials")
    op.drop_table("platform_settings")
