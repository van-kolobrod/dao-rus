import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import {
  RegistryFieldEditor,
  registryFeedbackFromUrl,
} from "./registry-field-editor";

describe("RegistryFieldEditor", () => {
  it("renders a clear field label, Russian values and explicit save action", () => {
    const html = renderToString(
      <RegistryFieldEditor
        telegramUserId="184229790"
        field="membership_status"
        label="Статус в ДАО"
        value="unknown"
        options={[
          { value: "unknown", label: "Не определён" },
          { value: "participant", label: "Участник" },
        ]}
        saveLabel="Сохранить статус"
      />,
    );

    expect(html).toContain("Статус в ДАО");
    expect(html).toContain("Не определён");
    expect(html).toContain("Участник");
    expect(html).toContain("Сохранить статус");
  });

  it("maps server redirect results to visible row feedback", () => {
    expect(
      registryFeedbackFromUrl(
        "https://core.example/admin/participants?registry_update=updated",
      ),
    ).toEqual({ kind: "success", message: "Сохранено" });
    expect(
      registryFeedbackFromUrl(
        "https://core.example/admin/participants?registry_update=invalid",
      ).kind,
    ).toBe("error");
  });
});
