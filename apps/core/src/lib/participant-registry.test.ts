import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  listParticipantRegistryWithDatabase,
  updateParticipantRegistryWithDatabase,
  type ParticipantRegistryDatabase,
  type ParticipantRegistryDatabaseClient,
} from "./participant-registry";

const adminParticipantId = "10000000-0000-0000-0000-000000000001";
const telegramUserId = "184229790";

class FakeClient implements ParticipantRegistryDatabaseClient {
  queries: Array<{ text: string; values?: unknown[] }> = [];
  released = false;

  constructor(
    private readonly state: {
      membershipStatus?: string;
      identityVerification?: string;
      missing?: boolean;
      failEvent?: boolean;
    } = {},
  ) {}

  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });

    if (text.includes("SELECT membership_status")) {
      if (this.state.missing) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [
          {
            membership_status: this.state.membershipStatus ?? "unknown",
            identity_verification: this.state.identityVerification ?? "unverified",
          },
        ],
      };
    }

    if (text.includes("INSERT INTO events") && this.state.failEvent) {
      throw new Error("event insert failed");
    }
    return { rowCount: 1, rows: [] };
  }

  release() {
    this.released = true;
  }
}

function fakeDatabase(client: FakeClient): ParticipantRegistryDatabase {
  return { async connect() { return client; } };
}

describe("Participant Registry migration", () => {
  it("defaults imported roster membership to unknown", async () => {
    const migration = await readFile(
      new URL("../../migrations/005_participant_registry.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toMatch(/membership_status text NOT NULL DEFAULT 'unknown'/);
    expect(migration).toContain("'unknown', 'participant', 'left', 'excluded', 'bot'");
  });
});

describe("updateParticipantRegistryWithDatabase", () => {
  it("changes membership status and records the server-side actor", async () => {
    const client = new FakeClient({ membershipStatus: "unknown" });
    const result = await updateParticipantRegistryWithDatabase(
      fakeDatabase(client),
      adminParticipantId,
      telegramUserId,
      "membership_status",
      "participant",
    );

    expect(result).toEqual({
      changed: true,
      field: "membership_status",
      oldValue: "unknown",
      newValue: "participant",
    });
    const update = client.queries.find(({ text }) => text.includes("SET membership_status"));
    expect(update?.values).toEqual([telegramUserId, "participant"]);
    const event = client.queries.find(({ text }) => text.includes("INSERT INTO events"));
    expect(event?.values?.[0]).toBe("participant_registry.membership_status_changed");
    expect(event?.values?.[1]).toBe(adminParticipantId);
    expect(JSON.parse(String(event?.values?.[2]))).toMatchObject({
      telegram_user_id: telegramUserId,
      old_value: "unknown",
      new_value: "participant",
      changed_by_participant_id: adminParticipantId,
    });
    expect(JSON.parse(String(event?.values?.[2])).changed_at).toMatch(/Z$/);
    expect(client.queries.at(-1)?.text).toBe("COMMIT");
    expect(client.released).toBe(true);
  });

  it("changes verification independently from membership", async () => {
    const client = new FakeClient({
      membershipStatus: "participant",
      identityVerification: "unverified",
    });
    await updateParticipantRegistryWithDatabase(
      fakeDatabase(client),
      adminParticipantId,
      telegramUserId,
      "identity_verification",
      "verified",
    );

    const update = client.queries.find(({ text }) =>
      text.includes("SET identity_verification"),
    );
    expect(update?.values).toEqual([telegramUserId, "verified"]);
    expect(update?.text).not.toContain("membership_status =");
    const event = client.queries.find(({ text }) => text.includes("INSERT INTO events"));
    expect(event?.values?.[0]).toBe(
      "participant_registry.identity_verification_changed",
    );
  });

  it("does not update or create an event for a no-op", async () => {
    const client = new FakeClient({ membershipStatus: "left" });
    const result = await updateParticipantRegistryWithDatabase(
      fakeDatabase(client),
      adminParticipantId,
      telegramUserId,
      "membership_status",
      "left",
    );

    expect(result.changed).toBe(false);
    expect(client.queries.some(({ text }) => text.includes("UPDATE telegram_roster_entries"))).toBe(false);
    expect(client.queries.some(({ text }) => text.includes("INSERT INTO events"))).toBe(false);
    expect(client.queries.at(-1)?.text).toBe("COMMIT");
  });

  it("rolls back the status update when event creation fails", async () => {
    const client = new FakeClient({ membershipStatus: "unknown", failEvent: true });
    await expect(
      updateParticipantRegistryWithDatabase(
        fakeDatabase(client),
        adminParticipantId,
        telegramUserId,
        "membership_status",
        "participant",
      ),
    ).rejects.toThrow("event insert failed");

    expect(client.queries.some(({ text }) => text.includes("UPDATE telegram_roster_entries"))).toBe(true);
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
    expect(client.queries.some(({ text }) => text === "COMMIT")).toBe(false);
  });
});

describe("listParticipantRegistryWithDatabase", () => {
  it("applies trimmed search and independent status filters on the server", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const entries = await listParticipantRegistryWithDatabase(
      {
        async query(text, values) {
          queries.push({ text, values });
          return {
            rowCount: 1,
            rows: [{
              telegram_user_id: telegramUserId,
              username: "dao_member",
              display_name: "Участник ДАО",
              is_bot: false,
              membership_status: "participant",
              identity_verification: "unverified",
              participant_id: adminParticipantId,
              participant_display_name: "Core profile",
              observed_at: "2026-08-21T15:15:00.000Z",
            }],
          };
        },
      },
      {
        search: "  184229  ",
        membershipStatus: "participant",
        identityVerification: "unverified",
      },
    );

    expect(queries[0].values).toEqual(["184229", "participant", "unverified"]);
    expect(queries[0].text).toContain("r.display_name ILIKE");
    expect(queries[0].text).toContain("r.username");
    expect(queries[0].text).toContain("r.telegram_user_id::text");
    expect(entries[0]).toMatchObject({
      telegramUserId,
      membershipStatus: "participant",
      identityVerification: "unverified",
      participantId: adminParticipantId,
    });
  });
});
