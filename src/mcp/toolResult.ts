import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function ok(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function fail(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

/** Wraps a tool handler so thrown errors become MCP tool errors instead of protocol errors. */
export function safeHandler<Args>(
  fn: (args: Args) => unknown | Promise<unknown>,
): (args: Args) => Promise<CallToolResult> {
  return async (args: Args) => {
    try {
      return ok(await fn(args));
    } catch (error) {
      return fail(error);
    }
  };
}
