import hmac
import hashlib
from datetime import datetime
import resend
from collections import defaultdict
from app.config import settings

TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w185"


def _unsubscribe_url(uid: str) -> str:
    token = hmac.new(
        settings.UNSUBSCRIBE_SECRET.encode(),
        uid.encode(),
        hashlib.sha256,
    ).hexdigest()
    return f"{settings.FRONTEND_URL}/unsubscribe?uid={uid}&token={token}"


def _format_date(date_str: str) -> str:
    """Format ISO date string as 'Month Day, Year'."""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        # On Linux/macOS, %-d removes leading zero; on Windows use dt.day
        return f"{dt.strftime('%A, %B')} {dt.day}, {dt.year}"
    except Exception:
        return str(date_str)


_TZ_ABBR = {
    "America/New_York": "ET",
    "America/Chicago": "CT",
    "America/Denver": "MT",
    "America/Los_Angeles": "PT",
    "America/Phoenix": "MT",
    "Europe/London": "GMT",
    "Europe/Paris": "CET",
    "Europe/Berlin": "CET",
    "Australia/Sydney": "AEST",
    "Australia/Melbourne": "AEST",
    "Asia/Tokyo": "JST",
}


def format_air_time(air_time: str | None, air_timezone: str | None) -> str | None:
    if not air_time:
        return None
    try:
        hour, minute = map(int, air_time.split(":"))
        period = "PM" if hour >= 12 else "AM"
        h12 = hour % 12 or 12
        time_str = f"{h12}:{minute:02d} {period}" if minute else f"{h12} {period}"
        tz_abbr = _TZ_ABBR.get(air_timezone) if air_timezone else None
        return f"{time_str} {tz_abbr}" if tz_abbr else time_str
    except Exception:
        return None


# ── Shared HTML building blocks ───────────────────────────────────────────────


def _email_wrapper(body_html: str, uid: str) -> str:
    unsubscribe_url = _unsubscribe_url(uid)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:#1e3a8a;border-radius:12px 12px 0 0;padding:24px 32px;text-align:center;">
          <img src="{settings.FRONTEND_URL}/favicon-1024.png" width="48" height="48"
               style="border-radius:10px;margin-bottom:10px;display:block;margin-left:auto;margin-right:auto;" alt="Release Radar" />
          <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">Release Radar</span>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#1e293b;padding:28px 32px;">
          {body_html}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;">
          <p style="margin:0 0 10px;color:#64748b;font-size:12px;">
            You're receiving this because you have email notifications enabled on Release Radar.
          </p>
          <a href="{unsubscribe_url}"
             style="display:inline-block;padding:6px 16px;background:#334155;color:#94a3b8;
                    font-size:12px;text-decoration:none;border-radius:6px;border:1px solid #475569;">
            Unsubscribe
          </a>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _poster_img(poster_path: str | None, alt: str, content_url: str) -> str:
    if not poster_path:
        return ""
    src = f"{TMDB_IMAGE_BASE}{poster_path}"
    return (
        f'<a href="{content_url}" style="display:block;flex-shrink:0;">'
        f'<img src="{src}" alt="{alt}" width="56" height="84"'
        f' style="border-radius:6px;object-fit:cover;display:block;" /></a>'
    )


# ── Daily / weekly digest ─────────────────────────────────────────────────────


def _digest_item_row(item: dict) -> str:
    """Single card row for a digest item with proper spacing and badge."""
    content_type = item.get("content_type", "movie")
    content_id = item.get("content_id")
    content_url = (
        f"{settings.FRONTEND_URL}/{content_type}/{content_id}"
        if content_id
        else settings.FRONTEND_URL
    )

    # Poster with inline-block + right margin
    poster_path = item.get("poster_path")
    poster = (
        f'<a href="{content_url}" style="display:inline-block;flex-shrink:0;margin-right:12px;">'
        f'<img src="{TMDB_IMAGE_BASE}{poster_path}" alt="{item["title"]}" width="56" height="84"'
        f' style="border-radius:6px;object-fit:cover;display:block;" /></a>'
        if poster_path
        else ""
    )

    # Time badge
    time_text = item.get("air_time") or (
        "Theaters" if content_type == "movie" else "Streaming"
    )
    time_color = "#1e3a8a" if content_type == "movie" else "#1e3a5f"

    time_badge = (
        f'<span style="display:inline-block;background:{time_color};color:#93c5fd;'
        f"font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;"
        f'margin-left:6px;">{time_text}</span>'
    )

    special_badge = ""
    if content_type == "tv" and item.get("episode_type"):
        # Human-readable text, capitalize words and replace underscores
        ep_type_text = item["episode_type"].replace("_", " ").title()
        special_badge = (
            f'<span style="display:inline-block;background:#d97706;color:#fff;'
            f"font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;"
            f'margin-left:6px;">{ep_type_text}</span>'
        )

    # Flex layout with gap
    has_poster = bool(poster_path)
    layout_style = "display:flex;align-items:flex-start;gap:14px;" if has_poster else ""

    return f"""
<div style="{layout_style}background:#0f172a;border:1px solid #334155;
            border-radius:10px;padding:14px;margin-bottom:10px;">
  {poster}
  <div style="flex:1;min-width:0;">
    <a href="{content_url}" style="color:#f1f5f9;font-size:15px;font-weight:600;
       text-decoration:none;display:block;margin-bottom:3px;">{item["title"]}</a>
    <span style="color:#64748b;font-size:13px;">{_format_date(item["date"])}</span>
    {time_badge}{special_badge}
  </div>
</div>"""


def send_notification_email(
    to_email: str,
    username: str,
    upcoming_items: list,
    uid: str = "",
    frequency: str = "daily",
):
    if not upcoming_items:
        return

    # 🧠 Decide labels
    if frequency == "weekly":
        subject = "Release Radar — Your Weekly Digest"
        intro = "Here's everything releasing this week that's on your radar:"
        group_by_day = True
    elif frequency == "monthly":
        subject = "Release Radar — Your Monthly Digest"
        intro = "Here's everything releasing this month that's on your radar:"
        group_by_day = True
    else:
        count = len(upcoming_items)
        subject = (
            "Release Radar — Releasing Today"
            if count > 1
            else f"Release Radar — {upcoming_items[0]['title']} is out today"
        )
        today_str = _format_date(upcoming_items[0]["date"]) if upcoming_items else ""
        intro = f"Here's what's out today — {today_str} on your Release Radar:"
        group_by_day = False

    # 🧱 Build HTML
    if group_by_day:
        by_day: dict[str, list] = defaultdict(list)
        for item in upcoming_items:
            by_day[item["date"]].append(item)

        items_html = ""
        for day_date in sorted(by_day.keys()):
            items_html += f"""
<p style="margin:20px 0 8px;color:#93c5fd;font-size:13px;font-weight:700;
          text-transform:uppercase;letter-spacing:0.8px;">
  {_format_date(day_date)}
</p>"""
            for item in by_day[day_date]:
                items_html += _digest_item_row(item)
    else:
        items_html = "".join(_digest_item_row(item) for item in upcoming_items)

    # 📧 Email body
    body = f"""
<h2 style="margin:0 0 4px;color:#f1f5f9;font-size:20px;font-weight:700;">
  Hi {username or 'there'} 👋
</h2>
<p style="margin:0 0 20px;color:#94a3b8;font-size:14px;">
  {intro}
</p>
{items_html}
<div style="text-align:center;margin-top:24px;">
  <a href="{settings.FRONTEND_URL}"
     style="display:inline-block;background:#2563eb;color:#ffffff;font-weight:600;
            font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;">
    Open Release Radar
  </a>
</div>"""

    send_email(to_email, subject, _email_wrapper(body, uid))


# ── Season premiere alert ─────────────────────────────────────────────────────


def send_season_premiere_email(
    to_email: str, username: str, alerts: list, uid: str = ""
):
    """
    Send an alert email for upcoming season premieres.
    Each alert dict has: show_name, season_number, season_name, air_date, days_away (7 or 30),
    and optionally poster_path, show_id.
    """
    if not alerts:
        return

    thirty_day = [a for a in alerts if a["days_away"] == 30]
    seven_day = [a for a in alerts if a["days_away"] == 7]

    def _alert_card(a: dict) -> str:
        season_label = a.get("season_name") or f"Season {a['season_number']}"
        show_id = a.get("show_id")
        content_url = (
            f"{settings.FRONTEND_URL}/tv/{show_id}"
            if show_id
            else settings.FRONTEND_URL
        )
        poster = _poster_img(a.get("poster_path"), a["show_name"], content_url)
        has_poster = bool(a.get("poster_path"))
        layout_style = (
            "display:flex;align-items:flex-start;gap:14px;" if has_poster else ""
        )
        return f"""
<div style="{layout_style}background:#0f172a;border:1px solid #334155;
            border-radius:10px;padding:14px;margin-bottom:10px;">
  {poster}
  <div style="flex:1;">
    <a href="{content_url}" style="color:#f1f5f9;font-size:15px;font-weight:600;
       text-decoration:none;display:block;margin-bottom:2px;">{a["show_name"]}</a>
    <p style="margin:0 0 4px;color:#93c5fd;font-size:13px;">{season_label}</p>
    <p style="margin:0;color:#64748b;font-size:12px;">Premieres {_format_date(a["air_date"])}</p>
  </div>
</div>"""

    sections = ""
    if thirty_day:
        sections += f"""
<p style="margin:20px 0 8px;color:#f59e0b;font-size:13px;font-weight:700;
          text-transform:uppercase;letter-spacing:0.8px;">Coming in one month</p>
{"".join(_alert_card(a) for a in thirty_day)}"""
    if seven_day:
        sections += f"""
<p style="margin:20px 0 8px;color:#f97316;font-size:13px;font-weight:700;
          text-transform:uppercase;letter-spacing:0.8px;">Coming in one week</p>
{"".join(_alert_card(a) for a in seven_day)}"""

    count = len(alerts)
    subject = f"New season{'s' if count > 1 else ''} coming soon — Release Radar"

    body = f"""
<h2 style="margin:0 0 4px;color:#f1f5f9;font-size:20px;font-weight:700;">
  Hi {username or 'there'} 👋
</h2>
<p style="margin:0 0 20px;color:#94a3b8;font-size:14px;">
  Heads up — the following show{'s' if count > 1 else ''} you're tracking
  ha{'ve' if count > 1 else 's'} a new season on the way:
</p>
{sections}
<div style="text-align:center;margin-top:24px;">
  <a href="{settings.FRONTEND_URL}"
     style="display:inline-block;background:#2563eb;color:#ffffff;font-weight:600;
            font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;">
    Open Release Radar
  </a>
</div>"""

    send_email(to_email, subject, _email_wrapper(body, uid))


# ── Recommendation email ──────────────────────────────────────────────────────


def send_recommendation_email(
    to_email: str,
    to_username: str,
    from_username: str,
    content_type: str,
    content_title: str,
    content_id: int,
    message: str | None,
    uid: str = "",
    poster_path: str | None = None,
):
    content_path = f"{'movie' if content_type == 'movie' else 'tv'}/{content_id}"
    content_url = f"{settings.FRONTEND_URL}/{content_path}"
    kind = "movie" if content_type == "movie" else "TV show"

    poster_block = ""
    if poster_path:
        poster_block = (
            f'<div style="text-align:center;margin-bottom:20px;">'
            f'<a href="{content_url}">'
            f'<img src="{TMDB_IMAGE_BASE}{poster_path}" alt="{content_title}"'
            f' width="100" height="150" style="border-radius:10px;object-fit:cover;display:inline-block;" />'
            f"</a></div>"
        )

    message_block = ""
    if message:
        message_block = (
            f'<div style="background:#0f172a;border-left:3px solid #3b82f6;'
            f'border-radius:0 8px 8px 0;padding:12px 16px;margin:16px 0;">'
            f'<p style="margin:0;color:#94a3b8;font-size:14px;font-style:italic;">"{message}"</p>'
            f"</div>"
        )

    body = f"""
<h2 style="margin:0 0 4px;color:#f1f5f9;font-size:20px;font-weight:700;">
  Hi {to_username or 'there'} 👋
</h2>
<p style="margin:0 0 20px;color:#94a3b8;font-size:14px;">
  <strong style="color:#93c5fd;">@{from_username}</strong> recommended a {kind} for you:
</p>
{poster_block}
<div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:16px;margin-bottom:16px;">
  <a href="{content_url}"
     style="color:#f1f5f9;font-size:18px;font-weight:700;text-decoration:none;">
    {content_title}
  </a>
  <p style="margin:4px 0 0;color:#64748b;font-size:13px;text-transform:capitalize;">{kind}</p>
</div>
{message_block}
<div style="text-align:center;margin-top:24px;">
  <a href="{content_url}"
     style="display:inline-block;background:#2563eb;color:#ffffff;font-weight:600;
            font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;">
    View {content_title}
  </a>
</div>"""

    send_email(
        to_email,
        f'@{from_username} recommended "{content_title}" to you',
        _email_wrapper(body, uid),
    )


def send_email(to_email: str, subject: str, html_body: str):
    if not settings.RESEND_API_KEY:
        print(
            f"[email_service] RESEND_API_KEY not configured, skipping email to {to_email}"
        )
        return

    resend.api_key = settings.RESEND_API_KEY
    try:
        resend.Emails.send(
            {
                "from": settings.EMAIL_FROM,
                "to": to_email,
                "subject": subject,
                "html": html_body,
            }
        )
    except Exception as e:
        print(f"[email_service] Failed to send email to {to_email}: {e}")
