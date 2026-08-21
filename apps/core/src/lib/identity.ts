import type { MembershipStatus } from "./config";

export type Participant = {
  id: string;
  displayName: string;
  membershipStatus: MembershipStatus;
  createdAt: Date;
};

export type TelegramIdentityProfile = {
  subject: string;
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  avatarUrl: string | null;
};

export interface IdentityStore {
  findByTelegramSubject(subject: string): Promise<Participant | null>;
  updateTelegramIdentity(participantId: string, profile: TelegramIdentityProfile): Promise<void>;
  createParticipantWithTelegram(profile: TelegramIdentityProfile): Promise<Participant>;
}

export async function resolveTelegramParticipant(
  store: IdentityStore,
  profile: TelegramIdentityProfile,
): Promise<{ participant: Participant; created: boolean }> {
  const existing = await store.findByTelegramSubject(profile.subject);
  if (existing) {
    await store.updateTelegramIdentity(existing.id, profile);
    return { participant: existing, created: false };
  }

  const participant = await store.createParticipantWithTelegram(profile);
  return { participant, created: true };
}
