export type MembershipStatus =
  | "candidate"
  | "participant"
  | "suspended"
  | "excluded"
  | "left";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function appBaseUrl(): string {
  return env("APP_BASE_URL") ?? "http://localhost:3000";
}

export function telegramConfig() {
  const clientId = env("TELEGRAM_OIDC_CLIENT_ID");
  const clientSecret = env("TELEGRAM_OIDC_CLIENT_SECRET");
  const redirectUri =
    env("TELEGRAM_OIDC_REDIRECT_URI") ??
    `${appBaseUrl().replace(/\/$/, "")}/api/auth/telegram/callback`;

  return { clientId, clientSecret, redirectUri };
}

export function isTelegramConfigured(): boolean {
  const { clientId, clientSecret } = telegramConfig();
  return Boolean(clientId && clientSecret);
}

export function defaultMembershipStatus(): MembershipStatus {
  const value = (env("DEFAULT_MEMBERSHIP_STATUS") ?? "candidate") as MembershipStatus;
  const allowed: MembershipStatus[] = [
    "candidate",
    "participant",
    "suspended",
    "excluded",
    "left",
  ];
  return allowed.includes(value) ? value : "candidate";
}

export function sessionTtlDays(): number {
  const raw = Number(env("SESSION_TTL_DAYS") ?? "30");
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

export function devAuthEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && env("DEV_AUTH_BYPASS") === "true";
}

export function secureCookies(): boolean {
  return process.env.NODE_ENV === "production" || appBaseUrl().startsWith("https://");
}
