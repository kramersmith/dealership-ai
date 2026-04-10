"""Create user_settings table for persisted user preferences.

Revision ID: 0004_user_settings
Revises: 0003_message_completion_status
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "0004_user_settings"
down_revision: Union[str, None] = "0003_message_completion_status"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = inspect(conn)
    if insp.has_table("user_settings"):
        return

    op.create_table(
        "user_settings",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column(
            "insights_update_mode", sa.String(), nullable=False, server_default="auto"
        ),
        sa.Column(
            "desktop_insights_collapsed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_user_settings_user_id", "user_settings", ["user_id"], unique=True
    )


def downgrade() -> None:
    conn = op.get_bind()
    insp = inspect(conn)
    if not insp.has_table("user_settings"):
        return

    indexes = {idx["name"] for idx in insp.get_indexes("user_settings")}
    if "ix_user_settings_user_id" in indexes:
        op.drop_index("ix_user_settings_user_id", table_name="user_settings")
    op.drop_table("user_settings")
