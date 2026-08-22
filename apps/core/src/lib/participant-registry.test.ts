import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  listParticipantRegistryWithDatabase,
  updateParticipantRegistryWithDatabase,
  type ParticipantRegistryDatabase,
  type ParticipantRegistryDatabaseClient,
} from "./participant-registry";

const adminParticipantId = "10000000-0000-0000-0000-000000000001";
const createdParticipantId = "20000000-0000-0000-0000-000000000001";
const existingParticipantId = "30000000-0000-0000-0000-000000000001";
const conflictingParticipantId = "40000000-0000-0000-0000-000000000001";
const telegramUserId = "184229790";

class FakeClient implements ParticipantRegistryDatabaseClient {
  queries: Array<{ text: string; values?: unknown[] }> = [];
  released = false;
  membershipStatus: string;
  identityVerification: string;
  rosterParticipantId: string | null;
  identityParticipantId: string | null;

  constructor(
    private readonly options: {
      membershipStatus?: string;
      identityVerification?: string;
      rosterParticipantId?: string | null;
      identityParticipantId?: string | null;
      missing?: boolean;
      failRegistryEvent?: boolean;
    } = {},
  ) {
    this.membershipStatus = options.membershipStatus ?? "unknown";
    this.identityVerification = options.identityVerification ?? "unverified";
    this.rosterParticipantId = options.rosterParticipantId ?? null;
    this.identityParticipantId = options.identityParticipantId ?? null;
  }

  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });

    if (text.includes("SELECT membership_status")) {
      if (this.options.missing) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [{
          membership_status: this.membershipStatus,
          identity_verification: this.identityVerification,
          participant_id: this.rosterParticipantId,
          display_name: "Участник из roster",
          username: "roster_member",
        }],
      };
    }

    if (text.includes("FROM external_identities")) {
      return this.identityParticipantId
        ? {
            rowCount: 1,
            rows: [{
              id: "50000000-0000-0000-0000-000000000001",
              participant_id: this.identityParticipantId,
              external_user_id: telegramUserId,
            }],
          }
        : { rowCount: 0, rows: [] };
    }

    if (text.includes("INSERT INTO participants")) {
      return { rowCount: 1, rows: [{ id: createdParticipantId }] };
    }

    if (text.includes("INSERT INTO external_identities")) {
      this.identityParticipantId = String(values?.[0]);
      return { rowCount: 1, rows: [] };
    }

    if (
      text.includes("UPDATE telegram_roster_entries") &&
      text.includes("SET participant_id")
    ) {
      this.rosterParticipantId = String(values?.[1]);
      return { rowCount: 1, rows: [] };
    }

    if (
      text.includes("UPDATE telegram_roster_entries") &&
      text.includes("SET membership_status")
    ) {
      this.membershipStatus = String(values?.[1]);
      return { rowCount: 1, rows: [] };
    }

    if (
      text.includes("UPDATE telegram_roster_entries") &&
      text.includes("SET identity_verification")
    ) {
      this.identityVerification = String(values?.[1]);
      return { rowCount: 1, rows: [] };
    }

    if (
      text.includes("INSERT INTO events") &&
      values?.[0] === "participant_registry.membership_status_changed" &&
      this.options.failRegistryEvent
    ) {
      throw new Error("registry event insert failed");
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

function queryCount(client: FakeClient, fragment: string) {
  return client.queries.filter(({ text }) => text.includes(fragment)).length;
}

function registryEvent(client: FakeClient) {
  return client.queries.find(
    ({ text, values }) =>
      text.includes("INSERT INTO events") &&
      values?.[0] === "participant_registry.membership_status_changed",
  );
}

describe("Participant Registry migrations", () => {
  it("defaults imported roster membership to unknown", async () => {
    const migration = await readFile(
      new URL("../../migrations/005_participant_registry.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toMatch(/membership_status text NOT NULL DEFAULT 'unknown'/);
    expect(migration).toContain("'unknown', 'participant', 'left', 'excluded', 'bot'");
  });

  it("makes a Telegram external user ID unique for canonical identity binding", async () => {
    const migration = await readFile(
      new URL("../../migrations/006_membership_binding.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain("CREATE UNIQUE INDEX");
    expect(migration).toContain("external_identities(external_user_id)");
    expect(migration).toContain("provider = 'telegram'");
  });
});

describe("updateParticipantRegistryWithDatabase", () => {
  it("creates one Participant, Telegram identity and roster link for unknown to participant", async () => {
    const client = new FakeClient({ identityVerification: "unverified" });
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
    expect(queryCount(client, "INSERT INTO participants")).toBe(1);
    expect(queryCount(client, "INSERT INTO external_identities")).toBe(1);
    expect(client.rosterParticipantId).toBe(createdParticipantId);
    expect(client.identityParticipantId).toBe(createdParticipantId);
    expect(client.identityVerification).toBe("unverified");

    const participantInsert = client.queries.find(({ text }) =>
      text.includes("INSERT INTO participants"),
    );
    expect(participantInsert?.values).toEqual(["Участник из roster"]);
    expect(participantInsert?.text).toContain("'participant'");

    const identityInsert = client.queries.find(({ text }) =>
      text.includes("INSERT INTO external_identities"),
    );
    expect(identityInsert?.values).toEqual([
      createdParticipantId,
      `roster:${telegramUserId}`,
      telegramUserId,
      "roster_member",
    ]);

    const event = registryEvent(client);
    expect(event?.values?.[1]).toBe(adminParticipantId);
    expect(JSON.parse(String(event?.values?.[2]))).toMatchObject({
      telegram_user_id: telegramUserId,
      old_value: "unknown",
      new_value: "participant",
      changed_by_participant_id: adminParticipantId,
    });
    expect(client.queries.at(-1)?.text).toBe("COMMIT");
  });

  it("uses an existing Telegram ExternalIdentity without creating a duplicate", async () => {
    const client = new FakeClient({ identityParticipantId: existingParticipantId });

    await updateParticipantRegistryWithDatabase(
      fakeDatabase(client),
      adminParticipantId,
      telegramUserId,
      "membership_status",
      "participant",
    );

    expect(client.rosterParticipantId).toBe(existingParticipantId);
    expect(queryCount(client, "INSERT INTO participants")).toBe(0);
    expect(queryCount(client, "INSERT INTO external_identities")).toBe(0);
  });

  it("uses an already linked Participant and creates only its missing Telegram identity", async () => {
    const client = new FakeClient({ rosterParticipantId: existingParticipantId });

    await updateParticipantRegistryWithDatabase(
      fakeDatabase(client),
      adminParticipantId,
      telegramUserId,
      "membership_status",
      "participant",
    );

    expect(client.rosterParticipantId).toBe(existingParticipantId);
    expect(client.identityParticipantId).toBe(existingParticipantId);
    expect(queryCount(client, "INSERT INTO participants")).toBe(0);
    expect(queryCount(client, "INSERT INTO external_identities")).toBe(1);
  });

  it("does not create duplicates when participant is saved again", async () => {
    const client = new FakeClient({
      membershipStatus: "participant",
      rosterParticipantId: existingParticipantId,
      identityParticipantId: existingParticipantId,
    });

    const result = await updateParticipantRegistryWithDatabase(
      fakeDatabase(client),
      adminParticipantId,
      telegramUserId,
      "membership_status",
      "participant",
    );

    expect(result.changed).toBe(false);
    expect(queryCount(client, "INSERT INTO participants")).toBe(0);
    expect(queryCount(client, "INSERT INTO external_identities")).toBe(0);
    expect(queryCount(client, "INSERT INTO events")).toBe(0);
    expect(client.queries.at(-1)?.text).toBe("COMMIT");
  });

  it("reuses the same binding when an already known account is moved to participant again", async () => {
    const client = new FakeClient({
      membershipStatus: "left",
      rosterParticipantId: existingParticipantId,
      identityParticipantId: existingParticipantId,
    });

    const result = await updateParticipantRegistryWithDatabase(
      fakeDatabase(client),
      adminParticipantId,
      telegramUserId,
      "membership_status",
      "participant",
    );

    expect(result.changed).toBe(true);
    expect(client.rosterParticipantId).toBe(existingParticipantId);
    expect(client.identityParticipantId).toBe(existingParticipantId);
    expect(queryCount(client, "INSERT INTO participants")).toBe(0);
    expect(queryCount(client, "INSERT INTO external_identities")).toBe(0);
    expect(registryEvent(client)).toBeDefined();
  });

  it("changes verification independently without membership binding", async () => {
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

    expect(client.identityVerification).toBe("verified");
    expect(client.membershipStatus).toBe("participant");
    expect(queryCount(client, "INSERT INTO participants")).toBe(0);
    expect(queryCount(client, "INSERT INTO external_identities")).toBe(0);
    const event = client.queries.find(
      ({ values }) =>
        values?.[0] === "participant_registry.identity_verification_changed",
    );
    expect(event).toBeDefined();
  });

  it("rolls back a conflicting roster and ExternalIdentity link", async () => {
    const client = new FakeClient({
      rosterParticipantId: existingParticipantId,
      identityParticipantId: conflictingParticipantId,
    });

    await expect(
      updateParticipantRegistryWithDatabase(
        fakeDatabase(client),
        adminParticipantId,
        telegramUserId,
        "membership_status",
        "participant",
      ),
    ).rejects.toThrow("but Telegram identity belongs to Participant");

    expect(queryCount(client, "INSERT INTO participants")).toBe(0);
    expect(queryCount(client, "INSERT INTO external_identities")).toBe(0);
    expect(registryEvent(client)).toBeUndefined();
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
  });

  it("rolls back binding, status and participant creation when audit event fails", async () => {
    const client = new FakeClient({ failRegistryEvent: true });
    await expect(
      updateParticipantRegistryWithDatabase(
        fakeDatabase(client),
        adminParticipantId,
        telegramUserId,
        "membership_status",
        "participant",
      ),
    ).rejects.toThrow("registry event insert failed");

    expect(queryCount(client, "INSERT INTO participants")).toBe(1);
    expect(queryCount(client, "INSERT INTO external_identities")).toBe(1);
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
