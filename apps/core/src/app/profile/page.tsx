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

type ProfilePageProps = {
  searchParams: Promise<{ profile_update?: string }>;
};

const updateMessages: Record<string, string> = {
  updated: "Имя профиля обновлено.",
  unchanged: "Имя не изменилось.",
  empty_name: "Введите непустое имя.",
};

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");

  const params = await searchParams;
  const activity = await getActivitySummary(participant.id);
  const updateMessage = params.profile_update
    ? updateMessages[params.profile_update]
    : null;

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
          <div className="profileActions">
            <Link className="button secondary" href="/proposals">
              Предложения
            </Link>
            <form action="/api/auth/logout" method="post">
              <button className="button secondary" type="submit">
                Выйти
              </button>
            </form>
          </div>
        </div>

        <form className="profileEdit" action="/api/profile" method="post">
          <label htmlFor="display-name">Отображаемое имя</label>
          <div>
            <input
              id="display-name"
              name="display_name"
              defaultValue={participant.displayName}
              required
            />
            <button className="button primary" type="submit">
              Сохранить
            </button>
          </div>
          {updateMessage ? (
            <p className={params.profile_update === "empty_name" ? "formError" : "formNotice"}>
              {updateMessage}
            </p>
          ) : null}
        </form>

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
