import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { ensureDataDir } from "../utils/paths.js";
import { SCHEMA_SQL } from "./schema.js";

/**
 * Opens (creating if needed) the SQLite ledger at `dbPath` and applies the
 * schema. `node:sqlite` is Node's built-in synchronous driver (stable in
 * Node >= 22), which keeps Tripkit dependency-free of native bindings.
 *
 * WAL + busy_timeout match the Neuron local-store pattern so a CLI status
 * call and an MCP server can share the same file without immediately
 * colliding. Foreign keys are enforced per connection.
 */
export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") {
    ensureDataDir(dirname(dbPath));
  }
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Connection may already be aborted; surface the original error.
    }
    throw error;
  }
}

export type { DatabaseSync };
