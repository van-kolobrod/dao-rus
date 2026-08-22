export const registryMembershipStatuses = [
  "unknown",
  "participant",
  "left",
  "excluded",
  "bot",
] as const;

export const registryIdentityVerifications = ["unverified", "verified"] as const;

export type RegistryMembershipStatus = (typeof registryMembershipStatuses)[number];
export type RegistryIdentityVerification =
  (typeof registryIdentityVerifications)[number];
export type RegistryField = "membership_status" | "identity_verification";

export type ParticipantRegistryEntry = {
  telegramUserId: string;
  username: string | null;
  displayName: string;
  isBot: boolean;
  membershipStatus: RegistryMembershipStatus;
  identityVerification: RegistryIdentityVerification;
  participantId: string | null;
  participantDisplayName: string | null;
  observedAt: Date;
};

export type ParticipantRegistryFilters = {
  search?: string;
  membershipStatus?: string;
  identityVerification?: string;
};

type QueryResult = {
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
};

export type ParticipantRegistryDatabaseClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};

export type ParticipantRegistryDatabase = {
  connect(): Promise<ParticipantRegistryDatabaseClient>;
};

export type ParticipantRegistryQueryDatabase = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

export class ParticipantRegistryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParticipantRegistryValidationError";
  }
}

export class ParticipantRegistryNotFoundError extends Error {
  constructor() {
    super("Telegram roster entry not found");
    this.name = "ParticipantRegistryNotFoundError";
  }
}

export class ParticipantRegistryIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParticipantRegistryIntegrityError";
  }
}

const POSTGRES_BIGINT_MAX = BigInt("9223372036854775807");

function normalizeTelegramUserId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new ParticipantRegistryValidationError("Invalid Telegram user ID");
  }

  const numeric = BigInt(value);
  if (numeric > POSTGRES_BIGINT_MAX) {
    throw new ParticipantRegistryValidationError("Invalid Telegram user ID");
  }
  return value;
}

function isMembershipStatus(value: unknown): value is RegistryMembershipStatus {
  return (
    typeof value === "string" &&
    registryMembershipStatuses.includes(value as RegistryMembershipStatus)
  );
}

function isIdentityVerification(
  value: unknown,
): value is RegistryIdentityVerification {
  return (
    typeof value === "string" &&
    registryIdentityVerifications.includes(value as RegistryIdentityVerification)
  );
}

function normalizeFilters(filters: ParticipantRegistryFilters) {
  return {
    search: filters.search?.trim() ?? "",
    membershipStatus: isMembershipStatus(filters.membershipStatus)
      ? filters.membershipStatus
      : null,
    identityVerification: isIdentityVerification(filters.identityVerification)
      ? filters.identityVerification
      : null,
  };
}

export async function listParticipantRegistryWithDatabase(
  database: ParticipantRegistryQueryDatabase,
  filters: ParticipantRegistryFilters = {},
): Promise<ParticipantRegistryEntry[]> {
  const normalized = normalizeFilters(filters);
  const result = await database.query(
    `SELECT r.telegram_user_id,
            r.username,
            r.display_name,
            r.is_bot,
            r.membership_status,
            r.identity_verification,
            r.participant_id,
            r.observed_at,
            p.display_name AS participant_display_name
       FROM telegram_roster_entries r
       LEFT JOIN participants p ON p.id = r.participant_id
      WHERE (
        $1 = ''
        OR r.display_name ILIKE '%' || $1 || '%'
        OR COALESCE(r.username, '') ILIKE '%' || $1 || '%'
        OR r.telegram_user_id::text LIKE '%' || $1 || '%'
      )
        AND ($2::text IS NULL OR r.membership_status = $2)
        AND ($3::text IS NULL OR r.identity_verification = $3)
      ORDER BY lower(r.display_name), r.telegram_user_id
      LIMIT 1000`,
    [
      normalized.search,
      normalized.membershipStatus,
      normalized.identityVerification,
    ],
  );

  return result.rows.map((row) => ({
    telegramUserId: String(row.telegram_user_id),
    username: row.username ? String(row.username) : null,
    displayName: String(row.display_name),
    isBot: Boolean(row.is_bot),
    membershipStatus: String(row.membership_status) as RegistryMembershipStatus,
    identityVerification: String(
      row.identity_verification,
    ) as RegistryIdentityVerification,
    participantId: row.participant_id ? String(row.participant_id) : null,
    participantDisplayName: row.participant_display_name
      ? String(row.participant_display_name)
      : null,
    observedAt: new Date(String(row.observed_at)),
  }));
}

export async function listParticipantRegistry(
  filters: ParticipantRegistryFilters = {},
): Promise<ParticipantRegistryEntry[]> {
  const { pool } = await import("./db");
  return listParticipantRegistryWithDatabase(pool, filters);
}

export type ParticipantRegistryUpdateResult = {
  changed: boolean;
  field: RegistryField;
  oldValue: string;
  newValue: string;
};

async function bindParticipantForMembership(
  client: ParticipantRegistryDatabaseClient,
  roster: Record<string, unknown>,
  telegramUserId: string,
): Promise<void> {
  const rosterParticipantId = roster.participant_id
    ? String(roster.participant_id)
    : null;
  const identityResult = await client.query(
    `SELECT id, participant_id, external_user_id
       FROM external_identities
      WHERE provider = 'telegram'
        AND (
          external_user_id = $1
          OR ($2::uuid IS NOT NULL AND participant_id = $2::uuid)
        )
      FOR UPDATE`,
    [telegramUserId, rosterParticipantId],
  );

  const userIdentity = identityResult.rows.find(
    (row) => String(row.external_user_id) === telegramUserId,
  );
  const participantIdentity = rosterParticipantId
    ? identityResult.rows.find(
        (row) => String(row.participant_id) === rosterParticipantId,
      )
    : undefined;
  const identityParticipantId = userIdentity
    ? String(userIdentity.participant_id)
    : participantIdentity
      ? String(participantIdentity.participant_id)
      : null;

  if (
    rosterParticipantId &&
    identityParticipantId &&
    rosterParticipantId !== identityParticipantId
  ) {
    throw new ParticipantRegistryIntegrityError(
      `Telegram roster entry ${telegramUserId} is linked to Participant ${rosterParticipantId}, but Telegram identity belongs to Participant ${identityParticipantId}`,
    );
  }

  if (
    participantIdentity?.external_user_id &&
    String(participantIdentity.external_user_id) !== telegramUserId
  ) {
    throw new ParticipantRegistryIntegrityError(
      `Participant ${rosterParticipantId} already has a different Telegram identity`,
    );
  }

  let participantId = rosterParticipantId ?? identityParticipantId;
  let participantCreated = false;
  if (!participantId) {
    const participantResult = await client.query(
      `INSERT INTO participants(display_name, membership_status)
       VALUES ($1, 'participant')
       RETURNING id`,
      [String(roster.display_name)],
    );
    participantId = String(participantResult.rows[0].id);
    participantCreated = true;
  }

  if (participantIdentity && !participantIdentity.external_user_id) {
    await client.query(
      `UPDATE external_identities
          SET external_user_id = $2,
              username = COALESCE($3, username),
              updated_at = now()
        WHERE id = $1`,
      [participantIdentity.id, telegramUserId, roster.username ?? null],
    );
  } else if (!identityParticipantId) {
    await client.query(
      `INSERT INTO external_identities(
         participant_id,
         provider,
         provider_subject,
         external_user_id,
         username
       ) VALUES ($1, 'telegram', $2, $3, $4)`,
      [
        participantId,
        `roster:${telegramUserId}`,
        telegramUserId,
        roster.username ?? null,
      ],
    );
  }

  if (!rosterParticipantId) {
    await client.query(
      `UPDATE telegram_roster_entries
          SET participant_id = $2
        WHERE telegram_user_id = $1::bigint
          AND participant_id IS NULL`,
      [telegramUserId, participantId],
    );
  }

  if (participantCreated) {
    await client.query(
      `INSERT INTO events(event_type, participant_id, payload)
       VALUES ('participant.created', $1, $2::jsonb)`,
      [
        participantId,
        JSON.stringify({
          source: "participant_registry",
          telegram_user_id: telegramUserId,
        }),
      ],
    );
  }
}

export async function updateParticipantRegistryWithDatabase(
  database: ParticipantRegistryDatabase,
  changedByParticipantId: string,
  telegramUserIdValue: unknown,
  fieldValue: unknown,
  newValue: unknown,
): Promise<ParticipantRegistryUpdateResult> {
  const telegramUserId = normalizeTelegramUserId(telegramUserIdValue);
  if (fieldValue !== "membership_status" && fieldValue !== "identity_verification") {
    throw new ParticipantRegistryValidationError("Invalid registry field");
  }
  const field: RegistryField = fieldValue;
  if (
    (field === "membership_status" && !isMembershipStatus(newValue)) ||
    (field === "identity_verification" && !isIdentityVerification(newValue))
  ) {
    throw new ParticipantRegistryValidationError("Invalid registry value");
  }

  const normalizedNewValue = String(newValue);
  const client = await database.connect();

  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT membership_status,
              identity_verification,
              participant_id,
              display_name,
              username
         FROM telegram_roster_entries
        WHERE telegram_user_id = $1::bigint
        FOR UPDATE`,
      [telegramUserId],
    );
    if (!current.rowCount) throw new ParticipantRegistryNotFoundError();

    const oldValue = String(current.rows[0][field]);
    if (oldValue === normalizedNewValue) {
      await client.query("COMMIT");
      return { changed: false, field, oldValue, newValue: normalizedNewValue };
    }

    if (field === "membership_status" && normalizedNewValue === "participant") {
      await bindParticipantForMembership(client, current.rows[0], telegramUserId);
    }

    const changedAt = new Date().toISOString();
    await client.query(
      `UPDATE telegram_roster_entries
          SET ${field} = $2
        WHERE telegram_user_id = $1::bigint`,
      [telegramUserId, normalizedNewValue],
    );

    const eventType =
      field === "membership_status"
        ? "participant_registry.membership_status_changed"
        : "participant_registry.identity_verification_changed";
    await client.query(
      `INSERT INTO events(event_type, participant_id, payload)
       VALUES ($1, $2, $3::jsonb)`,
      [
        eventType,
        changedByParticipantId,
        JSON.stringify({
          telegram_user_id: telegramUserId,
          old_value: oldValue,
          new_value: normalizedNewValue,
          changed_by_participant_id: changedByParticipantId,
          changed_at: changedAt,
        }),
      ],
    );
    await client.query("COMMIT");
    return { changed: true, field, oldValue, newValue: normalizedNewValue };
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

export async function updateParticipantRegistry(
  changedByParticipantId: string,
  telegramUserId: unknown,
  field: unknown,
  newValue: unknown,
): Promise<ParticipantRegistryUpdateResult> {
  const { pool } = await import("./db");
  return updateParticipantRegistryWithDatabase(
    pool,
    changedByParticipantId,
    telegramUserId,
    field,
    newValue,
  );
}
