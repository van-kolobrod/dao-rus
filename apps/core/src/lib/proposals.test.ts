import { describe, expect, it } from "vitest";
import {
  ProposalEligibilityError,
  ProposalValidationError,
  createProposalWithDatabase,
  type ProposalDatabase,
  type ProposalDatabaseClient,
} from "./proposals";

const proposalId = "10000000-0000-0000-0000-000000000001";
const authorId = "20000000-0000-0000-0000-000000000001";

class FakeClient implements ProposalDatabaseClient {
  queries: Array<{ text: string; values?: unknown[] }> = [];
  released = false;

  constructor(
    private readonly failEvent = false,
    private readonly membershipStatus = "participant",
  ) {}

  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });

    if (text.includes("SELECT membership_status")) {
      return {
        rowCount: 1,
        rows: [{ membership_status: this.membershipStatus }],
      };
    }

    if (text.includes("INSERT INTO proposals")) {
      return {
        rowCount: 1,
        rows: [
          {
            id: proposalId,
            author_participant_id: values?.[0],
            title: values?.[1],
            body: values?.[2],
            status: "open",
            created_at: "2026-08-21T12:00:00.000Z",
          },
        ],
      };
    }

    if (text.includes("INSERT INTO events") && this.failEvent) {
      throw new Error("event insert failed");
    }

    return { rowCount: 1, rows: [] };
  }

  release() {
    this.released = true;
  }
}

function fakeDatabase(client: FakeClient): ProposalDatabase {
  return {
    async connect() {
      return client;
    },
  };
}

describe("createProposalWithDatabase", () => {
  it("creates an open proposal and proposal.created in one transaction", async () => {
    const client = new FakeClient();

    const proposal = await createProposalWithDatabase(
      fakeDatabase(client),
      authorId,
      "  Первое предложение  ",
      "  Текст предложения  ",
    );

    expect(proposal).toMatchObject({
      id: proposalId,
      authorParticipantId: authorId,
      title: "Первое предложение",
      body: "Текст предложения",
      status: "open",
    });

    const proposalInsert = client.queries.find(({ text }) =>
      text.includes("INSERT INTO proposals"),
    );
    expect(proposalInsert?.values).toEqual([
      authorId,
      "Первое предложение",
      "Текст предложения",
    ]);

    const eventInsert = client.queries.find(({ text }) => text.includes("INSERT INTO events"));
    expect(eventInsert?.values?.[0]).toBe(authorId);
    expect(JSON.parse(String(eventInsert?.values?.[1]))).toEqual({
      proposal_id: proposalId,
      title: "Первое предложение",
    });
    expect(client.queries[0].text).toBe("BEGIN");
    expect(client.queries[1].text).toContain("SELECT membership_status");
    expect(client.queries[1].text).toContain("FOR SHARE");
    expect(client.queries[2].text).toContain("INSERT INTO proposals");
    expect(client.queries[3].text).toContain("INSERT INTO events");
    expect(client.queries[4].text).toBe("COMMIT");
    expect(client.released).toBe(true);
  });

  it.each(["left", "excluded"])(
    "denies Proposal creation for an authenticated %s Participant",
    async (membershipStatus) => {
      const client = new FakeClient(false, membershipStatus);

      await expect(
        createProposalWithDatabase(
          fakeDatabase(client),
          authorId,
          "Заголовок",
          "Текст",
        ),
      ).rejects.toBeInstanceOf(ProposalEligibilityError);

      expect(
        client.queries.some(({ text }) => text.includes("INSERT INTO proposals")),
      ).toBe(false);
      expect(
        client.queries.some(({ text }) => text.includes("INSERT INTO events")),
      ).toBe(false);
      expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
      expect(client.released).toBe(true);
    },
  );

  it.each([
    ["title", "   ", "Текст"],
    ["body", "Заголовок", "   "],
  ] as const)("rejects an empty %s before opening a database connection", async (field, title, body) => {
    let connected = false;
    const database: ProposalDatabase = {
      async connect() {
        connected = true;
        return new FakeClient();
      },
    };

    await expect(createProposalWithDatabase(database, authorId, title, body)).rejects.toMatchObject({
      name: "ProposalValidationError",
      field,
    } satisfies Partial<ProposalValidationError>);
    expect(connected).toBe(false);
  });

  it("rolls back the proposal when the event cannot be created", async () => {
    const client = new FakeClient(true);

    await expect(
      createProposalWithDatabase(fakeDatabase(client), authorId, "Заголовок", "Текст"),
    ).rejects.toThrow("event insert failed");

    expect(client.queries.some(({ text }) => text === "COMMIT")).toBe(false);
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
    expect(client.released).toBe(true);
  });
});
