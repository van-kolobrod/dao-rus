import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { telegramConfig } from "./config";
import type { TelegramIdentityProfile } from "./identity";

const TELEGRAM_ISSUER = "https://oauth.telegram.org";
const TELEGRAM_AUTHORIZE_URL = `${TELEGRAM_ISSUER}/auth`;
const TELEGRAM_TOKEN_URL = `${TELEGRAM_ISSUER}/token`;
const TELEGRAM_JWKS_URL = `${TELEGRAM_ISSUER}/.well-known/jwks.json`;
const jwks = createRemoteJWKSet(new URL(TELEGRAM_JWKS_URL));

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function createOidcState(): string {
  return base64Url(randomBytes(32));
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildTelegramAuthorizationUrl(state: string, challenge: string): URL {
  const { clientId, redirectUri } = telegramConfig();
  if (!clientId) throw new Error("TELEGRAM_OIDC_CLIENT_ID is not configured");

  const url = new URL(TELEGRAM_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

async function exchangeCode(code: string, verifier: string): Promise<string> {
  const { clientId, clientSecret, redirectUri } = telegramConfig();
  if (!clientId || !clientSecret) throw new Error("Telegram OIDC is not configured");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(TELEGRAM_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basic}`,
    },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram token exchange failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const data = (await response.json()) as { id_token?: string };
  if (!data.id_token) throw new Error("Telegram token response did not contain id_token");
  return data.id_token;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

export async function authenticateTelegramCode(
  code: string,
  verifier: string,
): Promise<TelegramIdentityProfile> {
  const { clientId } = telegramConfig();
  if (!clientId) throw new Error("TELEGRAM_OIDC_CLIENT_ID is not configured");

  const idToken = await exchangeCode(code, verifier);
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: TELEGRAM_ISSUER,
    audience: clientId,
    algorithms: ["RS256"],
  });

  if (!payload.sub) throw new Error("Telegram ID token has no subject");

  const telegramUserId =
    typeof payload.id === "number" || typeof payload.id === "string"
      ? String(payload.id)
      : String(payload.sub);
  const username = nullableString(payload.preferred_username);
  const firstName = nullableString(payload.given_name);
  const lastName = nullableString(payload.family_name);
  const displayName =
    nullableString(payload.name) ??
    [firstName, lastName].filter(Boolean).join(" ") ??
    username ??
    `Telegram ${telegramUserId}`;

  return {
    subject: String(payload.sub),
    telegramUserId,
    username,
    firstName,
    lastName,
    displayName: displayName || username || `Telegram ${telegramUserId}`,
    avatarUrl: nullableString(payload.picture),
  };
}
