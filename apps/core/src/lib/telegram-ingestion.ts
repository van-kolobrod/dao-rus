type QueryResult = {
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
};

export type TelegramIngestionDatabaseClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};

export type TelegramIngestionDatabase = {
  connect(): Promise<TelegramIngestionDatabaseClient>;
};

type TelegramMessagePayload = {
  telegram_update_id: number;
  chat_id: number;
  message_id: number;
  message_thread_id: number | null;
  is_topic_message: boolean;
  chat_is_forum: boolean;
  telegram_user_id: number | null;
  username: string | null;
  text: string | null;
  reply_to_message_id: number | null;
  telegram_message_date: string;
};

export type TelegramIngestionResult =
  | {
      status: "ignored";
      reason: "foreign_chat" | "unknown_user" | "unsupported_update";
    }
  | { status: "duplicate" }
  | { status: "created"; eventId: string; participantId: string };

export class TelegramUpdateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramUpdateValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TelegramUpdateValidationError(`${field} must be an integer`);
  }
  return value;
}

function optionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function messagePayloadFromUpdate(
  update: unknown,
): TelegramMessagePayload | null {
  if (!isRecord(update)) {
    throw new TelegramUpdateValidationError("Telegram update must be an object");
  }

  const updateId = requiredInteger(update.update_id, "update_id");
  if (!isRecord(update.message)) return null;

  const message = update.message;
  if (!isRecord(message.chat)) {
    throw new TelegramUpdateValidationError("message.chat must be an object");
  }

  const messageDate = requiredInteger(message.date, "message.date");
  const from = isRecord(message.from) ? message.from : null;
  const reply = isRecord(message.reply_to_message)
    ? message.reply_to_message
    : null;

  return {
    telegram_update_id: updateId,
    chat_id: requiredInteger(message.chat.id, "message.chat.id"),
    message_id: requiredInteger(message.message_id, "message.message_id"),
    message_thread_id: optionalInteger(message.message_thread_id),
    is_topic_message: message.is_topic_message === true,
    chat_is_forum: message.chat.is_forum === true,
    telegram_user_id: from ? optionalInteger(from.id) : null,
    username: from && typeof from.username === "string" ? from.username : null,
    text: typeof message.text === "string" ? message.text : null,
    reply_to_message_id: reply ? optionalInteger(reply.message_id) : null,
    telegram_message_date: new Date(messageDate * 1000).toISOString(),
  };
}

export async function ingestTelegramUpdateWithDatabase(
  database: TelegramIngestionDatabase,
  update: unknown,
  allowedChatId: string,
): Promise<TelegramIngestionResult> {
  const payload = messagePayloadFromUpdate(update);
  if (!payload) return { status: "ignored", reason: "unsupported_update" };
  if (String(payload.chat_id) !== allowedChatId) {
    return { status: "ignored", reason: "foreign_chat" };
  }
  if (payload.telegram_user_id === null) {
    return { status: "ignored", reason: "unknown_user" };
  }

  const client = await database.connect();
  try {
    await client.query("BEGIN");

    const identity = await client.query(
      `SELECT participant_id
         FROM external_identities
        WHERE provider = 'telegram' AND external_user_id = $1
        LIMIT 1`,
      [String(payload.telegram_user_id)],
    );

    if (!identity.rowCount) {
      await client.query("COMMIT");
      return { status: "ignored", reason: "unknown_user" };
    }

    const participantId = String(identity.rows[0].participant_id);

    const processed = await client.query(
      `INSERT INTO telegram_processed_updates(update_id)
       VALUES ($1::bigint)
       ON CONFLICT (update_id) DO NOTHING
       RETURNING update_id`,
      [String(payload.telegram_update_id)],
    );

    if (!processed.rowCount) {
      await client.query("COMMIT");
      return { status: "duplicate" };
    }

    const event = await client.query(
      `INSERT INTO events(event_type, participant_id, payload)
       VALUES ('telegram.message_created', $1, $2::jsonb)
       RETURNING id`,
      [participantId, JSON.stringify(payload)],
    );

    await client.query("COMMIT");
    return {
      status: "created",
      eventId: String(event.rows[0].id),
      participantId,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function ingestTelegramUpdate(
  update: unknown,
  allowedChatId: string,
): Promise<TelegramIngestionResult> {
  const { pool } = await import("./db");
  return ingestTelegramUpdateWithDatabase(pool, update, allowedChatId);
}
