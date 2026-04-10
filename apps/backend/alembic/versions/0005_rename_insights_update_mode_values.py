"""Rename insights update mode values to live/paused.

Revision ID: 0005_rename_insights_update_mode_values
Revises: 0004_user_settings
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "0005_rename_insights_update_mode_values"
down_revision: Union[str, None] = "0004_user_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = inspect(conn)
    if not insp.has_table("user_settings"):
        return

    op.execute(
        sa.text(
            """
            UPDATE user_settings
            SET insights_update_mode = CASE insights_update_mode
                WHEN 'auto' THEN 'live'
                WHEN 'manual' THEN 'paused'
                ELSE insights_update_mode
            END
            """
        )
    )
    with op.batch_alter_table("user_settings") as batch_op:
        batch_op.alter_column(
            "insights_update_mode",
            existing_type=sa.String(),
            server_default="live",
        )


def downgrade() -> None:
    conn = op.get_bind()
    insp = inspect(conn)
    if not insp.has_table("user_settings"):
        return

    op.execute(
        sa.text(
            """
            UPDATE user_settings
            SET insights_update_mode = CASE insights_update_mode
                WHEN 'live' THEN 'auto'
                WHEN 'paused' THEN 'manual'
                ELSE insights_update_mode
            END
            """
        )
    )
    with op.batch_alter_table("user_settings") as batch_op:
        batch_op.alter_column(
            "insights_update_mode",
            existing_type=sa.String(),
            server_default="auto",
        )
