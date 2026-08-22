import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  importTelegramRosterSnapshotWithDatabase,
  linkTelegramRosterEntryWithClient,
  parseTelegramRosterSnapshot,
  type TelegramRosterDatabase,
  type TelegramRosterDatabaseClient,
} from "./telegram-roster";

const participantId = "10000000-0000-0000-0000-000000000001";
const otherParticipantId = "20000000-0000-0000-0000-000000000001";

describe("Telegram presence migration", () => {
  it("stores status, exact last seen and independent observation time", async () => {
    const migration = await readFile(
      new URL("../../migrations/007_telegram_presence.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("telegram_presence_status text NOT NULL DEFAULT 'unknown'");
    expect(migration).toContain("telegram_last_seen_at timestamptz");
    expect(migration).toContain("telegram_presence_observed_at timestamptz");
    expect(migration).toContain("telegram_presence_status = 'exact'");
    expect(migration).toContain("telegram_last_seen_at IS NOT NULL");
  });
});

function snapshot(entries: unknown[] = [
  {
    telegram_user_id: "184229790",
    username: "  dao_member  ",
    display_name: "  Участник ДАО  ",
    is_bot: false,
  },
]) {
  return {
    observed_at: "2026-08-21T18:15:00+03:00",
    entries,
  };
}

class FakeClient implements TelegramRosterDatabaseClient {
  queries: Array<{ text: string; values?: unknown[] }> = [];
  released = false;
  rosterExists: boolean;
  rosterParticipantId: string | null;
  identityVerification: "verified" | "unverified";
  telegramPresenceStatus: string;
  telegramLastSeenAt: string | null;
  telegramPresenceObservedAt: string;

  constructor(
    private readonly options: {
      failInsert?: boolean;
      identityParticipantIds?: string[];
      rosterExists?: boolean;
      rosterParticipantId?: string | null;
      identityVerification?: "verified" | "unverified";
      telegramPresenceStatus?: string;
      telegramLastSeenAt?: string | null;
      telegramPresenceObservedAt?: string;
    } = {},
  ) {
    this.rosterExists = options.rosterExists ?? false;
    this.rosterParticipantId = options.rosterParticipantId ?? null;
    this.identityVerification = options.identityVerification ?? "unverified";
    this.telegramPresenceStatus = options.telegramPresenceStatus ?? "unknown";
    this.telegramLastSeenAt = options.telegramLastSeenAt ?? null;
    this.telegramPresenceObservedAt = options.telegramPresenceObservedAt ??
      "1970-01-01T00:00:00.000Z";
  }

  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });

    if (text.includes("FROM external_identities")) {
      const participantIds = this.options.identityParticipantIds ?? [];
      return {
        rowCount: participantIds.length,
        rows: participantIds.map((participant_id) => ({ participant_id })),
      };
    }

    if (text.includes("INSERT INTO telegram_roster_entries")) {
      if (this.options.failInsert) {
        throw new Error("roster insert failed");
      }
      this.rosterExists = true;
      const incomingPresenceObservedAt = String(values?.[7]);
      if (
        new Date(incomingPresenceObservedAt).getTime() >=
        new Date(this.telegramPresenceObservedAt).getTime()
      ) {
        this.telegramPresenceStatus = String(values?.[5]);
        this.telegramLastSeenAt = values?.[6] === null
          ? null
          : String(values?.[6]);
        this.telegramPresenceObservedAt = incomingPresenceObservedAt;
      }
      return { rowCount: 1, rows: [] };
    }

    if (text.includes("FROM telegram_roster_entries")) {
      return this.rosterExists
        ? {
            rowCount: 1,
            rows: [{ participant_id: this.rosterParticipantId }],
          }
        : { rowCount: 0, rows: [] };
    }

    if (text.includes("UPDATE telegram_roster_entries")) {
      this.rosterParticipantId = String(values?.[1]);
      return { rowCount: 1, rows: [] };
    }

    return { rowCount: 1, rows: [] };
  }

  release() {
    this.released = true;
  }
}

function fakeDatabase(client: FakeClient): TelegramRosterDatabase {
  return {
    async connect() {
      return client;
    },
  };
}

describe("parseTelegramRosterSnapshot", () => {
  it("normalizes only the allowed roster fields", () => {
    const parsed = parseTelegramRosterSnapshot(
      snapshot([
        {
          telegram_user_id: "184229790",
          username: "  dao_member  ",
          display_name: "  Участник ДАО  ",
          is_bot: false,
          phone: "+70000000000",
          participant_id: "must-not-be-imported",
          identity_verification: "verified",
        },
      ]),
    );

    expect(parsed).toEqual({
      observedAt: "2026-08-21T15:15:00.000Z",
      entries: [
        {
          telegramUserId: "184229790",
          username: "dao_member",
          displayName: "Участник ДАО",
          isBot: false,
          telegramPresenceStatus: "unknown",
          telegramLastSeenAt: null,
          telegramPresenceObservedAt: "2026-08-21T15:15:00.000Z",
        },
      ],
    });
  });

  it.each([
    ["online", null],
    ["recently", null],
    ["last_week", null],
    ["last_month", null],
    ["unknown", null],
    ["exact", "2026-08-20T10:00:00+03:00"],
  ])("preserves %s presence without inventing a timestamp", (status, lastSeenAt) => {
    const parsed = parseTelegramRosterSnapshot(snapshot([{
      telegram_user_id: "184229790",
      username: null,
      display_name: "Участник",
      is_bot: false,
      telegram_presence_status: status,
      telegram_last_seen_at: lastSeenAt,
      telegram_presence_observed_at: "2026-08-21T18:15:00+03:00",
    }]));

    expect(parsed.entries[0]).toMatchObject({
      telegramPresenceStatus: status,
      telegramLastSeenAt: status === "exact"
        ? "2026-08-20T07:00:00.000Z"
        : null,
      telegramPresenceObservedAt: "2026-08-21T15:15:00.000Z",
    });
  });

  it("rejects a fabricated exact timestamp for a coarse status", () => {
    expect(() => parseTelegramRosterSnapshot(snapshot([{
      telegram_user_id: "184229790",
      username: null,
      display_name: "Участник",
      is_bot: false,
      telegram_presence_status: "recently",
      telegram_last_seen_at: "2026-08-20T07:00:00.000Z",
    }]))).toThrow("must be null for recently presence");
  });

  it("rejects exact presence without was_online", () => {
    expect(() => parseTelegramRosterSnapshot(snapshot([{
      telegram_user_id: "184229790",
      username: null,
      display_name: "Участник",
      is_bot: false,
      telegram_presence_status: "exact",
      telegram_last_seen_at: null,
    }]))).toThrow("is required for exact presence");
  });

  it("rejects duplicate Telegram user IDs in one snapshot", () => {
    expect(() =>
      parseTelegramRosterSnapshot(
        snapshot([
          {
            telegram_user_id: "184229790",
            username: null,
            display_name: "Первый",
            is_bot: false,
          },
          {
            telegram_user_id: "184229790",
            username: "duplicate",
            display_name: "Дубликат",
            is_bot: false,
          },
        ]),
      ),
    ).toThrow("duplicate telegram_user_id: 184229790");
  });

  it.each([
    ["invalid timestamp", { ...snapshot(), observed_at: "not-a-date" }],
    [
      "unsafe numeric ID",
      snapshot([
        {
          telegram_user_id: Number.MAX_SAFE_INTEGER + 1,
          username: null,
          display_name: "Участник",
          is_bot: false,
        },
      ]),
    ],
    [
      "empty display name",
      snapshot([
        {
          telegram_user_id: "184229790",
          username: null,
          display_name: "   ",
          is_bot: false,
        },
      ]),
    ],
    [
      "missing bot flag",
      snapshot([
        {
          telegram_user_id: "184229790",
          username: null,
          display_name: "Участник",
        },
      ]),
    ],
  ])("rejects %s", (_case, value) => {
    expect(() => parseTelegramRosterSnapshot(value)).toThrow();
  });
});

describe("importTelegramRosterSnapshotWithDatabase", () => {
  it("leaves participant_id null for an unknown Telegram user", async () => {
    const client = new FakeClient();

    const result = await importTelegramRosterSnapshotWithDatabase(
      fakeDatabase(client),
      snapshot(),
    );

    expect(result).toEqual({
      entriesProcessed: 1,
      rowsAffected: 1,
      observedAt: "2026-08-21T15:15:00.000Z",
    });
    expect(client.queries[0].text).toBe("BEGIN");
    const upsert = client.queries[1];
    expect(upsert.text).toContain("ON CONFLICT (telegram_user_id)");
    expect(upsert.text).toContain(
      "GREATEST",
    );
    expect(upsert.text).not.toContain("participant_id");
    expect(upsert.text).not.toContain("identity_verification");
    expect(upsert.text).not.toContain("phone");
    expect(upsert.values).toEqual([
      "184229790",
      "dao_member",
      "Участник ДАО",
      false,
      "2026-08-21T15:15:00.000Z",
      "unknown",
      null,
      "2026-08-21T15:15:00.000Z",
    ]);
    const identityLookup = client.queries[2];
    expect(identityLookup.text).toContain("FROM external_identities");
    expect(client.rosterParticipantId).toBeNull();
    expect(client.queries[3].text).toBe("COMMIT");
    expect(client.released).toBe(true);
  });

  it("updates presence from a newer snapshot", async () => {
    const client = new FakeClient({
      rosterExists: true,
      telegramPresenceStatus: "last_month",
      telegramPresenceObservedAt: "2026-08-20T00:00:00.000Z",
    });

    await importTelegramRosterSnapshotWithDatabase(fakeDatabase(client), snapshot([{
      telegram_user_id: "184229790",
      username: null,
      display_name: "Участник",
      is_bot: false,
      telegram_presence_status: "exact",
      telegram_last_seen_at: "2026-08-21T14:00:00.000Z",
    }]));

    expect(client.telegramPresenceStatus).toBe("exact");
    expect(client.telegramLastSeenAt).toBe("2026-08-21T14:00:00.000Z");
    expect(client.queries[1].text).toContain(
      "telegram_roster_entries.telegram_presence_observed_at",
    );
  });

  it("does not let an older snapshot overwrite newer presence", async () => {
    const client = new FakeClient({
      rosterExists: true,
      telegramPresenceStatus: "online",
      telegramPresenceObservedAt: "2026-08-22T00:00:00.000Z",
    });

    await importTelegramRosterSnapshotWithDatabase(fakeDatabase(client), snapshot([{
      telegram_user_id: "184229790",
      username: null,
      display_name: "Участник",
      is_bot: false,
      telegram_presence_status: "last_month",
    }]));

    expect(client.telegramPresenceStatus).toBe("online");
    expect(client.telegramLastSeenAt).toBeNull();
    expect(client.telegramPresenceObservedAt).toBe("2026-08-22T00:00:00.000Z");
  });

  it("links an imported entry to an existing Telegram identity", async () => {
    const client = new FakeClient({
      identityParticipantIds: [participantId],
      identityVerification: "verified",
    });

    await importTelegramRosterSnapshotWithDatabase(
      fakeDatabase(client),
      snapshot(),
    );

    expect(client.rosterParticipantId).toBe(participantId);
    const linkUpdate = client.queries.find(({ text }) =>
      text.includes("UPDATE telegram_roster_entries"),
    );
    expect(linkUpdate?.values).toEqual(["184229790", participantId]);
    expect(linkUpdate?.text).not.toContain("identity_verification");
    expect(client.identityVerification).toBe("verified");
    expect(
      client.queries.some(({ text }) => text.includes("INSERT INTO participants")),
    ).toBe(false);
  });

  it("rolls back an import when the roster and identity links conflict", async () => {
    const client = new FakeClient({
      identityParticipantIds: [participantId],
      rosterExists: true,
      rosterParticipantId: otherParticipantId,
    });

    await expect(
      importTelegramRosterSnapshotWithDatabase(
        fakeDatabase(client),
        snapshot(),
      ),
    ).rejects.toThrow("but Telegram identity belongs to Participant");

    expect(client.rosterParticipantId).toBe(otherParticipantId);
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
    expect(client.queries.some(({ text }) => text === "COMMIT")).toBe(false);
  });

  it("validates the entire snapshot before connecting to PostgreSQL", async () => {
    let connected = false;
    const database: TelegramRosterDatabase = {
      async connect() {
        connected = true;
        return new FakeClient();
      },
    };

    await expect(
      importTelegramRosterSnapshotWithDatabase(
        database,
        snapshot([
          {
            telegram_user_id: "not-an-id",
            username: null,
            display_name: "Участник",
            is_bot: false,
          },
        ]),
      ),
    ).rejects.toThrow();
    expect(connected).toBe(false);
  });

  it("rolls back the complete snapshot if an upsert fails", async () => {
    const client = new FakeClient({ failInsert: true });

    await expect(
      importTelegramRosterSnapshotWithDatabase(
        fakeDatabase(client),
        snapshot(),
      ),
    ).rejects.toThrow("roster insert failed");

    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
    expect(client.queries.some(({ text }) => text === "COMMIT")).toBe(false);
    expect(client.released).toBe(true);
  });
});

describe("linkTelegramRosterEntryWithClient", () => {
  it("links a previously imported roster entry for a later OIDC identity", async () => {
    const client = new FakeClient({ rosterExists: true });

    const result = await linkTelegramRosterEntryWithClient(
      client,
      "184229790",
      participantId,
    );

    expect(result).toBe("linked");
    expect(client.rosterParticipantId).toBe(participantId);
    expect(
      client.queries.some(({ text }) => text.includes("identity_verification")),
    ).toBe(false);
  });

  it("does not hide a conflicting existing link", async () => {
    const client = new FakeClient({
      rosterExists: true,
      rosterParticipantId: otherParticipantId,
    });

    await expect(
      linkTelegramRosterEntryWithClient(
        client,
        "184229790",
        participantId,
      ),
    ).rejects.toThrow("but Telegram identity belongs to Participant");
    expect(client.rosterParticipantId).toBe(otherParticipantId);
  });
});
