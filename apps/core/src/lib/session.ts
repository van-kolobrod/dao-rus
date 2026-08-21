import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { pool } from "./db";
import { secureCookies, sessionTtlDays } from "./config";

export const SESSION_COOKIE = "dao_session";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(participantId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + sessionTtlDays() * 24 * 60 * 60 * 1000);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO sessions(token_hash, participant_id, expires_at)
       VALUES ($1, $2, $3)`,
      [tokenHash, participantId, expiresAt],
    );
    await client.query(
      `INSERT INTO events(event_type, participant_id, payload)
       VALUES ('participant.logged_in', $1, '{}'::jsonb)`,
      [participantId],
    );
    await client.query("COMMIT");
    return token;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

export async function currentSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: sessionTtlDays() * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: 0,
  });
}

export async function getCurrentParticipant() {
  const token = await currentSessionToken();
  if (!token) return null;

  const result = await pool.query(
    `SELECT p.id,
            p.display_name,
            p.membership_status,
            p.created_at,
            e.username AS telegram_username,
            e.external_user_id AS telegram_user_id,
            e.avatar_url
       FROM sessions s
       JOIN participants p ON p.id = s.participant_id
       LEFT JOIN external_identities e
         ON e.participant_id = p.id AND e.provider = 'telegram'
      WHERE s.token_hash = $1
        AND s.expires_at > now()
      LIMIT 1`,
    [hashToken(token)],
  );

  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    membershipStatus: String(row.membership_status),
    createdAt: new Date(row.created_at),
    telegramUsername: row.telegram_username ? String(row.telegram_username) : null,
    telegramUserId: row.telegram_user_id ? String(row.telegram_user_id) : null,
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
  };
}
