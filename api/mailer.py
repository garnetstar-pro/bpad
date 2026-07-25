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


_FONT = "-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"


def _verification_html(link: str) -> str:
    """Branded, dark-themed HTML for the verification e-mail. Table-based and
    inline-styled so it survives Outlook and Gmail; the logo is loaded from the
    deployed app (same base URL as the link, so dev/prod pick their own asset)."""
    logo = f"{base_url()}/icon-192.png"
    return (
        # Hidden preheader - the grey preview line next to the subject in most inboxes.
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">'
        "Confirm your e-mail address to finish setting up bpad.</div>"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="background:#0E1524;margin:0;padding:0;"><tr>'
        '<td align="center" style="padding:32px 16px;">'
        '<table role="presentation" width="460" cellpadding="0" cellspacing="0" '
        'style="width:460px;max-width:460px;background:#172136;'
        'border:1px solid #26324C;border-radius:14px;"><tr>'
        f'<td style="padding:36px 40px 30px;font-family:{_FONT};">'
        # Logo + wordmark
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        '<td style="padding-right:12px;vertical-align:middle;">'
        f'<img src="{logo}" width="44" height="44" alt="bpad" '
        'style="display:block;width:44px;height:44px;border:0;border-radius:10px;"></td>'
        '<td style="vertical-align:middle;">'
        '<div style="font-size:20px;font-weight:800;color:#EEF2FA;'
        'letter-spacing:-0.02em;line-height:1;">bpad</div>'
        '<div style="font-size:9px;font-weight:600;letter-spacing:0.14em;'
        'text-transform:uppercase;color:#22B183;padding-top:5px;">'
        "blank pad &middot; encrypted</div></td></tr></table>"
        '<div style="height:1px;background:#26324C;margin:28px 0;"></div>'
        '<h1 style="margin:0 0 12px;font-size:19px;font-weight:700;color:#EEF2FA;">'
        "Verify your e-mail</h1>"
        '<p style="margin:0 0 26px;font-size:14px;line-height:1.6;color:#8B98B4;">'
        "Tap the button below to confirm this address and write without limits.</p>"
        # Bulletproof button
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        '<td bgcolor="#22B183" style="border-radius:9px;">'
        f'<a href="{link}" style="display:inline-block;padding:13px 26px;'
        "font-size:14px;font-weight:700;color:#0E1524;text-decoration:none;"
        'border-radius:9px;">Verify e-mail &rarr;</a></td></tr></table>'
        '<p style="margin:26px 0 6px;font-size:12px;color:#8B98B4;">'
        "Or paste this link into your browser:</p>"
        '<p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;">'
        f'<a href="{link}" style="color:#22B183;text-decoration:none;">{link}</a></p>'
        '<div style="height:1px;background:#26324C;margin:28px 0 20px;"></div>'
        '<p style="margin:0;font-size:11px;line-height:1.5;color:#5C6885;">'
        "If you didn't sign up for bpad, you can safely ignore this e-mail.</p>"
        "</td></tr></table>"
        f'<div style="font-size:10px;color:#3E4A66;padding-top:18px;font-family:{_FONT};">'
        "bpad &middot; end-to-end encrypted notes</div>"
        "</td></tr></table>"
    )


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
                    "Verify your e-mail for bpad by opening this link:\n"
                    f"{link}\n\nIf you didn't sign up, you can ignore this e-mail."
                ),
                "html": _verification_html(link),
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
