type QueryResult = {
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
};

export type TelegramRosterDatabaseClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};

export type TelegramRosterDatabase = {
  connect(): Promise<TelegramRosterDatabaseClient>;
};

export const telegramPresenceStatuses = [
  "online",
  "exact",
  "recently",
  "last_week",
  "last_month",
  "unknown",
] as const;

export type TelegramPresenceStatus =
  (typeof telegramPresenceStatuses)[number];

export type TelegramRosterEntryInput = {
  telegramUserId: string;
  username: string | null;
  displayName: string;
  isBot: boolean;
  telegramPresenceStatus: TelegramPresenceStatus;
  telegramLastSeenAt: string | null;
  telegramPresenceObservedAt: string;
};

export type TelegramRosterSnapshot = {
  observedAt: string;
  entries: TelegramRosterEntryInput[];
};

export type TelegramRosterImportResult = {
  entriesProcessed: number;
  rowsAffected: number;
  observedAt: string;
};

export class TelegramRosterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramRosterValidationError";
  }
}

export class TelegramRosterIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramRosterIntegrityError";
  }
}

const POSTGRES_BIGINT_MAX = BigInt("9223372036854775807");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTelegramUserId(value: unknown, index: number): string {
  let normalized: string;

  if (typeof value === "number" && Number.isSafeInteger(value)) {
    normalized = String(value);
  } else if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    normalized = value;
  } else {
    throw new TelegramRosterValidationError(
      `entries[${index}].telegram_user_id must be a positive integer string`,
    );
  }

  const numeric = BigInt(normalized);
  if (numeric <= BigInt(0) || numeric > POSTGRES_BIGINT_MAX) {
    throw new TelegramRosterValidationError(
      `entries[${index}].telegram_user_id is outside the bigint range`,
    );
  }

  return normalized;
}

function normalizeOptionalText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new TelegramRosterValidationError(`${field} must be a string or null`);
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TelegramRosterValidationError(`${field} must not be empty`);
  }
  return value.trim();
}

function normalizeObservedAt(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TelegramRosterValidationError("observed_at must be an ISO timestamp");
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new TelegramRosterValidationError("observed_at must be an ISO timestamp");
  }

  return timestamp.toISOString();
}

function isTelegramPresenceStatus(
  value: unknown,
): value is TelegramPresenceStatus {
  return (
    typeof value === "string" &&
    telegramPresenceStatuses.includes(value as TelegramPresenceStatus)
  );
}

function normalizePresence(
  entry: Record<string, unknown>,
  index: number,
  snapshotObservedAt: string,
) {
  const statusValue = entry.telegram_presence_status ?? "unknown";
  if (!isTelegramPresenceStatus(statusValue)) {
    throw new TelegramRosterValidationError(
      `entries[${index}].telegram_presence_status is invalid`,
    );
  }

  const observedAt = entry.telegram_presence_observed_at === undefined
    ? snapshotObservedAt
    : normalizeObservedAt(entry.telegram_presence_observed_at);
  const lastSeenValue = entry.telegram_last_seen_at;
  const lastSeenAt = lastSeenValue === undefined || lastSeenValue === null
    ? null
    : normalizeObservedAt(lastSeenValue);

  if (statusValue === "exact" && lastSeenAt === null) {
    throw new TelegramRosterValidationError(
      `entries[${index}].telegram_last_seen_at is required for exact presence`,
    );
  }
  if (statusValue !== "exact" && lastSeenAt !== null) {
    throw new TelegramRosterValidationError(
      `entries[${index}].telegram_last_seen_at must be null for ${statusValue} presence`,
    );
  }

  return {
    telegramPresenceStatus: statusValue,
    telegramLastSeenAt: lastSeenAt,
    telegramPresenceObservedAt: observedAt,
  };
}

export function parseTelegramRosterSnapshot(
  value: unknown,
): TelegramRosterSnapshot {
  if (!isRecord(value)) {
    throw new TelegramRosterValidationError("snapshot must be an object");
  }
  if (!Array.isArray(value.entries)) {
    throw new TelegramRosterValidationError("entries must be an array");
  }

  const observedAt = normalizeObservedAt(value.observed_at);
  const seenUserIds = new Set<string>();
  const entries = value.entries.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new TelegramRosterValidationError(`entries[${index}] must be an object`);
    }

    const telegramUserId = normalizeTelegramUserId(
      entry.telegram_user_id,
      index,
    );
    if (seenUserIds.has(telegramUserId)) {
      throw new TelegramRosterValidationError(
        `duplicate telegram_user_id: ${telegramUserId}`,
      );
    }
    seenUserIds.add(telegramUserId);

    if (typeof entry.is_bot !== "boolean") {
      throw new TelegramRosterValidationError(
        `entries[${index}].is_bot must be a boolean`,
      );
    }

    const presence = normalizePresence(entry, index, observedAt);
    return {
      telegramUserId,
      username: normalizeOptionalText(
        entry.username,
        `entries[${index}].username`,
      ),
      displayName: normalizeRequiredText(
        entry.display_name,
        `entries[${index}].display_name`,
      ),
      isBot: entry.is_bot,
      ...presence,
    };
  });

  return { observedAt, entries };
}

export async function linkTelegramRosterEntryWithClient(
  client: TelegramRosterDatabaseClient,
  telegramUserId: string,
  participantId: string,
): Promise<"missing" | "linked" | "unchanged"> {
  const rosterEntry = await client.query(
    `SELECT participant_id
       FROM telegram_roster_entries
      WHERE telegram_user_id = $1::bigint
      FOR UPDATE`,
    [telegramUserId],
  );

  if (!rosterEntry.rowCount) return "missing";

  const existingParticipantId = rosterEntry.rows[0].participant_id;
  if (existingParticipantId === null || existingParticipantId === undefined) {
    await client.query(
      `UPDATE telegram_roster_entries
          SET participant_id = $2
        WHERE telegram_user_id = $1::bigint
          AND participant_id IS NULL`,
      [telegramUserId, participantId],
    );
    return "linked";
  }

  if (String(existingParticipantId) === participantId) return "unchanged";

  throw new TelegramRosterIntegrityError(
    `Telegram roster entry ${telegramUserId} is linked to Participant ${String(existingParticipantId)}, but Telegram identity belongs to Participant ${participantId}`,
  );
}

async function participantForTelegramIdentity(
  client: TelegramRosterDatabaseClient,
  telegramUserId: string,
): Promise<string | null> {
  const identity = await client.query(
    `SELECT DISTINCT participant_id
       FROM external_identities
      WHERE provider = 'telegram' AND external_user_id = $1`,
    [telegramUserId],
  );

  if ((identity.rowCount ?? 0) > 1) {
    throw new TelegramRosterIntegrityError(
      `Telegram user ${telegramUserId} is linked to multiple Participants`,
    );
  }

  return identity.rowCount ? String(identity.rows[0].participant_id) : null;
}

export async function importTelegramRosterSnapshotWithDatabase(
  database: TelegramRosterDatabase,
  snapshotValue: unknown,
): Promise<TelegramRosterImportResult> {
  const snapshot = parseTelegramRosterSnapshot(snapshotValue);
  const client = await database.connect();
  let rowsAffected = 0;

  try {
    await client.query("BEGIN");

    for (const entry of snapshot.entries) {
      const result = await client.query(
        `INSERT INTO telegram_roster_entries(
           telegram_user_id,
           username,
           display_name,
           is_bot,
           observed_at,
           telegram_presence_status,
           telegram_last_seen_at,
           telegram_presence_observed_at
         )
         VALUES (
           $1::bigint, $2, $3, $4, $5::timestamptz,
           $6, $7::timestamptz, $8::timestamptz
         )
         ON CONFLICT (telegram_user_id) DO UPDATE SET
           username = CASE
             WHEN telegram_roster_entries.observed_at <= EXCLUDED.observed_at
             THEN EXCLUDED.username ELSE telegram_roster_entries.username END,
           display_name = CASE
             WHEN telegram_roster_entries.observed_at <= EXCLUDED.observed_at
             THEN EXCLUDED.display_name ELSE telegram_roster_entries.display_name END,
           is_bot = CASE
             WHEN telegram_roster_entries.observed_at <= EXCLUDED.observed_at
             THEN EXCLUDED.is_bot ELSE telegram_roster_entries.is_bot END,
           observed_at = GREATEST(
             telegram_roster_entries.observed_at,
             EXCLUDED.observed_at
           ),
           telegram_presence_status = CASE
             WHEN telegram_roster_entries.telegram_presence_observed_at
                    <= EXCLUDED.telegram_presence_observed_at
             THEN EXCLUDED.telegram_presence_status
             ELSE telegram_roster_entries.telegram_presence_status END,
           telegram_last_seen_at = CASE
             WHEN telegram_roster_entries.telegram_presence_observed_at
                    <= EXCLUDED.telegram_presence_observed_at
             THEN EXCLUDED.telegram_last_seen_at
             ELSE telegram_roster_entries.telegram_last_seen_at END,
           telegram_presence_observed_at = GREATEST(
             telegram_roster_entries.telegram_presence_observed_at,
             EXCLUDED.telegram_presence_observed_at
           )`,
        [
          entry.telegramUserId,
          entry.username,
          entry.displayName,
          entry.isBot,
          snapshot.observedAt,
          entry.telegramPresenceStatus,
          entry.telegramLastSeenAt,
          entry.telegramPresenceObservedAt,
        ],
      );
      rowsAffected += result.rowCount ?? 0;

      const identityParticipantId = await participantForTelegramIdentity(
        client,
        entry.telegramUserId,
      );
      if (identityParticipantId) {
        await linkTelegramRosterEntryWithClient(
          client,
          entry.telegramUserId,
          identityParticipantId,
        );
      }
    }

    await client.query("COMMIT");
    return {
      entriesProcessed: snapshot.entries.length,
      rowsAffected,
      observedAt: snapshot.observedAt,
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
