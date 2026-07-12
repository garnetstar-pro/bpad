"""Sends verification e-mails.

Via Azure Communication Services (when ACS_CONNECTION_STRING + EMAIL_SENDER
are set), otherwise just logs the link (dev). A send failure must not break
registration - we call it best-effort.
"""
import logging
import os


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
