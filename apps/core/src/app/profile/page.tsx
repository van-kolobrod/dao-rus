import Link from "next/link";
import { redirect } from "next/navigation";
import { getActivitySummary } from "@/lib/activity";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = {
  candidate: "кандидат",
  participant: "участник",
  suspended: "приостановлен",
  excluded: "исключён",
  left: "вышел",
};

export default async function ProfilePage() {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");

  const activity = await getActivitySummary(participant.id);

  return (
    <main className="shell">
      <section className="card profile">
        <div className="profileHeader">
          <div>
            <div className="eyebrow">Участник DAO Core</div>
            <h1>{participant.displayName}</h1>
            <p className="muted">
              {participant.telegramUsername
                ? `@${participant.telegramUsername}`
                : `Telegram ID: ${participant.telegramUserId ?? "—"}`}
            </p>
          </div>
          <form action="/api/auth/logout" method="post">
            <button className="button secondary" type="submit">
              Выйти
            </button>
          </form>
        </div>

        <dl className="facts">
          <div>
            <dt>Внутренний ID</dt>
            <dd className="mono">{participant.id}</dd>
          </div>
          <div>
            <dt>Статус</dt>
            <dd>{statusLabels[participant.membershipStatus] ?? participant.membershipStatus}</dd>
          </div>
          <div>
            <dt>Дата регистрации</dt>
            <dd>{participant.createdAt.toLocaleString("ru-RU")}</dd>
          </div>
        </dl>

        <div className="metrics">
          <article>
            <span>Активность</span>
            <strong>{activity.events30d} событий / 30 дней</strong>
            <small>
              {activity.lastActivityAt
                ? `Последняя: ${activity.lastActivityAt.toLocaleString("ru-RU")}`
                : "Пока нет событий"}
            </small>
            <Link className="metricLink" href="/profile/activity">
              Подробнее →
            </Link>
          </article>
          <article>
            <span>Отзывы</span>
            <strong>Нет данных</strong>
          </article>
          <article>
            <span>Коммуникабельность</span>
            <strong>Нет данных</strong>
          </article>
        </div>
      </section>
    </main>
  );
}
