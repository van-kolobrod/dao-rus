import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ingestTelegramUpdate: vi.fn(),
  telegramIngestionConfig: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  telegramIngestionConfig: mocks.telegramIngestionConfig,
}));

vi.mock("@/lib/telegram-ingestion", () => ({
  ingestTelegramUpdate: mocks.ingestTelegramUpdate,
  TelegramUpdateValidationError: class TelegramUpdateValidationError extends Error {},
}));

import { POST } from "./route";

const update = {
  update_id: 9001,
  message: {
    message_id: 321,
    chat: { id: -1001234567890 },
    date: 1787328000,
  },
};

function webhookRequest(secret?: string) {
  return new Request("http://localhost:3000/api/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret
        ? { "X-Telegram-Bot-Api-Secret-Token": secret }
        : {}),
    },
    body: JSON.stringify(update),
  }) as Parameters<typeof POST>[0];
}

describe("POST /api/telegram/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.telegramIngestionConfig.mockReturnValue({
      webhookSecret: "expected-secret",
      chatId: "-1001234567890",
    });
  });

  it("accepts the configured Telegram webhook secret", async () => {
    mocks.ingestTelegramUpdate.mockResolvedValue({ status: "created" });

    const response = await POST(webhookRequest("expected-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "created" });
    expect(mocks.ingestTelegramUpdate).toHaveBeenCalledWith(
      update,
      "-1001234567890",
    );
  });

  it.each([undefined, "wrong-secret"])(
    "rejects a missing or invalid Telegram webhook secret",
    async (secret) => {
      const response = await POST(webhookRequest(secret));

      expect(response.status).toBe(401);
      expect(mocks.ingestTelegramUpdate).not.toHaveBeenCalled();
    },
  );

  it("acknowledges an unknown Telegram user without requesting a retry", async () => {
    mocks.ingestTelegramUpdate.mockResolvedValue({
      status: "ignored",
      reason: "unknown_user",
    });

    const response = await POST(webhookRequest("expected-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "ignored" });
  });

  it("fails closed when Telegram ingestion is not configured", async () => {
    mocks.telegramIngestionConfig.mockReturnValue({
      webhookSecret: undefined,
      chatId: undefined,
    });

    const response = await POST(webhookRequest("expected-secret"));

    expect(response.status).toBe(503);
    expect(mocks.ingestTelegramUpdate).not.toHaveBeenCalled();
  });
});
