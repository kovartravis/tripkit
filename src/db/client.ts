import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { ensureDataDir } from "../utils/paths.js";
import { SCHEMA_SQL } from "./schema.js";

/**
 * Opens (creating if needed) the SQLite ledger at `dbPath` and applies the
 * schema. `node:sqlite` is Node's built-in synchronous driver (stable in
 * Node >= 22), which keeps Tripkit dependency-free of native bindings.
 */
export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") {
    ensureDataDir(dirname(dbPath));
  }
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  return db;
}

export type { DatabaseSync };
