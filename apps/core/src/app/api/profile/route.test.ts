import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  updateParticipantDisplayName: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  appBaseUrl: () => "http://localhost:3000",
}));

vi.mock("@/lib/session", () => ({
  getCurrentParticipant: mocks.getCurrentParticipant,
}));

vi.mock("@/lib/profile", () => ({
  DisplayNameValidationError: class DisplayNameValidationError extends Error {},
  updateParticipantDisplayName: mocks.updateParticipantDisplayName,
}));

import { POST } from "./route";

function profileRequest(fields: Record<string, string>) {
  return new Request("http://localhost:3000/api/profile", {
    method: "POST",
    body: new URLSearchParams(fields),
  }) as Parameters<typeof POST>[0];
}

describe("POST /api/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates only the participant from the current session", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "current-participant" });
    mocks.updateParticipantDisplayName.mockResolvedValue({ changed: true });

    const response = await POST(
      profileRequest({
        display_name: "Новое имя",
        participant_id: "another-participant",
      }),
    );

    expect(mocks.updateParticipantDisplayName).toHaveBeenCalledWith(
      "current-participant",
      "Новое имя",
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/profile?profile_update=updated",
    );
  });

  it("does not update a profile without an authenticated participant", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);

    const response = await POST(profileRequest({ display_name: "Новое имя" }));

    expect(mocks.updateParticipantDisplayName).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });
});
