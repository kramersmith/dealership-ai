"""Drop desktop panel collapse preference from backend settings.

Revision ID: 0006_drop_desktop_insights_collapsed
Revises: 0005_rename_insights_update_mode_values
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "0006_drop_desktop_insights_collapsed"
down_revision: Union[str, None] = "0005_rename_insights_update_mode_values"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = inspect(conn)
    if not insp.has_table("user_settings"):
        return

    columns = {column["name"] for column in insp.get_columns("user_settings")}
    if "desktop_insights_collapsed" not in columns:
        return

    with op.batch_alter_table("user_settings") as batch_op:
        batch_op.drop_column("desktop_insights_collapsed")


def downgrade() -> None:
    conn = op.get_bind()
    insp = inspect(conn)
    if not insp.has_table("user_settings"):
        return

    columns = {column["name"] for column in insp.get_columns("user_settings")}
    if "desktop_insights_collapsed" in columns:
        return

    with op.batch_alter_table("user_settings") as batch_op:
        batch_op.add_column(
            sa.Column(
                "desktop_insights_collapsed",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
