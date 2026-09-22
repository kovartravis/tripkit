import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TripkitRepository } from "../../db/repository.js";
import {
  dayUpsertInputSchema,
  dayPlanSetInputSchema,
  dateSchema,
  idSchema,
} from "../../domain/types.js";
import { NotFoundError } from "../../db/repository.js";
import { safeHandler } from "../toolResult.js";
import { z } from "zod";

const dayGetInputSchema = z
  .object({
    id: idSchema.optional(),
    tripId: idSchema.optional(),
    date: dateSchema.optional(),
  })
  .refine((v) => v.id || (v.tripId && v.date), {
    message: "provide either id, or tripId + date",
  });

const dayListInputSchema = z.object({
  tripId: idSchema,
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
});

export function registerDayTools(server: McpServer, repo: TripkitRepository): void {
  server.registerTool(
    "tripkit_day_upsert",
    {
      title: "Upsert day",
      description: "Create or update a calendar day on a trip (date, title, notes). Idempotent on trip + date.",
      inputSchema: dayUpsertInputSchema,
    },
    safeHandler((args) => repo.upsertDay(args)),
  );

  server.registerTool(
    "tripkit_day_plan_set",
    {
      title: "Set day plan",
      description:
        "Replace a day's plan with an ordered list of time-boxed blocks (activity|meal|transit|buffer|other). Rejects overlapping blocks.",
      inputSchema: dayPlanSetInputSchema,
    },
    safeHandler(({ dayId, blocks }) => repo.setDayPlan(dayId, blocks)),
  );

  server.registerTool(
    "tripkit_day_get",
    {
      title: "Get day",
      description: "Fetch a single day (with its plan) by id, or by tripId + date.",
      inputSchema: dayGetInputSchema,
    },
    safeHandler(async ({ id, tripId, date }) => {
      const day = id ? await repo.getDay(id) : await repo.getDayByDate(tripId!, date!);
      if (!day) throw new NotFoundError("day", id ?? `${tripId}/${date}`);
      return day;
    }),
  );

  server.registerTool(
    "tripkit_day_list",
    {
      title: "List days",
      description: "List a trip's days (with plans), optionally scoped to a date range.",
      inputSchema: dayListInputSchema,
    },
    safeHandler(({ tripId, startDate, endDate }) => repo.listDays(tripId, { startDate, endDate })),
  );
}
