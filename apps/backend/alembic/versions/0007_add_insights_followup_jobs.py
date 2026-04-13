"""Add persisted insights follow-up jobs.

Revision ID: 0007_add_insights_followup_jobs
Revises: 0006_drop_desktop_insights_collapsed
Create Date: 2026-04-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "0007_add_insights_followup_jobs"
down_revision: Union[str, None] = "0006_drop_desktop_insights_collapsed"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = inspect(connection)
    if inspector.has_table("insights_followup_jobs"):
        return

    op.create_table(
        "insights_followup_jobs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("assistant_message_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("reconcile_status", sa.String(), nullable=False),
        sa.Column("panel_status", sa.String(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("cancel_reason", sa.String(), nullable=True),
        sa.Column("usage", sa.JSON(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["assistant_message_id"], ["messages.id"]),
        sa.ForeignKeyConstraint(["session_id"], ["chat_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "session_id",
            "assistant_message_id",
            "kind",
            name="uq_insights_followup_jobs_identity",
        ),
    )
    op.create_index(
        op.f("ix_insights_followup_jobs_session_id"),
        "insights_followup_jobs",
        ["session_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_insights_followup_jobs_assistant_message_id"),
        "insights_followup_jobs",
        ["assistant_message_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_insights_followup_jobs_status"),
        "insights_followup_jobs",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    connection = op.get_bind()
    inspector = inspect(connection)
    if not inspector.has_table("insights_followup_jobs"):
        return

    op.drop_index(
        op.f("ix_insights_followup_jobs_status"), table_name="insights_followup_jobs"
    )
    op.drop_index(
        op.f("ix_insights_followup_jobs_assistant_message_id"),
        table_name="insights_followup_jobs",
    )
    op.drop_index(
        op.f("ix_insights_followup_jobs_session_id"),
        table_name="insights_followup_jobs",
    )
    op.drop_table("insights_followup_jobs")
