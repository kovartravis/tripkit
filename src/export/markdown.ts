import type { Day, Flight, PackingItem, Person, Stay, Trip } from "../domain/types.js";
import type { TripkitRepository } from "../db/repository.js";
import { NotFoundError } from "../db/repository.js";

export interface TripExportBundle {
  trip: Trip;
  people: Person[];
  flights: Flight[];
  stays: Stay[];
  days: Day[];
  packingItems: PackingItem[];
}

export async function loadTripExportBundle(repo: TripkitRepository, tripId: string): Promise<TripExportBundle> {
  const trip = await repo.getTrip(tripId);
  if (!trip) throw new NotFoundError("trip", tripId);
  const [people, flights, stays, days, packingItems] = await Promise.all([
    repo.listPeople(tripId),
    repo.listFlights(tripId),
    repo.listStays(tripId),
    repo.listDays(tripId),
    repo.listPackingItems(tripId),
  ]);
  return { trip, people, flights, stays, days, packingItems };
}

function heading(text: string, level = 2): string {
  return `${"#".repeat(level)} ${text}`;
}

function renderPeopleSection(people: Person[]): string[] {
  if (people.length === 0) return [];
  const lines = [heading("Travelers"), ""];
  for (const p of people) {
    const role = p.role ? ` (${p.role})` : "";
    lines.push(`- ${p.name}${role}`);
  }
  lines.push("");
  return lines;
}

function renderFlightsSection(flights: Flight[]): string[] {
  if (flights.length === 0) return [];
  const lines = [heading("Flights"), ""];
  for (const f of flights) {
    lines.push(`- **${f.airline} ${f.flightNumber}**: ${f.departureAirport} → ${f.arrivalAirport}`);
    lines.push(`  - Departs: ${f.departureTime}`);
    lines.push(`  - Arrives: ${f.arrivalTime}`);
    if (f.confirmation) lines.push(`  - Confirmation: ${f.confirmation}`);
    if (f.seat) lines.push(`  - Seat: ${f.seat}`);
  }
  lines.push("");
  return lines;
}

function renderStaysSection(stays: Stay[]): string[] {
  if (stays.length === 0) return [];
  const lines = [heading("Stays"), ""];
  for (const s of stays) {
    lines.push(`- **${s.name}**`);
    lines.push(`  - Check-in: ${s.checkIn}`);
    lines.push(`  - Check-out: ${s.checkOut}`);
    if (s.address) lines.push(`  - Address: ${s.address}`);
    if (s.confirmation) lines.push(`  - Confirmation: ${s.confirmation}`);
  }
  lines.push("");
  return lines;
}

export function renderDayMarkdown(day: Day, level = 2): string[] {
  const title = day.title ? `${day.date} — ${day.title}` : day.date;
  const lines = [heading(title, level), ""];
  if (day.notes) {
    lines.push(day.notes, "");
  }
  if (day.blocks.length === 0) {
    lines.push("_No plan yet._", "");
    return lines;
  }
  for (const block of day.blocks) {
    const place = block.place ? ` — ${block.place}` : "";
    lines.push(`- \`${block.startTime}–${block.endTime}\` **${block.title}**${place} _(${block.type})_`);
    if (block.notes) lines.push(`  - ${block.notes}`);
  }
  lines.push("");
  return lines;
}

function renderDaysSection(days: Day[]): string[] {
  if (days.length === 0) return [];
  const lines = [heading("Day Plans"), ""];
  for (const day of days) {
    lines.push(...renderDayMarkdown(day, 3));
  }
  return lines;
}

function renderPackingSection(items: PackingItem[]): string[] {
  if (items.length === 0) return [];
  const lines = [heading("Packing List"), ""];
  const byCategory = new Map<string, PackingItem[]>();
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }
  for (const [category, categoryItems] of [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`**${category}**`, "");
    for (const item of categoryItems) {
      const box = item.packed ? "[x]" : "[ ]";
      const qty = item.quantity > 1 ? ` (×${item.quantity})` : "";
      lines.push(`- ${box} ${item.label}${qty}`);
    }
    lines.push("");
  }
  return lines;
}

export function renderTripMarkdown(bundle: TripExportBundle): string {
  const { trip } = bundle;
  const lines: string[] = [
    heading(trip.name, 1),
    "",
    `${trip.startDate} → ${trip.endDate} · ${trip.homeTimezone}`,
    "",
  ];
  if (trip.notes) {
    lines.push(trip.notes, "");
  }
  lines.push(
    ...renderPeopleSection(bundle.people),
    ...renderFlightsSection(bundle.flights),
    ...renderStaysSection(bundle.stays),
    ...renderDaysSection(bundle.days),
    ...renderPackingSection(bundle.packingItems),
  );
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * Exports either the whole trip, or a single day within it when `dayId`
 * is provided.
 */
export async function exportMarkdown(repo: TripkitRepository, tripId: string, dayId?: string): Promise<string> {
  const bundle = await loadTripExportBundle(repo, tripId);
  if (!dayId) return renderTripMarkdown(bundle);

  const day = bundle.days.find((d) => d.id === dayId);
  if (!day) throw new NotFoundError("day", dayId);
  const lines = [heading(`${bundle.trip.name}: ${day.date}`, 1), "", ...renderDayMarkdown(day, 2)];
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
