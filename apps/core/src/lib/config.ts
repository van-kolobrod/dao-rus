export type MembershipStatus =
  | "none"
  | "participant"
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

export function telegramIngestionConfig() {
  return {
    webhookSecret: env("TELEGRAM_WEBHOOK_SECRET"),
    chatId: env("TELEGRAM_INGEST_CHAT_ID"),
  };
}

export function prototypeAdminParticipantIds(): Set<string> {
  return new Set(
    (env("ADMIN_PARTICIPANT_IDS") ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function hasPrototypeAdminAccess(participantId: string): boolean {
  return prototypeAdminParticipantIds().has(participantId.toLowerCase());
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
