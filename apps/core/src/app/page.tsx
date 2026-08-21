import Link from "next/link";
import { devAuthEnabled, isTelegramConfigured } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const participant = await getCurrentParticipant();
  const params = await searchParams;
  const telegramReady = isTelegramConfigured();
  const devReady = devAuthEnabled();

  return (
    <main className="shell">
      <section className="hero card">
        <div className="eyebrow">DAO Core · prototype 0.1</div>
        <h1>ДАО Русь</h1>
        <p className="lead">
          Первый вертикальный срез: единый участник, независимый от Telegram и Discourse.
        </p>

        {params.auth_error ? (
          <p className="alert">Вход через Telegram не завершён: {params.auth_error}</p>
        ) : null}

        {participant ? (
          <div className="actions">
            <Link className="button primary" href="/profile">
              Открыть профиль
            </Link>
          </div>
        ) : (
          <div className="actions">
            {telegramReady ? (
              <a className="button primary" href="/api/auth/telegram/start">
                Войти через Telegram
              </a>
            ) : (
              <span className="button disabled">Telegram пока не настроен</span>
            )}

            {devReady ? (
              <form action="/api/auth/dev" method="post">
                <button className="button secondary" type="submit">
                  Демо-вход для локальной проверки
                </button>
              </form>
            ) : null}
          </div>
        )}

        <p className="hint">
          Реальный Telegram-вход использует OIDC Authorization Code Flow + PKCE и проверку
          подписанного ID token на сервере.
        </p>
      </section>
    </main>
  );
}
