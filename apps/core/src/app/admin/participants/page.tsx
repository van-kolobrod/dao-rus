import Link from "next/link";
import { redirect } from "next/navigation";
import { RegistryFieldEditor } from "@/components/registry-field-editor";
import { LocalDateTime } from "@/components/local-date-time";
import { hasPrototypeAdminAccess } from "@/lib/config";
import {
  listParticipantRegistry,
  registryIdentityVerifications,
  registryMembershipStatuses,
  registryPresenceStatuses,
} from "@/lib/participant-registry";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";

type RegistryPageProps = {
  searchParams: Promise<{
    q?: string;
    membership_status?: string;
    identity_verification?: string;
    telegram_presence_status?: string;
    sort?: string;
    registry_update?: string;
  }>;
};

const membershipLabels: Record<string, string> = {
  unknown: "Не определён",
  participant: "Участник",
  left: "Вышел",
  excluded: "Исключён",
  bot: "Бот",
};

const verificationLabels: Record<string, string> = {
  unverified: "Не верифицирован",
  verified: "Верифицирован",
};

const presenceLabels: Record<string, string> = {
  online: "Сейчас в сети",
  exact: "Точное время",
  recently: "Был недавно",
  last_week: "Был на прошлой неделе",
  last_month: "Был в прошлом месяце",
  unknown: "Неизвестно",
};

const membershipOptions = registryMembershipStatuses.map((value) => ({
  value,
  label: membershipLabels[value],
}));

const verificationOptions = registryIdentityVerifications.map((value) => ({
  value,
  label: verificationLabels[value],
}));

const updateMessages: Record<string, string> = {
  updated: "Изменение сохранено и записано в журнал событий.",
  unchanged: "Значение не изменилось; новое событие не создано.",
  invalid: "Некорректное значение статуса.",
  not_found: "Запись roster не найдена.",
};

export default async function ParticipantRegistryPage({
  searchParams,
}: RegistryPageProps) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");

  const params = await searchParams;
  const entries = await listParticipantRegistry({
    search: params.q,
    membershipStatus: params.membership_status,
    identityVerification: params.identity_verification,
    telegramPresenceStatus: params.telegram_presence_status,
    sort: params.sort,
  });
  const updateMessage = params.registry_update
    ? updateMessages[params.registry_update]
    : null;

  return (
    <main className="shell registryShell">
      <section className="card registryPage">
        <div className="profileHeader">
          <div>
            <div className="eyebrow">Prototype admin · Participant Registry v0.1</div>
            <h1>Реестр участников</h1>
            <p className="muted">
              Telegram roster и ручные институциональные статусы. Найдено: {entries.length}.
            </p>
          </div>
          <Link className="button secondary" href="/profile">
            К профилю
          </Link>
        </div>

        <p className="registryWarning">
          Доступ задан временным allowlist внутренних Participant UUID. Это не полноценная
          Role/Permission модель.
        </p>

        <form className="registryFilters" method="get">
          <label>
            <span>Поиск</span>
            <input
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Имя, username или Telegram ID"
            />
          </label>
          <label>
            <span>Статус в ДАО</span>
            <select name="membership_status" defaultValue={params.membership_status ?? ""}>
              <option value="">Все</option>
              {registryMembershipStatuses.map((status) => (
                <option value={status} key={status}>{membershipLabels[status]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Верификация личности</span>
            <select
              name="identity_verification"
              defaultValue={params.identity_verification ?? ""}
            >
              <option value="">Все</option>
              {registryIdentityVerifications.map((status) => (
                <option value={status} key={status}>{verificationLabels[status]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Присутствие в Telegram</span>
            <select
              name="telegram_presence_status"
              defaultValue={params.telegram_presence_status ?? ""}
            >
              <option value="">Все</option>
              {registryPresenceStatuses.map((status) => (
                <option value={status} key={status}>{presenceLabels[status]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Сортировка</span>
            <select name="sort" defaultValue={params.sort ?? "name"}>
              <option value="name">По имени</option>
              <option value="presence_oldest">Давно не появлялись</option>
              <option value="presence_newest">Недавно появлялись</option>
            </select>
          </label>
          <button className="button primary" type="submit">Применить</button>
          <Link className="button secondary" href="/admin/participants">Сбросить</Link>
        </form>

        <p className="muted">
          Присутствие в Telegram — это наблюдение доступного Telegram status, а не
          активность участника в ДАО. «Неизвестно» не означает неактивность.
        </p>

        {updateMessage ? (
          <p className={params.registry_update === "updated" || params.registry_update === "unchanged" ? "formNotice" : "formError"}>
            {updateMessage}
          </p>
        ) : null}

        <div className="registryTableWrap">
          <table className="registryTable">
            <thead>
              <tr>
                <th>Имя / Telegram</th>
                <th>Telegram bot</th>
                <th>Последний раз в Telegram</th>
                <th>Статус в ДАО</th>
                <th>Верификация личности</th>
                <th>Связь с Core</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.telegramUserId}>
                  <td>
                    <strong>{entry.displayName}</strong>
                    <small>{entry.username ? `@${entry.username}` : "без username"}</small>
                    <code>{entry.telegramUserId}</code>
                  </td>
                  <td>{entry.isBot ? "Да" : "Нет"}</td>
                  <td>
                    {entry.telegramPresenceStatus === "exact" &&
                    entry.telegramLastSeenAt ? (
                      <LocalDateTime value={entry.telegramLastSeenAt.toISOString()} />
                    ) : (
                      presenceLabels[entry.telegramPresenceStatus]
                    )}
                  </td>
                  <td>
                    <RegistryFieldEditor
                      telegramUserId={entry.telegramUserId}
                      field="membership_status"
                      label="Статус в ДАО"
                      value={entry.membershipStatus}
                      options={membershipOptions}
                      saveLabel="Сохранить статус"
                    />
                  </td>
                  <td>
                    <RegistryFieldEditor
                      telegramUserId={entry.telegramUserId}
                      field="identity_verification"
                      label="Верификация личности"
                      value={entry.identityVerification}
                      options={verificationOptions}
                      saveLabel="Сохранить верификацию"
                    />
                  </td>
                  <td>
                    {entry.participantId ? (
                      <>
                        <strong>Связан</strong>
                        <small>{entry.participantDisplayName ?? "Participant"}</small>
                        <code>{entry.participantId}</code>
                      </>
                    ) : (
                      <span className="muted">Не связан</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!entries.length ? <p className="muted">Записей по выбранным условиям нет.</p> : null}
      </section>
    </main>
  );
}
