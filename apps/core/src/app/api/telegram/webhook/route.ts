import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { telegramIngestionConfig } from "@/lib/config";
import {
  ingestTelegramUpdate,
  TelegramUpdateValidationError,
} from "@/lib/telegram-ingestion";

export const runtime = "nodejs";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

function secretMatches(received: string | null, expected: string): boolean {
  if (!received) return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return (
    receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes)
  );
}

export async function POST(request: NextRequest) {
  const { webhookSecret, chatId } = telegramIngestionConfig();
  if (!webhookSecret || !chatId) {
    return new NextResponse("Telegram ingestion is not configured", {
      status: 503,
    });
  }

  if (!secretMatches(request.headers.get(SECRET_HEADER), webhookSecret)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  try {
    const result = await ingestTelegramUpdate(update, chatId);
    return NextResponse.json({ ok: true, status: result.status });
  } catch (error) {
    if (error instanceof TelegramUpdateValidationError) {
      return new NextResponse("Invalid Telegram update", { status: 400 });
    }
    throw error;
  }
}
