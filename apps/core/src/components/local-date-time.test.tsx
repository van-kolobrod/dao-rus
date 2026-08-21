import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatLocalDateTime, LocalDateTime } from "./local-date-time";

describe("LocalDateTime", () => {
  it("formats the same instant in the selected local timezone", () => {
    const value = "2026-08-21T12:00:00.000Z";

    expect(formatLocalDateTime(value, "UTC")).toContain("12:00");
    expect(formatLocalDateTime(value, "Asia/Yekaterinburg")).toContain("17:00");
  });

  it("renders a stable server fallback without displaying raw ISO text", () => {
    const value = "2026-08-21T16:35:15.987Z";
    const html = renderToString(<LocalDateTime value={value} />);

    expect(html).toContain(`dateTime="${value}"`);
    expect(html).toContain(">…</time>");
  });
});
