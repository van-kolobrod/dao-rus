import { describe, expect, it } from "vitest";
import { activityEventLabel } from "./activity";

describe("activityEventLabel", () => {
  it("returns a human-readable label for known events", () => {
    expect(activityEventLabel("participant.logged_in")).toBe("Вход в DAO Core");
    expect(activityEventLabel("participant.profile_updated")).toBe(
      "Изменение имени профиля",
    );
    expect(activityEventLabel("proposal.created")).toBe("Создание предложения");
    expect(activityEventLabel("participant_registry.membership_status_changed")).toBe(
      "Изменение статуса членства в реестре",
    );
    expect(activityEventLabel("participant_registry.identity_verification_changed")).toBe(
      "Изменение верификации в реестре",
    );
  });

  it("falls back to the raw event type for unknown events", () => {
    expect(activityEventLabel("proposal.updated")).toBe("proposal.updated");
  });
});
