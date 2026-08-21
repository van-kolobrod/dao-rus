import { describe, expect, it } from "vitest";
import {
  resolveTelegramParticipant,
  type IdentityStore,
  type Participant,
  type TelegramIdentityProfile,
} from "./identity";

const profile: TelegramIdentityProfile = {
  subject: "tg-sub-42",
  telegramUserId: "42",
  username: "rusich",
  firstName: "Иван",
  lastName: "Иванов",
  displayName: "Иван Иванов",
  avatarUrl: null,
};

class FakeStore implements IdentityStore {
  participant: Participant | null = null;
  creates = 0;
  updates = 0;

  async findByTelegramSubject() {
    return this.participant;
  }

  async updateTelegramIdentity() {
    this.updates += 1;
  }

  async createParticipantWithTelegram() {
    this.creates += 1;
    this.participant = {
      id: "00000000-0000-0000-0000-000000000001",
      displayName: profile.displayName,
      membershipStatus: "candidate",
      createdAt: new Date("2026-08-21T00:00:00Z"),
    };
    return this.participant;
  }
}

describe("resolveTelegramParticipant", () => {
  it("creates a participant on first Telegram identity", async () => {
    const store = new FakeStore();
    const result = await resolveTelegramParticipant(store, profile);

    expect(result.created).toBe(true);
    expect(store.creates).toBe(1);
    expect(store.updates).toBe(0);
    expect(result.participant.id).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("reuses the same participant on subsequent login", async () => {
    const store = new FakeStore();
    const first = await resolveTelegramParticipant(store, profile);
    const second = await resolveTelegramParticipant(store, {
      ...profile,
      username: "rusich_new",
    });

    expect(first.participant.id).toBe(second.participant.id);
    expect(second.created).toBe(false);
    expect(store.creates).toBe(1);
    expect(store.updates).toBe(1);
  });
});
