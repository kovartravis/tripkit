import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { openDatabase } from "../src/db/client.js";
import { SqliteTripkitRepository } from "../src/db/sqliteRepository.js";
import { createTripkitMcpServer } from "../src/mcp/server.js";
import { TRIPKIT_TOOL_NAMES } from "../src/mcp/toolNames.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DatabaseSync } from "node:sqlite";

function textPayload(result: CallToolResult): unknown {
  const item = result.content.find((c) => c.type === "text");
  const text = item && item.type === "text" ? item.text : "";
  if (result.isError) {
    throw new Error(text);
  }
  return JSON.parse(text);
}

describe("MCP server", () => {
  let db: DatabaseSync;
  let repo: SqliteTripkitRepository;
  let client: Client;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    repo = new SqliteTripkitRepository(db);
    const server = createTripkitMcpServer(repo);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "tripkit-test", version: "0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    repo.close();
  });

  it("lists the locked tool surface", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TRIPKIT_TOOL_NAMES].sort());
  });

  it("creates a trip, adds a flight, and exports markdown", async () => {
    const trip = textPayload(
      await client.callTool({
        name: "tripkit_trip_create",
        arguments: {
          name: "Japan 2026",
          startDate: "2026-04-10",
          endDate: "2026-04-20",
          homeTimezone: "America/Los_Angeles",
        },
      }),
    ) as { id: string; name: string };

    expect(trip.name).toBe("Japan 2026");

    const flight = textPayload(
      await client.callTool({
        name: "tripkit_flight_add",
        arguments: {
          tripId: trip.id,
          airline: "ANA",
          flightNumber: "NH7",
          departureAirport: "sfo",
          arrivalAirport: "HND",
          departureTime: "2026-04-10T13:15:00-07:00",
          arrivalTime: "2026-04-11T16:50:00+09:00",
        },
      }),
    ) as { departureAirport: string };
    expect(flight.departureAirport).toBe("SFO");

    const exported = textPayload(
      await client.callTool({
        name: "tripkit_export_markdown",
        arguments: { tripId: trip.id },
      }),
    ) as { markdown: string };
    expect(exported.markdown).toContain("# Japan 2026");
    expect(exported.markdown).toContain("ANA NH7");
  });

  it("rejects overlapping day-plan blocks as a tool error", async () => {
    const trip = textPayload(
      await client.callTool({
        name: "tripkit_trip_create",
        arguments: {
          name: "Japan 2026",
          startDate: "2026-04-10",
          endDate: "2026-04-20",
          homeTimezone: "America/Los_Angeles",
        },
      }),
    ) as { id: string };

    const day = textPayload(
      await client.callTool({
        name: "tripkit_day_upsert",
        arguments: { tripId: trip.id, date: "2026-04-12" },
      }),
    ) as { id: string };

    const result = await client.callTool({
      name: "tripkit_day_plan_set",
      arguments: {
        dayId: day.id,
        blocks: [
          { startTime: "09:00", endTime: "10:30", type: "activity", title: "A" },
          { startTime: "10:00", endTime: "11:00", type: "activity", title: "B" },
        ],
      },
    });
    expect(result.isError).toBe(true);
    const text = result.content.find((c) => c.type === "text");
    expect(text && text.type === "text" ? text.text : "").toMatch(/overlap/i);
  });
});
