import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit, runStatus, USAGE } from "../src/cli/commands.js";
import { resolveDataDir, resolveDbPath, initProjectDataDir } from "../src/utils/paths.js";

describe("CLI", () => {
  const dirs: string[] = [];

  afterEach(() => {
    delete process.env.TRIPKIT_DATA_DIR;
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints usage that names the three commands", () => {
    expect(USAGE).toContain("tripkit mcp");
    expect(USAGE).toContain("tripkit init");
    expect(USAGE).toContain("tripkit status");
  });

  it("init creates a project .tripkit database and status reports it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tripkit-cli-"));
    dirs.push(dir);

    const initMsg = await runInit(dir);
    expect(initMsg).toMatch(/Initialized Tripkit data directory/);
    expect(existsSync(join(dir, ".tripkit", "tripkit.db"))).toBe(true);

    const again = await runInit(dir);
    expect(again).toMatch(/Already initialized/);

    const status = await runStatus(dir);
    expect(status).toContain(`Data directory: ${join(dir, ".tripkit")}`);
    expect(status).toContain("Trips: 0");
  });
});

describe("data dir resolution", () => {
  afterEach(() => {
    delete process.env.TRIPKIT_DATA_DIR;
  });

  it("prefers TRIPKIT_DATA_DIR over a project .tripkit folder", () => {
    const project = mkdtempSync(join(tmpdir(), "tripkit-proj-"));
    const override = mkdtempSync(join(tmpdir(), "tripkit-override-"));
    try {
      initProjectDataDir(project);
      process.env.TRIPKIT_DATA_DIR = override;
      expect(resolveDataDir(project)).toBe(override);
      expect(resolveDbPath(project)).toBe(join(override, "tripkit.db"));
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(override, { recursive: true, force: true });
    }
  });
});
