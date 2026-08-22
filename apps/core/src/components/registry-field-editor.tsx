"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type RegistryFieldEditorProps = {
  telegramUserId: string;
  field: "membership_status" | "identity_verification";
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  saveLabel: string;
};

type Feedback = {
  kind: "success" | "notice" | "error";
  message: string;
};

export function registryFeedbackFromUrl(url: string): Feedback {
  const status = new URL(url, "http://localhost").searchParams.get("registry_update");
  if (status === "updated") {
    return { kind: "success", message: "Сохранено" };
  }
  if (status === "unchanged") {
    return { kind: "notice", message: "Без изменений" };
  }
  if (status === "invalid") {
    return { kind: "error", message: "Не удалось сохранить: некорректное значение." };
  }
  if (status === "not_found") {
    return { kind: "error", message: "Не удалось сохранить: запись roster не найдена." };
  }
  return { kind: "error", message: "Не удалось подтвердить сохранение." };
}

export function RegistryFieldEditor({
  telegramUserId,
  field,
  label,
  value,
  options,
  saveLabel,
}: RegistryFieldEditorProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const inputId = `${field}-${telegramUserId}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const form = event.currentTarget;
    const body = new FormData(form);
    setSaving(true);
    setFeedback(null);

    try {
      const response = await fetch(form.action, {
        method: "POST",
        body,
      });
      if (!response.ok) {
        setFeedback({
          kind: "error",
          message:
            response.status === 403
              ? "Недостаточно прав для сохранения."
              : "Не удалось сохранить. Попробуйте ещё раз.",
        });
        return;
      }

      const result = registryFeedbackFromUrl(response.url);
      setFeedback(result);
      if (result.kind === "success") {
        window.setTimeout(() => router.refresh(), 1200);
      }
    } catch {
      setFeedback({
        kind: "error",
        message: "Не удалось сохранить. Проверьте соединение и повторите попытку.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="registryAction"
      action="/api/admin/participants"
      method="post"
      onSubmit={submit}
    >
      <input type="hidden" name="telegram_user_id" value={telegramUserId} />
      <input type="hidden" name="field" value={field} />
      <label htmlFor={inputId}>{label}</label>
      <div>
        <select id={inputId} name="value" defaultValue={value} disabled={saving}>
          {options.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={saving}>
          {saving ? "Сохраняем…" : saveLabel}
        </button>
      </div>
      {feedback ? (
        <span
          className={`registryFeedback ${feedback.kind}`}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </span>
      ) : null}
    </form>
  );
}
