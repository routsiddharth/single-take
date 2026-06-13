import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { SCHEMA_SQL } from "./ddl";

const DB_PATH = process.env.SINGLETAKE_DB ?? "./data/singletake.db";

// Keep a single connection across HMR reloads in dev.
const globalForDb = globalThis as unknown as {
  __singleTakeSqlite?: Database.Database;
};

function createConnection(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  ensureSchema(sqlite);
  return sqlite;
}

export const sqlite: Database.Database =
  globalForDb.__singleTakeSqlite ?? createConnection();
if (process.env.NODE_ENV !== "production") globalForDb.__singleTakeSqlite = sqlite;

export const db = drizzle(sqlite, { schema });

/**
 * Idempotent DDL so `next dev` / `tsx seed` work with zero migration steps.
 * (Mirrors src/db/schema.ts — drizzle-kit push is also wired for parity.)
 */
function ensureSchema(s: Database.Database) {
  s.exec(SCHEMA_SQL);
}
