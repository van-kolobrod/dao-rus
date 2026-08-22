import { describe, expect, it } from "vitest";
import {
  getMembershipHistoryWithDatabase,
  membershipEventTypeForTransition,
  recordMembershipTransitionWithClient,
} from "./membership-history";

const participantId = "10000000-0000-0000-0000-000000000001";
const adminParticipantId = "20000000-0000-0000-0000-000000000001";

describe("membershipEventTypeForTransition", () => {
  it.each([
    ["unknown", "participant", "membership.joined"],
    ["participant", "left", "membership.left"],
    ["left", "participant", "membership.rejoined"],
    ["participant", "excluded", "membership.excluded"],
    ["excluded", "participant", "membership.restored"],
  ])("maps %s to %s as %s", (oldStatus, newStatus, eventType) => {
    expect(membershipEventTypeForTransition(oldStatus, newStatus)).toBe(eventType);
  });

  it.each([
    ["participant", "participant"],
    ["bot", "participant"],
    ["unknown", "bot"],
    ["left", "excluded"],
  ])("does not invent a political event for %s to %s", (oldStatus, newStatus) => {
    expect(membershipEventTypeForTransition(oldStatus, newStatus)).toBeNull();
  });
});

describe("recordMembershipTransitionWithClient", () => {
  it("stores canonical Participant, author, source and one occurred_at", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const occurredAt = "2026-08-22T17:30:00.000Z";

    await recordMembershipTransitionWithClient(
      { async query(text, values) { queries.push({ text, values }); return { rowCount: 1, rows: [] }; } },
      {
        participantId,
        oldStatus: "unknown",
        newStatus: "participant",
        changedByParticipantId: adminParticipantId,
        telegramUserId: "184229790",
        occurredAt,
      },
    );

    expect(queries[0].values?.slice(0, 2)).toEqual([
      "membership.joined",
      participantId,
    ]);
    expect(JSON.parse(String(queries[0].values?.[2]))).toMatchObject({
      participant_id: participantId,
      changed_by_participant_id: adminParticipantId,
      source: "participant_registry",
      occurred_at: occurredAt,
    });
    expect(queries[0].values?.[3]).toBe(occurredAt);
  });
});

describe("getMembershipHistoryWithDatabase", () => {
  it("returns newest membership events first with administrative authors", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const history = await getMembershipHistoryWithDatabase(
      {
        async query(text, values) {
          queries.push({ text, values });
          return {
            rowCount: 4,
            rows: [
              {
                id: 3,
                event_type: "membership.rejoined",
                created_at: "2027-05-03T08:00:00.000Z",
                payload: { changed_by_participant_id: adminParticipantId, source: "participant_registry" },
                changed_by_display_name: "Администратор",
              },
              {
                id: 1,
                event_type: "membership.joined",
                created_at: "2026-08-22T08:00:00.000Z",
                payload: { changed_by_participant_id: adminParticipantId, source: "participant_registry" },
                changed_by_display_name: "Администратор",
              },
              {
                id: 2,
                event_type: "membership.left",
                created_at: "2027-02-14T08:00:00.000Z",
                payload: { changed_by_participant_id: adminParticipantId, source: "participant_registry" },
                changed_by_display_name: "Администратор",
              },
              {
                id: 4,
                event_type: "participant_registry.identity_verification_changed",
                created_at: "2027-06-01T08:00:00.000Z",
                payload: { changed_by_participant_id: adminParticipantId },
                changed_by_display_name: "Администратор",
              },
            ],
          };
        },
      },
      participantId,
    );

    expect(history.map((entry) => entry.eventType)).toEqual([
      "membership.rejoined",
      "membership.left",
      "membership.joined",
    ]);
    expect(history[0].changedByDisplayName).toBe("Администратор");
    expect(queries[0].text).toContain("ORDER BY e.created_at DESC, e.id DESC");
    expect(queries[0].values?.[0]).toBe(participantId);
    expect(queries[0].values?.[1]).not.toContain(
      "participant_registry.identity_verification_changed",
    );
  });
});
