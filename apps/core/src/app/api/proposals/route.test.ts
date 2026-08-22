import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProposal: vi.fn(),
  getCurrentParticipant: vi.fn(),
  deleteSession: vi.fn(),
  canCreateProposal: vi.fn(
    (participant: { membershipStatus: string }) =>
      participant.membershipStatus === "participant",
  ),
}));

const proposalId = "10000000-0000-0000-0000-000000000001";

vi.mock("@/lib/config", () => ({
  appBaseUrl: () => "http://localhost:3000",
}));

vi.mock("@/lib/session", () => ({
  getCurrentParticipant: mocks.getCurrentParticipant,
  deleteSession: mocks.deleteSession,
}));

vi.mock("@/lib/eligibility", () => ({
  canCreateProposal: mocks.canCreateProposal,
}));

vi.mock("@/lib/proposals", () => ({
  ProposalEligibilityError: class ProposalEligibilityError extends Error {},
  ProposalValidationError: class ProposalValidationError extends Error {},
  createProposal: mocks.createProposal,
}));

import { POST } from "./route";

function proposalRequest(fields: Record<string, string>) {
  return new Request("http://localhost:3000/api/proposals", {
    method: "POST",
    body: new URLSearchParams(fields),
  }) as Parameters<typeof POST>[0];
}

describe("POST /api/proposals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a proposal for the participant from the current session", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({
      id: "current-participant",
      membershipStatus: "participant",
    });
    mocks.createProposal.mockResolvedValue({ id: proposalId });

    const response = await POST(
      proposalRequest({
        author_participant_id: "another-participant",
        title: "Заголовок",
        body: "Текст",
      }),
    );

    expect(mocks.createProposal).toHaveBeenCalledWith(
      "current-participant",
      "Заголовок",
      "Текст",
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/proposals?proposal_create=created",
    );
  });

  it("does not create a proposal without an authenticated participant", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);

    const response = await POST(
      proposalRequest({ title: "Заголовок", body: "Текст" }),
    );

    expect(mocks.createProposal).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it.each(["left", "excluded"])(
    "denies an authenticated %s Participant without deleting the session",
    async (membershipStatus) => {
      mocks.getCurrentParticipant.mockResolvedValue({
        id: "current-participant",
        membershipStatus,
      });

      const response = await POST(
        proposalRequest({ title: "Заголовок", body: "Текст" }),
      );

      expect(mocks.createProposal).not.toHaveBeenCalled();
      expect(mocks.deleteSession).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/proposals?proposal_create=not_eligible",
      );
    },
  );
});
