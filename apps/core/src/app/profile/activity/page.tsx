import Link from "next/link";
import { redirect } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { activityEventLabel, getActivitySummary } from "@/lib/activity";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");

  const activity = await getActivitySummary(participant.id, 30);

  return (
    <main className="shell">
      <section className="card profile">
        <div className="profileHeader">
          <div>
            <div className="eyebrow">Профиль участия</div>
            <h1>Активность</h1>
            <p className="muted">Наблюдаемые события без интегрального рейтинга.</p>
          </div>
          <Link className="button secondary" href="/profile">
            К профилю
          </Link>
        </div>

        <div className="activitySummary">
          <article>
            <span>За 7 дней</span>
            <strong>{activity.events7d}</strong>
            <small>событий</small>
          </article>
          <article>
            <span>За 30 дней</span>
            <strong>{activity.events30d}</strong>
            <small>событий</small>
          </article>
          <article>
            <span>Входов за 30 дней</span>
            <strong>{activity.logins30d}</strong>
            <small>сессий</small>
          </article>
        </div>

        <section className="activityHistory">
          <h2>Последние действия</h2>
          {activity.recentEvents.length ? (
            <ol>
              {activity.recentEvents.map((event) => (
                <li key={event.id}>
                  <div>
                    <strong>{activityEventLabel(event.eventType)}</strong>
                    <span className="muted">
                      <LocalDateTime value={event.createdAt.toISOString()} />
                    </span>
                  </div>
                  <code>{event.eventType}</code>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">Событий пока нет.</p>
          )}
        </section>

        <p className="hint">
          На этом этапе активность — это только прозрачная статистика событий. Вес действий и
          итоговая формула рейтинга сознательно не определены.
        </p>
      </section>
    </main>
  );
}
