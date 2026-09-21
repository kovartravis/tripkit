import envPaths from "env-paths";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PROJECT_DIR_NAME = ".tripkit";
const DB_FILE_NAME = "tripkit.db";

/**
 * Resolves where the SQLite ledger lives:
 * - a `.tripkit/` directory under the current working directory, if one
 *   has been initialized (via `tripkit init`), takes precedence, or
 * - a per-user data directory (XDG-style on Linux, Application Support on
 *   macOS, %LOCALAPPDATA% on Windows) shared across projects.
 */
export function resolveDataDir(cwd: string = process.cwd()): string {
  const projectDir = join(cwd, PROJECT_DIR_NAME);
  if (existsSync(projectDir)) {
    return projectDir;
  }
  return envPaths("tripkit", { suffix: "" }).data;
}

export function resolveDbPath(cwd: string = process.cwd()): string {
  return join(resolveDataDir(cwd), DB_FILE_NAME);
}

export function ensureDataDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function initProjectDataDir(cwd: string = process.cwd()): string {
  const projectDir = join(cwd, PROJECT_DIR_NAME);
  ensureDataDir(projectDir);
  return projectDir;
}
