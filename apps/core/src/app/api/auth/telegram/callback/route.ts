import { NextRequest, NextResponse } from "next/server";
import { PostgresIdentityStore } from "@/lib/postgres-identity-store";
import { resolveTelegramParticipant } from "@/lib/identity";
import { authenticateTelegramCode } from "@/lib/telegram-oidc";
import { createSession, SESSION_COOKIE } from "@/lib/session";
import {
  appBaseUrl,
  secureCookies,
  sessionTtlDays,
} from "@/lib/config";

export const runtime = "nodejs";

function clearFlowCookies(response: NextResponse) {
  for (const name of ["dao_tg_state", "dao_tg_verifier"]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies(),
      path: "/",
      maxAge: 0,
    });
  }
}

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    const response = NextResponse.redirect(
      new URL(`/?auth_error=${encodeURIComponent(error)}`, appBaseUrl()),
      303
    );

    clearFlowCookies(response);
    return response;
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get("dao_tg_state")?.value;
  const verifier = request.cookies.get("dao_tg_verifier")?.value;

  if (!code || !state || !expectedState || !verifier || state !== expectedState) {
    return new NextResponse("Invalid or expired Telegram login flow", {
      status: 400,
    });
  }

  try {
    const profile = await authenticateTelegramCode(code, verifier);

    const store = new PostgresIdentityStore();
    const { participant } = await resolveTelegramParticipant(store, profile);

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

    clearFlowCookies(response);
    return response;
  } catch (authError) {
    console.error("Telegram authentication failed", authError);

    const response = NextResponse.redirect(
      new URL("/?auth_error=telegram_failed", appBaseUrl()),
      303
    );

    clearFlowCookies(response);
    return response;
  }
}