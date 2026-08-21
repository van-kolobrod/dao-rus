import { NextRequest, NextResponse } from "next/server";
import {
  appBaseUrl,
  devAuthEnabled,
  secureCookies,
  sessionTtlDays,
} from "@/lib/config";
import { PostgresIdentityStore } from "@/lib/postgres-identity-store";
import { resolveTelegramParticipant } from "@/lib/identity";
import { createSession, SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!devAuthEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const store = new PostgresIdentityStore();

  const { participant } = await resolveTelegramParticipant(store, {
    subject: "dev:telegram:100001",
    telegramUserId: "100001",
    username: "dao_demo",
    firstName: "Демо",
    lastName: "Участник",
    displayName: "Демо Участник",
    avatarUrl: null,
  });

  const sessionToken = await createSession(participant.id);

  const response = NextResponse.redirect(
    new URL("/profile", appBaseUrl()),
    303
  );

  response.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: sessionTtlDays() * 24 * 60 * 60,
  });

  return response;
}