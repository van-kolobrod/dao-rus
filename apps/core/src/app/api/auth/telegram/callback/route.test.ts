import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateTelegramCode: vi.fn(),
  createSession: vi.fn(),
  resolveTelegramParticipant: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  appBaseUrl: () => "https://dao-lab.trycloudflare.com",
  secureCookies: () => true,
  sessionTtlDays: () => 30,
}));

vi.mock("@/lib/postgres-identity-store", () => ({
  PostgresIdentityStore: class PostgresIdentityStore {},
}));

vi.mock("@/lib/identity", () => ({
  resolveTelegramParticipant: mocks.resolveTelegramParticipant,
}));

vi.mock("@/lib/telegram-oidc", () => ({
  authenticateTelegramCode: mocks.authenticateTelegramCode,
}));

vi.mock("@/lib/session", () => ({
  createSession: mocks.createSession,
  SESSION_COOKIE: "dao_session",
}));

import { GET } from "./route";

function callbackRequest(cookie?: string) {
  return new NextRequest(
    "https://dao-lab.trycloudflare.com/api/auth/telegram/callback?code=code-for-test&state=state-for-test",
    {
      headers: {
        host: "dao-lab.trycloudflare.com",
        "x-forwarded-host": "dao-lab.trycloudflare.com",
        "x-forwarded-proto": "https",
        ...(cookie ? { cookie } : {}),
      },
    },
  );
}

describe("GET /api/auth/telegram/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects missing flow cookies and clears stale flow cookies", async () => {
    const response = await GET(callbackRequest());

    expect(response.status).toBe(400);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("dao_tg_state=");
    expect(setCookie).toContain("dao_tg_verifier=");
    expect(setCookie).toContain("Max-Age=0");
  });

  it("continues only when state and verifier cookies are present", async () => {
    mocks.authenticateTelegramCode.mockResolvedValue({ subject: "telegram-subject" });
    mocks.resolveTelegramParticipant.mockResolvedValue({
      participant: { id: "participant-id" },
    });
    mocks.createSession.mockResolvedValue("session-for-test");

    const response = await GET(
      callbackRequest("dao_tg_state=state-for-test; dao_tg_verifier=verifier-for-test"),
    );

    expect(mocks.authenticateTelegramCode).toHaveBeenCalledWith(
      "code-for-test",
      "verifier-for-test",
    );
    expect(mocks.createSession).toHaveBeenCalledWith("participant-id");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://dao-lab.trycloudflare.com/profile",
    );
  });
});
