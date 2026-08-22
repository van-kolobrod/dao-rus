import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { importTelegramRosterSnapshotWithDatabase } from "../src/lib/telegram-roster";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function main() {
  const snapshotPath = process.argv[2];
  if (!snapshotPath) {
    throw new Error(
      "Usage: npm run telegram:roster:import -- <snapshot.json>",
    );
  }

  const absolutePath = path.resolve(snapshotPath);
  const source = await fs.readFile(absolutePath, "utf8");
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(source);
  } catch {
    throw new Error(`Invalid JSON snapshot: ${absolutePath}`);
  }

  const { pool } = await import("../src/lib/db");
  try {
    const result = await importTelegramRosterSnapshotWithDatabase(
      pool,
      snapshot,
    );
    console.log(
      `Imported ${result.entriesProcessed} roster entries observed at ${result.observedAt}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
