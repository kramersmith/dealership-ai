"""Add custom_numbers JSON column to deals for free-form LLM-chosen number rows.

Revision ID: 0008_deal_custom_numbers
Revises: 0007_add_insights_followup_jobs
Create Date: 2026-04-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "0008_deal_custom_numbers"
down_revision: Union[str, None] = "0007_add_insights_followup_jobs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = inspect(connection)
    existing = {col["name"] for col in inspector.get_columns("deals")}
    if "custom_numbers" in existing:
        return
    op.add_column(
        "deals",
        sa.Column(
            "custom_numbers",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )


def downgrade() -> None:
    connection = op.get_bind()
    inspector = inspect(connection)
    existing = {col["name"] for col in inspector.get_columns("deals")}
    if "custom_numbers" not in existing:
        return
    op.drop_column("deals", "custom_numbers")
