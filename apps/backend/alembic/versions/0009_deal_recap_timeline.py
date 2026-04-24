"""Deal recap generations and timeline events.

Revision ID: 0009_deal_recap_timeline
Revises: 0008_deal_custom_numbers
Create Date: 2026-04-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "0009_deal_recap_timeline"
down_revision: Union[str, None] = "0008_deal_custom_numbers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = inspect(connection)
    tables = inspector.get_table_names()
    if "deal_recap_generations" not in tables:
        op.create_table(
            "deal_recap_generations",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("session_id", sa.String(), nullable=False),
            sa.Column("deal_id", sa.String(), nullable=True),
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column("usage", sa.JSON(), nullable=True),
            sa.Column("model", sa.String(), nullable=True),
            sa.Column(
                "status", sa.String(), nullable=False, server_default="succeeded"
            ),
            sa.ForeignKeyConstraint(["session_id"], ["chat_sessions.id"]),
            sa.ForeignKeyConstraint(["deal_id"], ["deals.id"]),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_deal_recap_generations_session_id",
            "deal_recap_generations",
            ["session_id"],
        )
        op.create_index(
            "ix_deal_recap_generations_created_at",
            "deal_recap_generations",
            ["created_at"],
        )

    if "deal_timeline_events" not in tables:
        op.create_table(
            "deal_timeline_events",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("session_id", sa.String(), nullable=False),
            sa.Column("deal_id", sa.String(), nullable=True),
            sa.Column("recap_generation_id", sa.String(), nullable=True),
            sa.Column("user_message_id", sa.String(), nullable=True),
            sa.Column("assistant_message_id", sa.String(), nullable=True),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column(
                "payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'")
            ),
            sa.Column("source", sa.String(), nullable=False),
            sa.Column("supersedes_event_id", sa.String(), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("idempotency_key", sa.String(), nullable=True),
            sa.ForeignKeyConstraint(["session_id"], ["chat_sessions.id"]),
            sa.ForeignKeyConstraint(["deal_id"], ["deals.id"]),
            sa.ForeignKeyConstraint(
                ["recap_generation_id"],
                ["deal_recap_generations.id"],
            ),
            sa.ForeignKeyConstraint(["user_message_id"], ["messages.id"]),
            sa.ForeignKeyConstraint(["assistant_message_id"], ["messages.id"]),
            sa.ForeignKeyConstraint(
                ["supersedes_event_id"], ["deal_timeline_events.id"]
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_deal_timeline_events_session_id",
            "deal_timeline_events",
            ["session_id"],
        )
        op.create_index(
            "ix_deal_timeline_events_recap_generation_id",
            "deal_timeline_events",
            ["recap_generation_id"],
        )
        op.create_index(
            "ix_deal_timeline_events_occurred_at",
            "deal_timeline_events",
            ["occurred_at"],
        )
        # SQLite: partial unique index for tool-hint idempotency
        op.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_deal_timeline_session_idempotency
            ON deal_timeline_events (session_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
            """
        )


def downgrade() -> None:
    connection = op.get_bind()
    inspector = inspect(connection)
    tables = inspector.get_table_names()
    if "deal_timeline_events" in tables:
        op.execute("DROP INDEX IF EXISTS ux_deal_timeline_session_idempotency")
        op.drop_table("deal_timeline_events")
    if "deal_recap_generations" in tables:
        op.drop_table("deal_recap_generations")
