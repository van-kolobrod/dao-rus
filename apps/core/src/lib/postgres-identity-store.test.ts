import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramIdentityProfile } from "./identity";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  defaultMembershipStatus: vi.fn(() => "candidate"),
}));

vi.mock("./db", () => ({
  pool: {
    connect: mocks.connect,
  },
}));

vi.mock("./config", () => ({
  defaultMembershipStatus: mocks.defaultMembershipStatus,
}));

import { PostgresIdentityStore } from "./postgres-identity-store";

const participantId = "10000000-0000-0000-0000-000000000001";
const otherParticipantId = "20000000-0000-0000-0000-000000000001";

const profile: TelegramIdentityProfile = {
  subject: "telegram-subject-184229790",
  telegramUserId: "184229790",
  username: "dao_member",
  firstName: "Участник",
  lastName: "ДАО",
  displayName: "Участник ДАО",
  avatarUrl: null,
};

class FakeIdentityClient {
  queries: Array<{ text: string; values?: unknown[] }> = [];
  released = false;
  rosterParticipantId: string | null;
  identityVerification: "verified" | "unverified" = "verified";

  constructor(rosterParticipantId: string | null = null) {
    this.rosterParticipantId = rosterParticipantId;
  }

  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });

    if (text.includes("INSERT INTO participants")) {
      return {
        rowCount: 1,
        rows: [
          {
            id: participantId,
            display_name: profile.displayName,
            membership_status: "candidate",
            created_at: "2026-08-22T00:00:00.000Z",
          },
        ],
      };
    }

    if (text.includes("FROM telegram_roster_entries")) {
      return {
        rowCount: 1,
        rows: [{ participant_id: this.rosterParticipantId }],
      };
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

describe("PostgresIdentityStore Telegram roster link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("links a roster entry when the Participant is created by OIDC", async () => {
    const client = new FakeIdentityClient();
    mocks.connect.mockResolvedValue(client);

    const participant = await new PostgresIdentityStore().createParticipantWithTelegram(
      profile,
    );

    expect(participant.id).toBe(participantId);
    expect(client.rosterParticipantId).toBe(participantId);
    const rosterUpdate = client.queries.find(({ text }) =>
      text.includes("UPDATE telegram_roster_entries"),
    );
    expect(rosterUpdate?.values).toEqual([profile.telegramUserId, participantId]);
    expect(rosterUpdate?.text).not.toContain("identity_verification");
    expect(client.identityVerification).toBe("verified");
    expect(client.queries.at(-1)?.text).toBe("COMMIT");
    expect(client.released).toBe(true);
  });

  it("links a roster entry on a later login for an existing Participant", async () => {
    const client = new FakeIdentityClient();
    mocks.connect.mockResolvedValue(client);

    await new PostgresIdentityStore().updateTelegramIdentity(
      participantId,
      profile,
    );

    expect(client.rosterParticipantId).toBe(participantId);
    expect(client.queries[0].text).toBe("BEGIN");
    expect(client.queries.at(-1)?.text).toBe("COMMIT");
  });

  it("rolls back OIDC identity creation on a conflicting roster link", async () => {
    const client = new FakeIdentityClient(otherParticipantId);
    mocks.connect.mockResolvedValue(client);

    await expect(
      new PostgresIdentityStore().createParticipantWithTelegram(profile),
    ).rejects.toThrow("but Telegram identity belongs to Participant");

    expect(client.rosterParticipantId).toBe(otherParticipantId);
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
    expect(client.queries.some(({ text }) => text === "COMMIT")).toBe(false);
    expect(
      client.queries.some(({ text }) => text.includes("INSERT INTO events")),
    ).toBe(false);
  });
});
