import { describe, expect, it } from "vitest";
import { allowedDevOriginsFromBaseUrl } from "../../next.config";

describe("Next.js development origins", () => {
  it("allows only the hostname configured as APP_BASE_URL", () => {
    expect(
      allowedDevOriginsFromBaseUrl("https://dao-lab.trycloudflare.com"),
    ).toEqual(["dao-lab.trycloudflare.com"]);
  });

  it("ignores missing or invalid APP_BASE_URL values", () => {
    expect(allowedDevOriginsFromBaseUrl(undefined)).toEqual([]);
    expect(allowedDevOriginsFromBaseUrl("not a URL")).toEqual([]);
  });
});
