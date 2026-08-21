import { NextRequest, NextResponse } from "next/server";
import { deleteSession, SESSION_COOKIE } from "@/lib/session";
import { appBaseUrl, secureCookies } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (token) {
    await deleteSession(token);
  }

  const response = NextResponse.redirect(
    new URL("/", appBaseUrl()),
    303
  );

  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: 0,
  });

  return response;
}