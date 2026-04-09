"""Add messages.panel_cards JSON column when missing.

Revision ID: 0002_message_panel_cards
Revises: 0001_initial
Create Date: 2026-04-09

Idempotent: skips if the column already exists (e.g. SQLite dev DBs created via metadata.create_all).

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "0002_message_panel_cards"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = inspect(conn)
    if not insp.has_table("messages"):
        return
    cols = {c["name"] for c in insp.get_columns("messages")}
    if "panel_cards" in cols:
        return
    op.add_column("messages", sa.Column("panel_cards", sa.JSON(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    insp = inspect(conn)
    if not insp.has_table("messages"):
        return
    cols = {c["name"] for c in insp.get_columns("messages")}
    if "panel_cards" not in cols:
        return
    op.drop_column("messages", "panel_cards")
