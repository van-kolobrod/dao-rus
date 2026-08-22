import { afterEach, describe, expect, it } from "vitest";
import {
  hasPrototypeAdminAccess,
  prototypeAdminParticipantIds,
} from "./config";

const originalAdminParticipantIds = process.env.ADMIN_PARTICIPANT_IDS;

afterEach(() => {
  if (originalAdminParticipantIds === undefined) {
    delete process.env.ADMIN_PARTICIPANT_IDS;
  } else {
    process.env.ADMIN_PARTICIPANT_IDS = originalAdminParticipantIds;
  }
});

describe("prototype admin access", () => {
  it("denies everyone when the explicit allowlist is empty", () => {
    delete process.env.ADMIN_PARTICIPANT_IDS;
    expect(prototypeAdminParticipantIds().size).toBe(0);
    expect(hasPrototypeAdminAccess("participant-id")).toBe(false);
  });

  it("accepts only comma-separated Participant IDs from the environment", () => {
    process.env.ADMIN_PARTICIPANT_IDS = " first-id, SECOND-ID ";
    expect(hasPrototypeAdminAccess("first-id")).toBe(true);
    expect(hasPrototypeAdminAccess("second-id")).toBe(true);
    expect(hasPrototypeAdminAccess("another-id")).toBe(false);
  });
});
