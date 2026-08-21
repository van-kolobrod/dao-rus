import { describe, expect, it } from "vitest";
import {
  ingestTelegramUpdateWithDatabase,
  type TelegramIngestionDatabase,
  type TelegramIngestionDatabaseClient,
} from "./telegram-ingestion";

const participantId = "10000000-0000-0000-0000-000000000001";

type TelegramUpdateOptions = {
  updateId?: number;
  chatId?: number;
  messageId?: number;
  messageThreadId?: number;
  replyToMessageId?: number;
  isTopicMessage?: boolean;
  chatIsForum?: boolean;
};

function telegramUpdate(options: TelegramUpdateOptions = {}) {
  const chat: Record<string, unknown> = {
    id: options.chatId ?? -1001234567890,
  };
  if (options.chatIsForum !== undefined) {
    chat.is_forum = options.chatIsForum;
  }

  const message: Record<string, unknown> = {
    message_id: options.messageId ?? 321,
    from: {
      id: 424242,
      username: "dao_member",
    },
    chat,
    date: 1787328000,
    text: "  Текст Telegram сохраняется без изменения  ",
  };
  if (options.messageThreadId !== undefined) {
    message.message_thread_id = options.messageThreadId;
  }
  if (options.replyToMessageId !== undefined) {
    message.reply_to_message = { message_id: options.replyToMessageId };
  }
  if (options.isTopicMessage !== undefined) {
    message.is_topic_message = options.isTopicMessage;
  }

  return {
    update_id: options.updateId ?? 9001,
    message,
  };
}

class FakeClient implements TelegramIngestionDatabaseClient {
  queries: Array<{ text: string; values?: unknown[] }> = [];
  released = false;

  constructor(
    private readonly options: {
      markerCreated?: boolean;
      participantId?: string | null;
      failEvent?: boolean;
    } = {},
  ) {}

  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });

    if (text.includes("INSERT INTO telegram_processed_updates")) {
      const markerCreated = this.options.markerCreated ?? true;
      return {
        rowCount: markerCreated ? 1 : 0,
        rows: markerCreated ? [{ update_id: values?.[0] }] : [],
      };
    }

    if (text.includes("FROM external_identities")) {
      return this.options.participantId
        ? { rowCount: 1, rows: [{ participant_id: this.options.participantId }] }
        : { rowCount: 0, rows: [] };
    }

    if (text.includes("INSERT INTO events")) {
      if (this.options.failEvent) throw new Error("event insert failed");
      return { rowCount: 1, rows: [{ id: "7001" }] };
    }

    return { rowCount: 1, rows: [] };
  }

  release() {
    this.released = true;
  }
}

function fakeDatabase(client: FakeClient): TelegramIngestionDatabase {
  return {
    async connect() {
      return client;
    },
  };
}

describe("ingestTelegramUpdateWithDatabase", () => {
  it("stores an ordinary message without thread or topic metadata", async () => {
    const client = new FakeClient({ participantId });

    const result = await ingestTelegramUpdateWithDatabase(
      fakeDatabase(client),
      telegramUpdate(),
      "-1001234567890",
    );

    expect(result).toEqual({
      status: "created",
      eventId: "7001",
      participantId,
    });

    const eventInsert = client.queries.find(({ text }) =>
      text.includes("INSERT INTO events"),
    );
    expect(eventInsert?.values?.[0]).toBe(participantId);
    expect(JSON.parse(String(eventInsert?.values?.[1]))).toEqual({
      telegram_update_id: 9001,
      chat_id: -1001234567890,
      message_id: 321,
      message_thread_id: null,
      is_topic_message: false,
      chat_is_forum: false,
      telegram_user_id: 424242,
      username: "dao_member",
      text: "  Текст Telegram сохраняется без изменения  ",
      reply_to_message_id: null,
      telegram_message_date: "2026-08-21T16:00:00.000Z",
    });
    expect(client.queries.map(({ text }) => text.trim())).toEqual([
      "BEGIN",
      expect.stringContaining("FROM external_identities"),
      expect.stringContaining("INSERT INTO telegram_processed_updates"),
      expect.stringContaining("INSERT INTO events"),
      "COMMIT",
    ]);
    expect(client.released).toBe(true);
  });

  it("stores the immediate reply target for an ordinary reply", async () => {
    const client = new FakeClient({ participantId });

    await ingestTelegramUpdateWithDatabase(
      fakeDatabase(client),
      telegramUpdate({
        updateId: 9002,
        messageId: 322,
        replyToMessageId: 321,
      }),
      "-1001234567890",
    );

    const eventInsert = client.queries.find(({ text }) =>
      text.includes("INSERT INTO events"),
    );
    const payload = JSON.parse(String(eventInsert?.values?.[1]));
    expect(payload.reply_to_message_id).toBe(321);
    expect(payload.message_thread_id).toBeNull();
    expect(payload.is_topic_message).toBe(false);
    expect(payload.chat_is_forum).toBe(false);
  });

  it("does not infer a Forum Topic from message_thread_id", async () => {
    const client = new FakeClient({ participantId });

    await ingestTelegramUpdateWithDatabase(
      fakeDatabase(client),
      telegramUpdate({
        updateId: 9003,
        messageThreadId: 321,
        isTopicMessage: false,
        chatIsForum: false,
      }),
      "-1001234567890",
    );

    const eventInsert = client.queries.find(({ text }) =>
      text.includes("INSERT INTO events"),
    );
    const payload = JSON.parse(String(eventInsert?.values?.[1]));
    expect(payload.message_thread_id).toBe(321);
    expect(payload.is_topic_message).toBe(false);
    expect(payload.chat_is_forum).toBe(false);
  });

  it("stores explicit Forum Topic metadata independently", async () => {
    const client = new FakeClient({ participantId });

    await ingestTelegramUpdateWithDatabase(
      fakeDatabase(client),
      telegramUpdate({
        updateId: 9004,
        messageThreadId: 77,
        replyToMessageId: 300,
        isTopicMessage: true,
        chatIsForum: true,
      }),
      "-1001234567890",
    );

    const eventInsert = client.queries.find(({ text }) =>
      text.includes("INSERT INTO events"),
    );
    const payload = JSON.parse(String(eventInsert?.values?.[1]));
    expect(payload.message_thread_id).toBe(77);
    expect(payload.reply_to_message_id).toBe(300);
    expect(payload.is_topic_message).toBe(true);
    expect(payload.chat_is_forum).toBe(true);
  });

  it("ignores a message from any other chat without touching PostgreSQL", async () => {
    let connected = false;
    const database: TelegramIngestionDatabase = {
      async connect() {
        connected = true;
        return new FakeClient();
      },
    };

    const result = await ingestTelegramUpdateWithDatabase(
      database,
      telegramUpdate({ chatId: -1009999999999 }),
      "-1001234567890",
    );

    expect(result).toEqual({ status: "ignored", reason: "foreign_chat" });
    expect(connected).toBe(false);
  });

  it("ignores Telegram update types other than message", async () => {
    let connected = false;
    const database: TelegramIngestionDatabase = {
      async connect() {
        connected = true;
        return new FakeClient();
      },
    };

    const result = await ingestTelegramUpdateWithDatabase(
      database,
      { update_id: 9002, edited_message: telegramUpdate().message },
      "-1001234567890",
    );

    expect(result).toEqual({
      status: "ignored",
      reason: "unsupported_update",
    });
    expect(connected).toBe(false);
  });

  it("does not create a second event for a repeated update_id", async () => {
    const client = new FakeClient({ markerCreated: false, participantId });

    const result = await ingestTelegramUpdateWithDatabase(
      fakeDatabase(client),
      telegramUpdate(),
      "-1001234567890",
    );

    expect(result).toEqual({ status: "duplicate" });
    expect(client.queries.some(({ text }) => text.includes("INSERT INTO events"))).toBe(false);
    expect(client.queries.at(-1)?.text).toBe("COMMIT");
  });

  it("links the event through an existing Telegram external identity", async () => {
    const client = new FakeClient({ participantId });

    await ingestTelegramUpdateWithDatabase(
      fakeDatabase(client),
      telegramUpdate(),
      "-1001234567890",
    );

    const identityLookup = client.queries.find(({ text }) =>
      text.includes("FROM external_identities"),
    );
    expect(identityLookup?.values).toEqual(["424242"]);
    const eventInsert = client.queries.find(({ text }) =>
      text.includes("INSERT INTO events"),
    );
    expect(eventInsert?.values?.[0]).toBe(participantId);
  });

  it("acknowledges an unknown Telegram user without storing personal history", async () => {
    const client = new FakeClient({ participantId: null });

    const result = await ingestTelegramUpdateWithDatabase(
      fakeDatabase(client),
      telegramUpdate(),
      "-1001234567890",
    );

    expect(result).toEqual({ status: "ignored", reason: "unknown_user" });
    expect(
      client.queries.some(({ text }) => text.includes("INSERT INTO")),
    ).toBe(false);
    expect(
      client.queries.some(({ text }) =>
        text.includes("INSERT INTO telegram_processed_updates"),
      ),
    ).toBe(false);
    expect(client.queries.some(({ text }) => text.includes("INSERT INTO events"))).toBe(false);
    expect(
      client.queries.some(
        ({ text }) =>
          text.includes("INSERT INTO participants") ||
          text.includes("INSERT INTO external_identities"),
      ),
    ).toBe(false);
    expect(client.queries.at(-1)?.text).toBe("COMMIT");
  });

  it("rolls back the processed marker when event creation fails", async () => {
    const client = new FakeClient({ failEvent: true, participantId });

    await expect(
      ingestTelegramUpdateWithDatabase(
        fakeDatabase(client),
        telegramUpdate(),
        "-1001234567890",
      ),
    ).rejects.toThrow("event insert failed");

    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
    expect(client.queries.some(({ text }) => text === "COMMIT")).toBe(false);
    expect(client.released).toBe(true);
  });
});
