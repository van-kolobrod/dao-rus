export type DisplayNameUpdate = {
  changed: boolean;
  oldDisplayName: string;
  newDisplayName: string;
};

type QueryResult = {
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
};

export type ProfileDatabaseClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};

export type ProfileDatabase = {
  connect(): Promise<ProfileDatabaseClient>;
};

export class DisplayNameValidationError extends Error {
  constructor() {
    super("Display name must not be empty");
    this.name = "DisplayNameValidationError";
  }
}

export function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DisplayNameValidationError();
  }

  return value.trim();
}

export async function updateParticipantDisplayNameWithDatabase(
  database: ProfileDatabase,
  participantId: string,
  value: unknown,
): Promise<DisplayNameUpdate> {
  const newDisplayName = normalizeDisplayName(value);
  const client = await database.connect();

  try {
    await client.query("BEGIN");

    const participantResult = await client.query(
      `SELECT display_name
         FROM participants
        WHERE id = $1
        FOR UPDATE`,
      [participantId],
    );

    if (!participantResult.rowCount) {
      throw new Error("Participant not found");
    }

    const oldDisplayName = String(participantResult.rows[0].display_name);

    if (oldDisplayName === newDisplayName) {
      await client.query("COMMIT");
      return { changed: false, oldDisplayName, newDisplayName };
    }

    await client.query(
      `UPDATE participants
          SET display_name = $2,
              updated_at = now()
        WHERE id = $1`,
      [participantId, newDisplayName],
    );

    await client.query(
      `INSERT INTO events(event_type, participant_id, payload)
       VALUES ('participant.profile_updated', $1, $2::jsonb)`,
      [
        participantId,
        JSON.stringify({
          old_display_name: oldDisplayName,
          new_display_name: newDisplayName,
        }),
      ],
    );

    await client.query("COMMIT");
    return { changed: true, oldDisplayName, newDisplayName };
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

export async function updateParticipantDisplayName(
  participantId: string,
  value: unknown,
): Promise<DisplayNameUpdate> {
  const { pool } = await import("./db");
  return updateParticipantDisplayNameWithDatabase(pool, participantId, value);
}
