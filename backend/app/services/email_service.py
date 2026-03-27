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


def send_notification_email(to_email: str, username: str, upcoming_items: list):
    """Send a digest email of upcoming episodes/releases."""
    if not upcoming_items:
        return

    items_html = "".join(
        f"<li><strong>{item['title']}</strong> — {item['date']}</li>"
        for item in upcoming_items
    )

    html_body = f"""
    <html><body>
    <h2>Hi {username or 'there'},</h2>
    <p>Here's what's coming up on your Watch Calendar:</p>
    <ul>{items_html}</ul>
    <p><a href="{settings.FRONTEND_URL}">View your calendar</a></p>
    <p style="color:#888;font-size:12px;">
        You're receiving this because you have email notifications enabled.
        <a href="{settings.FRONTEND_URL}/settings">Unsubscribe</a>
    </p>
    </body></html>
    """
    send_email(to_email, "Your Watch Calendar — Upcoming This Week", html_body)
