export type ProposalStatus = "open";

export type Proposal = {
  id: string;
  authorParticipantId: string;
  title: string;
  body: string;
  status: ProposalStatus;
  createdAt: Date;
};

export type ProposalListItem = Proposal & {
  authorDisplayName: string;
};

type ProposalField = "title" | "body";

type QueryResult = {
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
};

export type ProposalDatabaseClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};

export type ProposalDatabase = {
  connect(): Promise<ProposalDatabaseClient>;
};

export class ProposalValidationError extends Error {
  constructor(readonly field: ProposalField) {
    super(`Proposal ${field} must not be empty`);
    this.name = "ProposalValidationError";
  }
}

function normalizeRequiredText(value: unknown, field: ProposalField): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProposalValidationError(field);
  }

  return value.trim();
}

function proposalFromRow(row: Record<string, unknown>): Proposal {
  return {
    id: String(row.id),
    authorParticipantId: String(row.author_participant_id),
    title: String(row.title),
    body: String(row.body),
    status: row.status as ProposalStatus,
    createdAt: new Date(String(row.created_at)),
  };
}

export async function createProposalWithDatabase(
  database: ProposalDatabase,
  authorParticipantId: string,
  titleValue: unknown,
  bodyValue: unknown,
): Promise<Proposal> {
  const title = normalizeRequiredText(titleValue, "title");
  const body = normalizeRequiredText(bodyValue, "body");
  const client = await database.connect();

  try {
    await client.query("BEGIN");

    const proposalResult = await client.query(
      `INSERT INTO proposals(author_participant_id, title, body, status)
       VALUES ($1, $2, $3, 'open')
       RETURNING id, author_participant_id, title, body, status, created_at`,
      [authorParticipantId, title, body],
    );
    const proposal = proposalFromRow(proposalResult.rows[0]);

    await client.query(
      `INSERT INTO events(event_type, participant_id, payload)
       VALUES ('proposal.created', $1, $2::jsonb)`,
      [
        authorParticipantId,
        JSON.stringify({
          proposal_id: proposal.id,
          title: proposal.title,
        }),
      ],
    );

    await client.query("COMMIT");
    return proposal;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function createProposal(
  authorParticipantId: string,
  titleValue: unknown,
  bodyValue: unknown,
): Promise<Proposal> {
  const { pool } = await import("./db");
  return createProposalWithDatabase(pool, authorParticipantId, titleValue, bodyValue);
}

export async function listProposals(): Promise<ProposalListItem[]> {
  const { pool } = await import("./db");
  const result = await pool.query(
    `SELECT proposals.id,
            proposals.author_participant_id,
            proposals.title,
            proposals.body,
            proposals.status,
            proposals.created_at,
            participants.display_name AS author_display_name
       FROM proposals
       JOIN participants ON participants.id = proposals.author_participant_id
      ORDER BY proposals.created_at DESC, proposals.id DESC`,
  );

  return result.rows.map((row) => ({
    ...proposalFromRow(row),
    authorDisplayName: String(row.author_display_name),
  }));
}
