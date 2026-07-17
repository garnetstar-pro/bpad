"""Sends verification e-mails and user feedback notifications.

Via Azure Communication Services (when ACS_CONNECTION_STRING + EMAIL_SENDER
are set), otherwise just logs the link/message (dev). A send failure must not
break registration or feedback submission - we call it best-effort.
"""
import logging
import os
from typing import Optional


def send_feedback_notification(username: str, email: Optional[str], message: str) -> None:
    """Notify the app owner about new feedback. Best-effort, like verification mail:
    the feedback is already stored by the time we get here, so a failed send must
    only cost the notification, never the message."""
    to = os.environ.get("FEEDBACK_EMAIL")
    conn = os.environ.get("ACS_CONNECTION_STRING")
    sender = os.environ.get("EMAIL_SENDER")
    if not to or not conn or not sender:
        logging.warning(
            "Feedback notification not sent (recipient or provider unset) - "
            "from %s <%s>: %s", username, email or "no e-mail", message
        )
        return

    try:
        from azure.communication.email import EmailClient

        client = EmailClient.from_connection_string(conn)
        body = f"From: {username} <{email or 'no e-mail'}>\n\n{message}"
        msg = {
            "senderAddress": sender,
            "recipients": {"to": [{"address": to}]},
            "content": {
                "subject": f"bpad – feedback from {username}",
                "plainText": body,
            },
        }
        poller = client.begin_send(msg)
        result = poller.result()
        status = getattr(result, "status", None) or (
            result.get("status") if isinstance(result, dict) else result
        )
        logging.info("Feedback notification for %s: status=%s", username, status)
    except Exception as e:  # noqa: BLE001 - best-effort, the feedback is already stored
        logging.error("Failed to send feedback notification: %s", e)


def send_verification_email(to_email: str, link: str) -> None:
    conn = os.environ.get("ACS_CONNECTION_STRING")
    sender = os.environ.get("EMAIL_SENDER")
    if not conn or not sender:
        logging.warning(
            "Email provider is not set - verification link for %s: %s", to_email, link
        )
        return

    try:
        from azure.communication.email import EmailClient

        client = EmailClient.from_connection_string(conn)
        message = {
            "senderAddress": sender,
            "recipients": {"to": [{"address": to_email}]},
            "content": {
                "subject": "bpad – verify your e-mail",
                "plainText": (
                    "Verify your e-mail by clicking this link:\n"
                    f"{link}\n\nIf you didn't sign up, you can ignore this e-mail."
                ),
                "html": (
                    "<p>Verify your e-mail for <b>bpad</b>:</p>"
                    f'<p><a href="{link}">{link}</a></p>'
                    "<p style=\"color:#888\">If you didn't sign up, you can ignore this e-mail.</p>"
                ),
            },
        }
        poller = client.begin_send(message)
        result = poller.result()  # wait for the result so we know if it succeeded
        status = getattr(result, "status", None) or (
            result.get("status") if isinstance(result, dict) else result
        )
        logging.info("Verification email for %s: status=%s", to_email, status)
    except Exception as e:  # noqa: BLE001 - best-effort, the account is created regardless
        logging.error("Failed to send verification email: %s", e)


def base_url() -> str:
    return os.environ.get("APP_BASE_URL", "http://localhost:5173").rstrip("/")
