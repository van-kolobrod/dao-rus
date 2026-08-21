import { Pool } from "pg";

const globalForPool = globalThis as typeof globalThis & { __daoPool?: Pool };

function makePool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return new Pool({ connectionString, max: 10 });
}

export const pool = globalForPool.__daoPool ?? makePool();

if (process.env.NODE_ENV !== "production") {
  globalForPool.__daoPool = pool;
}
