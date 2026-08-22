export type ActivityEvent = {
  id: number;
  eventType: string;
  createdAt: Date;
  payload: Record<string, unknown>;
};



export type ActivitySummary = {
  lastActivityAt: Date | null;
  events7d: number;
  events30d: number;
  logins30d: number;
  recentEvents: ActivityEvent[];
};

export const activityEventLabels: Record<string, string> = {
  "participant.created": "Регистрация в DAO Core",
  "participant.logged_in": "Вход в DAO Core",
  "participant.profile_updated": "Изменение имени профиля",
  "proposal.created": "Создание предложения",
  "participant_registry.membership_status_changed": "Изменение статуса членства в реестре",
  "participant_registry.identity_verification_changed": "Изменение верификации в реестре",
  "membership.joined": "Принятие в ДАО",
  "membership.left": "Выход из ДАО",
  "membership.rejoined": "Возвращение в ДАО",
  "membership.excluded": "Исключение из ДАО",
  "membership.restored": "Восстановление в ДАО",
};

export function activityEventLabel(eventType: string): string {
  return activityEventLabels[eventType] ?? eventType;
}

export async function getActivitySummary(
  participantId: string,
  recentLimit = 8,
): Promise<ActivitySummary> {
  const { pool } = await import("./db");

  const [summaryResult, eventsResult] = await Promise.all([
    pool.query(
      `SELECT
         max(created_at) AS last_activity_at,
         count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS events_7d,
         count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS events_30d,
         count(*) FILTER (
           WHERE event_type = 'participant.logged_in'
             AND created_at >= now() - interval '30 days'
         )::int AS logins_30d
       FROM events
       WHERE participant_id = $1`,
      [participantId],
    ),
    pool.query(
      `SELECT id, event_type, payload, created_at
       FROM events
       WHERE participant_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [participantId, recentLimit],
    ),
  ]);

  const row = summaryResult.rows[0] ?? {};

  return {
    lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at) : null,
    events7d: Number(row.events_7d ?? 0),
    events30d: Number(row.events_30d ?? 0),
    logins30d: Number(row.logins_30d ?? 0),
    recentEvents: eventsResult.rows.map((event) => ({
      id: Number(event.id),
      eventType: String(event.event_type),
      createdAt: new Date(event.created_at),
      payload:
        event.payload && typeof event.payload === "object"
          ? (event.payload as Record<string, unknown>)
          : {},
    })),
  };
}
