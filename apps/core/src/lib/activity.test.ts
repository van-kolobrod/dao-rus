import { describe, expect, it } from "vitest";
import { activityEventLabel } from "./activity";

describe("activityEventLabel", () => {
  it("returns a human-readable label for known events", () => {
    expect(activityEventLabel("participant.logged_in")).toBe("Вход в DAO Core");
  });

  it("falls back to the raw event type for unknown events", () => {
    expect(activityEventLabel("proposal.created")).toBe("proposal.created");
  });
});
