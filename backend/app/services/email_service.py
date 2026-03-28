import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.config import settings


def send_email(to_email: str, subject: str, html_body: str):
    if not settings.SMTP_HOST or not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        print(f"[email_service] SMTP not configured, skipping email to {to_email}")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_FROM or settings.SMTP_USER
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
        server.ehlo()
        if settings.SMTP_USE_TLS:
            server.starttls()
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(msg["From"], to_email, msg.as_string())


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


def send_notification_email(to_email: str, username: str, upcoming_items: list):
    """Send a digest email of upcoming episodes/releases."""
    if not upcoming_items:
        return

    def _item_html(item: dict) -> str:
        time_str = item.get("air_time")
        time_part = f' <span style="color:#888;font-size:13px;">· {time_str}</span>' if time_str else ""
        return (
            f'<li style="margin-bottom:6px">'
            f'<strong>{item["title"]}</strong>'
            f' — {item["date"]}'
            f'{time_part}'
            f'</li>'
        )

    items_html = "".join(_item_html(item) for item in upcoming_items)

    html_body = f"""
    <html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto">
    <h2 style="color:#1e3a8a">Hi {username or 'there'},</h2>
    <p>Here's what's releasing on your Watch Calendar:</p>
    <ul style="line-height:1.8">{items_html}</ul>
    <p><a href="{settings.FRONTEND_URL}" style="color:#2563eb">View your calendar</a></p>
    <p style="color:#888;font-size:12px;">
        You're receiving this because you have email notifications enabled.
        <a href="{settings.FRONTEND_URL}/settings" style="color:#888">Unsubscribe</a>
    </p>
    </body></html>
    """
    send_email(to_email, "Your Watch Calendar — Releasing Today", html_body)
