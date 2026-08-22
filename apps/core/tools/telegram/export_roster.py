import argparse
import asyncio
import getpass
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from telethon import TelegramClient


CORE_DIR = Path(__file__).resolve().parents[2]
LOCAL_DIR = CORE_DIR / ".local" / "telegram"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export one Telegram supergroup/forum roster snapshot to JSON."
    )
    parser.add_argument(
        "--chat",
        required=True,
        help="Telegram chat ID (for example -1001234567890) or @username",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="JSON output path; defaults to .local/telegram/telegram-roster-<time>.json",
    )
    parser.add_argument(
        "--session",
        type=Path,
        default=LOCAL_DIR / "mtproto-roster",
        help="Local Telethon session path; keep it outside Git",
    )
    return parser.parse_args()


def required_api_id() -> int:
    value = os.environ.get("TELEGRAM_API_ID") or input("Telegram api_id: ").strip()
    try:
        return int(value)
    except ValueError as error:
        raise SystemExit("Telegram api_id must be an integer") from error


def required_api_hash() -> str:
    value = os.environ.get("TELEGRAM_API_HASH") or getpass.getpass(
        "Telegram api_hash: "
    )
    if not value:
        raise SystemExit("Telegram api_hash is required")
    return value


def chat_reference(value: str):
    try:
        return int(value)
    except ValueError:
        return value


async def export_roster(args: argparse.Namespace) -> Path:
    LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    args.session.parent.mkdir(parents=True, exist_ok=True)

    observed_at = datetime.now(timezone.utc)
    output = args.output or LOCAL_DIR / (
        f"telegram-roster-{observed_at.strftime('%Y%m%dT%H%M%SZ')}.json"
    )
    output.parent.mkdir(parents=True, exist_ok=True)

    client = TelegramClient(str(args.session), required_api_id(), required_api_hash())
    async with client:
        # Load dialogs so private supergroup IDs can be resolved for this user session.
        await client.get_dialogs()
        chat = await client.get_entity(chat_reference(args.chat))
        entries = []
        async for user in client.iter_participants(chat):
            display_name = " ".join(
                part for part in (user.first_name, user.last_name) if part
            ).strip()
            display_name = display_name or user.username or str(user.id)
            entries.append(
                {
                    "telegram_user_id": str(user.id),
                    "username": user.username,
                    "display_name": display_name,
                    "is_bot": bool(user.bot),
                }
            )

        entries.sort(key=lambda entry: int(entry["telegram_user_id"]))
        snapshot = {
            "observed_at": observed_at.isoformat().replace("+00:00", "Z"),
            "chat": {
                "id": str(chat.id),
                "title": getattr(chat, "title", None),
            },
            "entries": entries,
        }
        output.write_text(
            json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    return output


async def main() -> None:
    output = await export_roster(parse_args())
    print(f"Roster snapshot written to {output}")


if __name__ == "__main__":
    asyncio.run(main())
