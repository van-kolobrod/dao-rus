import Link from "next/link";
import { redirect } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { canCreateProposal } from "@/lib/eligibility";
import { listProposals } from "@/lib/proposals";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";

type ProposalsPageProps = {
  searchParams: Promise<{ proposal_create?: string }>;
};

const createMessages: Record<string, string> = {
  created: "Предложение создано.",
  empty_title: "Введите непустой заголовок.",
  empty_body: "Введите непустой текст предложения.",
  not_eligible: "Создавать предложения может только действующий участник ДАО.",
};

export default async function ProposalsPage({ searchParams }: ProposalsPageProps) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");

  const [params, proposals] = await Promise.all([searchParams, listProposals()]);
  const createMessage = params.proposal_create
    ? createMessages[params.proposal_create]
    : null;
  const hasError = params.proposal_create
    ? params.proposal_create.startsWith("empty_") ||
      params.proposal_create === "not_eligible"
    : false;
  const proposalCreationAllowed = canCreateProposal(participant);

  return (
    <main className="shell">
      <section className="card proposalsPage">
        <div className="profileHeader">
          <div>
            <div className="eyebrow">Governance · Proposal v0.1</div>
            <h1>Предложения</h1>
            <p className="muted">Простые открытые предложения участников ДАО.</p>
          </div>
          <Link className="button secondary" href="/profile">
            К профилю
          </Link>
        </div>

        {proposalCreationAllowed ? (
          <form className="proposalForm" action="/api/proposals" method="post">
            <label htmlFor="proposal-title">Заголовок</label>
            <input id="proposal-title" name="title" required />

            <label htmlFor="proposal-body">Текст предложения</label>
            <textarea id="proposal-body" name="body" rows={6} required />

            <button className="button primary" type="submit">
              Создать предложение
            </button>

            {createMessage ? (
              <p className={hasError ? "formError" : "formNotice"}>
                {createMessage}
              </p>
            ) : null}
          </form>
        ) : (
          <p className="formNotice">
            Создавать предложения может только действующий участник ДАО.
          </p>
        )}

        <section className="proposalList">
          <h2>Все предложения</h2>
          {proposals.length ? (
            <ol>
              {proposals.map((proposal) => (
                <li key={proposal.id}>
                  <div className="proposalMeta">
                    <span>{proposal.authorDisplayName}</span>
                    <span>
                      <LocalDateTime value={proposal.createdAt.toISOString()} />
                    </span>
                    <span>Статус: открыто</span>
                  </div>
                  <h3>{proposal.title}</h3>
                  <p>{proposal.body}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">Предложений пока нет.</p>
          )}
        </section>
      </section>
    </main>
  );
}
