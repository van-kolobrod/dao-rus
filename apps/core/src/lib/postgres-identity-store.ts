import type { PoolClient } from "pg";
import { defaultMembershipStatus } from "./config";
import { pool } from "./db";
import type { IdentityStore, Participant, TelegramIdentityProfile } from "./identity";

function participantFromRow(row: Record<string, unknown>): Participant {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    membershipStatus: row.membership_status as Participant["membershipStatus"],
    createdAt: new Date(String(row.created_at)),
  };
}

async function findWithClient(client: PoolClient, subject: string): Promise<Participant | null> {
  const result = await client.query(
    `SELECT p.id, p.display_name, p.membership_status, p.created_at
       FROM external_identities e
       JOIN participants p ON p.id = e.participant_id
      WHERE e.provider = 'telegram' AND e.provider_subject = $1`,
    [subject],
  );
  return result.rowCount ? participantFromRow(result.rows[0]) : null;
}

export class PostgresIdentityStore implements IdentityStore {
  async findByTelegramSubject(subject: string): Promise<Participant | null> {
    const client = await pool.connect();
    try {
      return await findWithClient(client, subject);
    } finally {
      client.release();
    }
  }

  async updateTelegramIdentity(
    participantId: string,
    profile: TelegramIdentityProfile,
  ): Promise<void> {
    await pool.query(
      `UPDATE external_identities
          SET external_user_id = $2,
              username = $3,
              first_name = $4,
              last_name = $5,
              avatar_url = $6,
              updated_at = now()
        WHERE participant_id = $1 AND provider = 'telegram'`,
      [
        participantId,
        profile.telegramUserId,
        profile.username,
        profile.firstName,
        profile.lastName,
        profile.avatarUrl,
      ],
    );
  }

  async createParticipantWithTelegram(profile: TelegramIdentityProfile): Promise<Participant> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const participantResult = await client.query(
        `INSERT INTO participants(display_name, membership_status)
         VALUES ($1, $2)
         RETURNING id, display_name, membership_status, created_at`,
        [profile.displayName, defaultMembershipStatus()],
      );
      const participant = participantFromRow(participantResult.rows[0]);

      try {
        await client.query(
          `INSERT INTO external_identities(
             participant_id, provider, provider_subject, external_user_id,
             username, first_name, last_name, avatar_url
           ) VALUES ($1, 'telegram', $2, $3, $4, $5, $6, $7)`,
          [
            participant.id,
            profile.subject,
            profile.telegramUserId,
            profile.username,
            profile.firstName,
            profile.lastName,
            profile.avatarUrl,
          ],
        );
      } catch (error: unknown) {
        const code = (error as { code?: string }).code;
        if (code === "23505") {
          await client.query("ROLLBACK");
          const existingClient = await pool.connect();
          try {
            const existing = await findWithClient(existingClient, profile.subject);
            if (!existing) throw error;
            await this.updateTelegramIdentity(existing.id, profile);
            return existing;
          } finally {
            existingClient.release();
          }
        }
        throw error;
      }

      await client.query(
        `INSERT INTO events(event_type, participant_id, payload)
         VALUES ('participant.created', $1, $2::jsonb)`,
        [participant.id, JSON.stringify({ source: "telegram" })],
      );

      await client.query("COMMIT");
      return participant;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback errors; preserve the original failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
