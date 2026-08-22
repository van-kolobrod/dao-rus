import { describe, expect, it } from "vitest";
import { canCreateProposal, isCurrentMember } from "./eligibility";

describe("canonical membership eligibility", () => {
  it("treats only the canonical participant state as current membership", () => {
    expect(isCurrentMember({ membershipStatus: "participant" })).toBe(true);

    for (const membershipStatus of [
      "none",
      "left",
      "excluded",
    ]) {
      expect(isCurrentMember({ membershipStatus })).toBe(false);
    }
  });

  it("allows Proposal creation only for a current member", () => {
    expect(canCreateProposal({ membershipStatus: "participant" })).toBe(true);
    expect(canCreateProposal({ membershipStatus: "left" })).toBe(false);
    expect(canCreateProposal({ membershipStatus: "excluded" })).toBe(false);
  });
});
