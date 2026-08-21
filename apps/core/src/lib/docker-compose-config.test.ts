import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Docker Compose configuration", () => {
  it("passes .env to web without overriding Telegram OIDC variables", async () => {
    const compose = await readFile(
      new URL("../../docker-compose.yml", import.meta.url),
      "utf8",
    );

    expect(compose).toMatch(/web:[\s\S]*?env_file:\s*\r?\n\s*- \.env/);
    expect(compose).toContain("DATABASE_URL: postgresql://dao:${POSTGRES_PASSWORD:-dao}@db:5432/dao");

    for (const name of [
      "TELEGRAM_OIDC_CLIENT_ID",
      "TELEGRAM_OIDC_CLIENT_SECRET",
      "TELEGRAM_OIDC_REDIRECT_URI",
    ]) {
      expect(compose).not.toContain(`${name}:`);
    }
  });
});
