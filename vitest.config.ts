import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Without this, vitest's default glob also picks up test files inside the git worktrees
    // under .claude/worktrees/ (checkouts of other branches for other agent sessions) and
    // runs their copies too, silently duplicating and slowing down every run.
    include: ["test/**/*.test.ts"],
  },
});
