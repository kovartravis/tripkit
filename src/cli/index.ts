#!/usr/bin/env node
import { runInit, runMcp, runStatus, USAGE } from "./commands.js";

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);

  switch (command) {
    case "mcp":
      await runMcp();
      return;
    case "init": {
      console.log(await runInit());
      return;
    }
    case "status": {
      console.log(await runStatus());
      return;
    }
    case "--help":
    case "-h":
    case "--version":
    case "-v":
    case undefined:
      console.log(USAGE);
      return;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
