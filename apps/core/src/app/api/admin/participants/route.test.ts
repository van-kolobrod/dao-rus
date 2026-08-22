import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  hasPrototypeAdminAccess: vi.fn(),
  updateParticipantRegistry: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  appBaseUrl: () => "http://localhost:3000",
  hasPrototypeAdminAccess: mocks.hasPrototypeAdminAccess,
}));

vi.mock("@/lib/session", () => ({
  getCurrentParticipant: mocks.getCurrentParticipant,
}));

vi.mock("@/lib/participant-registry", () => ({
  ParticipantRegistryValidationError: class ParticipantRegistryValidationError extends Error {},
  ParticipantRegistryNotFoundError: class ParticipantRegistryNotFoundError extends Error {},
  updateParticipantRegistry: mocks.updateParticipantRegistry,
}));

import { POST } from "./route";

function registryRequest(fields: Record<string, string>) {
  return new Request("http://localhost:3000/api/admin/participants", {
    method: "POST",
    body: new URLSearchParams(fields),
  }) as Parameters<typeof POST>[0];
}

describe("POST /api/admin/participants", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an authenticated ordinary Participant", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "ordinary-participant" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(false);

    const response = await POST(registryRequest({
      telegram_user_id: "184229790",
      field: "membership_status",
      value: "participant",
    }));

    expect(response.status).toBe(403);
    expect(mocks.updateParticipantRegistry).not.toHaveBeenCalled();
  });

  it("takes changed_by only from the authenticated admin session", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "server-session-admin" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(true);
    mocks.updateParticipantRegistry.mockResolvedValue({ changed: true });

    const response = await POST(registryRequest({
      telegram_user_id: "184229790",
      field: "membership_status",
      value: "participant",
      changed_by_participant_id: "spoofed-client-participant",
    }));

    expect(mocks.updateParticipantRegistry).toHaveBeenCalledWith(
      "server-session-admin",
      "184229790",
      "membership_status",
      "participant",
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/admin/participants?registry_update=updated",
    );
  });
});
