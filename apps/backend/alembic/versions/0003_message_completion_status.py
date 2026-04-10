"""Add interruption/completion metadata columns to messages.

Revision ID: 0003_message_completion_status
Revises: 0002_message_panel_cards
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "0003_message_completion_status"
down_revision: Union[str, None] = "0002_message_panel_cards"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = inspect(conn)
    if not insp.has_table("messages"):
        return
    cols = {c["name"] for c in insp.get_columns("messages")}

    if "completion_status" not in cols:
        op.add_column(
            "messages",
            sa.Column(
                "completion_status",
                sa.String(),
                nullable=False,
                server_default="complete",
            ),
        )
    if "interrupted_at" not in cols:
        op.add_column(
            "messages", sa.Column("interrupted_at", sa.DateTime(), nullable=True)
        )
    if "interrupted_reason" not in cols:
        op.add_column(
            "messages", sa.Column("interrupted_reason", sa.String(), nullable=True)
        )


def downgrade() -> None:
    conn = op.get_bind()
    insp = inspect(conn)
    if not insp.has_table("messages"):
        return
    cols = {c["name"] for c in insp.get_columns("messages")}

    if "interrupted_reason" in cols:
        op.drop_column("messages", "interrupted_reason")
    if "interrupted_at" in cols:
        op.drop_column("messages", "interrupted_at")
    if "completion_status" in cols:
        op.drop_column("messages", "completion_status")
