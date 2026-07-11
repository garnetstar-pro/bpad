"""Odesílání ověřovacích e-mailů.

Přes Azure Communication Services (když je nastaven ACS_CONNECTION_STRING +
EMAIL_SENDER), jinak jen zaloguje odkaz (vývoj). Selhání odeslání nesmí shodit
registraci – voláme best-effort.
"""
import logging
import os


def send_verification_email(to_email: str, link: str) -> None:
    conn = os.environ.get("ACS_CONNECTION_STRING")
    sender = os.environ.get("EMAIL_SENDER")
    if not conn or not sender:
        logging.warning(
            "E-mail provider není nastaven – ověřovací odkaz pro %s: %s", to_email, link
        )
        return

    try:
        from azure.communication.email import EmailClient

        client = EmailClient.from_connection_string(conn)
        message = {
            "senderAddress": sender,
            "recipients": {"to": [{"address": to_email}]},
            "content": {
                "subject": "bpad – ověření e-mailu",
                "plainText": (
                    "Ověř svůj e-mail kliknutím na odkaz:\n"
                    f"{link}\n\nPokud jsi se neregistroval, tento e-mail ignoruj."
                ),
                "html": (
                    "<p>Ověř svůj e-mail pro <b>bpad</b>:</p>"
                    f'<p><a href="{link}">{link}</a></p>'
                    "<p style=\"color:#888\">Pokud jsi se neregistroval, e-mail ignoruj.</p>"
                ),
            },
        }
        client.begin_send(message)
    except Exception as e:  # noqa: BLE001 – best-effort, účet se vytvoří i tak
        logging.error("Odeslání ověřovacího e-mailu selhalo: %s", e)


def base_url() -> str:
    return os.environ.get("APP_BASE_URL", "http://localhost:5173").rstrip("/")
