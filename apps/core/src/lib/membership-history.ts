export const membershipEventTypes = [
  "membership.joined",
  "membership.left",
  "membership.rejoined",
  "membership.excluded",
  "membership.restored",
] as const;

export type MembershipEventType = (typeof membershipEventTypes)[number];

export type MembershipHistoryEntry = {
  id: number;
  eventType: MembershipEventType;
  occurredAt: Date;
  changedByParticipantId: string | null;
  changedByDisplayName: string | null;
  source: string;
};

type QueryResult = {
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
};

export type MembershipHistoryQueryClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

const transitionEventTypes: Record<string, MembershipEventType> = {
  "unknown:participant": "membership.joined",
  "participant:left": "membership.left",
  "left:participant": "membership.rejoined",
  "participant:excluded": "membership.excluded",
  "excluded:participant": "membership.restored",
};

export function membershipEventTypeForTransition(
  oldStatus: string,
  newStatus: string,
): MembershipEventType | null {
  return transitionEventTypes[`${oldStatus}:${newStatus}`] ?? null;
}

export const membershipEventLabels: Record<MembershipEventType, string> = {
  "membership.joined": "Принят в ДАО",
  "membership.left": "Вышел",
  "membership.rejoined": "Вернулся",
  "membership.excluded": "Исключён",
  "membership.restored": "Восстановлен",
};

export function membershipEventLabel(eventType: MembershipEventType): string {
  return membershipEventLabels[eventType];
}

export async function recordMembershipTransitionWithClient(
  client: MembershipHistoryQueryClient,
  input: {
    participantId: string;
    oldStatus: string;
    newStatus: string;
    changedByParticipantId: string;
    telegramUserId: string;
    occurredAt: string;
  },
): Promise<MembershipEventType | null> {
  const eventType = membershipEventTypeForTransition(
    input.oldStatus,
    input.newStatus,
  );
  if (!eventType) return null;

  await client.query(
    `INSERT INTO events(event_type, participant_id, payload, created_at)
     VALUES ($1, $2, $3::jsonb, $4::timestamptz)`,
    [
      eventType,
      input.participantId,
      JSON.stringify({
        participant_id: input.participantId,
        old_status: input.oldStatus,
        new_status: input.newStatus,
        changed_by_participant_id: input.changedByParticipantId,
        telegram_user_id: input.telegramUserId,
        source: "participant_registry",
        occurred_at: input.occurredAt,
      }),
      input.occurredAt,
    ],
  );

  return eventType;
}

export async function getMembershipHistoryWithDatabase(
  database: MembershipHistoryQueryClient,
  participantId: string,
): Promise<MembershipHistoryEntry[]> {
  const result = await database.query(
    `SELECT e.id,
            e.event_type,
            e.created_at,
            e.payload,
            changed_by.display_name AS changed_by_display_name
       FROM events e
       LEFT JOIN participants changed_by
         ON changed_by.id::text = e.payload->>'changed_by_participant_id'
      WHERE e.participant_id = $1
        AND e.event_type = ANY($2::text[])
      ORDER BY e.created_at DESC, e.id DESC`,
    [participantId, [...membershipEventTypes]],
  );

  return result.rows
    .filter((row) =>
      membershipEventTypes.includes(
        String(row.event_type) as MembershipEventType,
      )
    )
    .map((row) => {
      const payload = row.payload && typeof row.payload === "object"
        ? row.payload as Record<string, unknown>
        : {};
      return {
        id: Number(row.id),
        eventType: String(row.event_type) as MembershipEventType,
        occurredAt: new Date(String(row.created_at)),
        changedByParticipantId: payload.changed_by_participant_id
          ? String(payload.changed_by_participant_id)
          : null,
        changedByDisplayName: row.changed_by_display_name
          ? String(row.changed_by_display_name)
          : null,
        source: payload.source ? String(payload.source) : "unknown",
      };
    })
    .sort((left, right) =>
      right.occurredAt.getTime() - left.occurredAt.getTime() || right.id - left.id
    );
}

export async function getMembershipHistory(
  participantId: string,
): Promise<MembershipHistoryEntry[]> {
  const { pool } = await import("./db");
  return getMembershipHistoryWithDatabase(pool, participantId);
}
