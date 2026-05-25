"""Shared validation constants, regex patterns, and literal types.

Single source of truth for input limits used across routers. The frontend
should mirror these where it enforces client-side limits.
"""

from typing import Literal
from pydantic import BaseModel, Field

# ── Regex patterns ────────────────────────────────────────────────────────
USERNAME_PATTERN = r"^[a-zA-Z0-9_]+$"
HEX_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"

# ── String length limits ─────────────────────────────────────────────────
USERNAME_MIN_LEN = 3
USERNAME_MAX_LEN = 30
DISPLAY_NAME_MAX_LEN = 50
BIO_MAX_LEN = 300

REVIEW_TEXT_MAX_LEN = 2000
APPEAL_MAX_LEN = 2000

SHELF_NAME_MAX_LEN = 80
SHELF_DESC_MAX_LEN = 500

COMMUNITY_NAME_MIN_LEN = 2
COMMUNITY_NAME_MAX_LEN = 50
COMMUNITY_DESC_MAX_LEN = 500
COMMUNITY_POST_TITLE_MAX_LEN = 200
COMMUNITY_POST_BODY_MAX_LEN = 10_000
COMMUNITY_REPLY_BODY_MAX_LEN = 5_000

FEEDBACK_SUBJECT_MAX_LEN = 200
FEEDBACK_DESC_MAX_LEN = 5_000
FEEDBACK_ADMIN_NOTES_MAX_LEN = 5_000

RECOMMENDATION_MSG_MAX_LEN = 500
RECOMMENDATION_TITLE_MAX_LEN = 500

FRIEND_REQUEST_MSG_MAX_LEN = 200
REPORT_MESSAGE_MAX_LEN = 1000

POSTER_PATH_MAX_LEN = 500
ISO_DATE_PATTERN = r"^\d{4}-\d{2}-\d{2}$"

# ── Literal types ────────────────────────────────────────────────────────
ContentType = Literal["movie", "tv"]
Visibility = Literal["public", "private"]
CommunityRole = Literal["owner", "admin", "member"]
FeedbackCategory = Literal["bug", "feature", "general"]
FeedbackStatus = Literal["open", "reviewed", "closed"]
AvatarKey = Literal[
    "blue", "purple", "green", "red", "orange", "teal", "pink", "yellow"
]
ReportReason = Literal[
    "spam", "harassment", "hate_speech", "inappropriate_content", "misinformation", "other"
]
ReportTargetType = Literal[
    "review", "user", "community", "community_post", "community_reply"
]


# ── Shared request body shapes ───────────────────────────────────────────
class ContentRef(BaseModel):
    """Body model for any endpoint that references a piece of content."""
    content_type: ContentType
    content_id: int = Field(..., ge=1)
