import { describe, expect, it } from "vitest";
import {
  DisplayNameValidationError,
  updateParticipantDisplayNameWithDatabase,
  type ProfileDatabase,
  type ProfileDatabaseClient,
} from "./profile";

class FakeClient implements ProfileDatabaseClient {
  queries: Array<{ text: string; values?: unknown[] }> = [];
  released = false;

  constructor(private readonly currentDisplayName: string) {}

  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });

    if (text.includes("SELECT display_name")) {
      return {
        rowCount: 1,
        rows: [{ display_name: this.currentDisplayName }],
      };
    }

    return { rowCount: 1, rows: [] };
  }

  release() {
    this.released = true;
  }
}

function fakeDatabase(client: FakeClient): ProfileDatabase {
  return {
    async connect() {
      return client;
    },
  };
}

describe("updateParticipantDisplayNameWithDatabase", () => {
  it("updates the current participant and records the old and new names", async () => {
    const client = new FakeClient("Старое имя");
    const participantId = "00000000-0000-0000-0000-000000000001";

    const result = await updateParticipantDisplayNameWithDatabase(
      fakeDatabase(client),
      participantId,
      "  Новое имя  ",
    );

    expect(result).toEqual({
      changed: true,
      oldDisplayName: "Старое имя",
      newDisplayName: "Новое имя",
    });

    const update = client.queries.find(({ text }) => text.includes("UPDATE participants"));
    expect(update?.values).toEqual([participantId, "Новое имя"]);

    const event = client.queries.find(({ text }) =>
      text.includes("participant.profile_updated"),
    );
    expect(event?.values?.[0]).toBe(participantId);
    expect(JSON.parse(String(event?.values?.[1]))).toEqual({
      old_display_name: "Старое имя",
      new_display_name: "Новое имя",
    });
    expect(client.queries.at(-1)?.text).toBe("COMMIT");
    expect(client.released).toBe(true);
  });

  it("rejects an empty name before opening a database connection", async () => {
    let connected = false;
    const database: ProfileDatabase = {
      async connect() {
        connected = true;
        return new FakeClient("Старое имя");
      },
    };

    await expect(
      updateParticipantDisplayNameWithDatabase(database, "participant-id", "   "),
    ).rejects.toBeInstanceOf(DisplayNameValidationError);
    expect(connected).toBe(false);
  });

  it("does not create an event when the name has not changed", async () => {
    const client = new FakeClient("То же имя");

    const result = await updateParticipantDisplayNameWithDatabase(
      fakeDatabase(client),
      "participant-id",
      "То же имя",
    );

    expect(result.changed).toBe(false);
    expect(client.queries.some(({ text }) => text.includes("UPDATE participants"))).toBe(false);
    expect(client.queries.some(({ text }) => text.includes("INSERT INTO events"))).toBe(false);
    expect(client.queries.at(-1)?.text).toBe("COMMIT");
  });
});
