import type { TripkitRepository } from "../db/repository.js";
import { NotFoundError } from "../db/repository.js";
import { loadTripExportBundle } from "./markdown.js";

function toUtcStamp(iso: string): string {
  const d = new Date(iso);
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function toFloatingStamp(date: string, time: string): string {
  return `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
}

function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function foldLine(line: string): string {
  // RFC 5545 75-octet line folding, using simple char-length as an approximation.
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  chunks.push(rest);
  return chunks.join("\r\n");
}

function vevent(fields: {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  dtstamp: string;
  dtstart: string;
  dtend: string;
}): string[] {
  const lines = [
    "BEGIN:VEVENT",
    foldLine(`UID:${fields.uid}`),
    foldLine(`DTSTAMP:${fields.dtstamp}`),
    foldLine(`DTSTART:${fields.dtstart}`),
    foldLine(`DTEND:${fields.dtend}`),
    foldLine(`SUMMARY:${escapeText(fields.summary)}`),
  ];
  if (fields.description) lines.push(foldLine(`DESCRIPTION:${escapeText(fields.description)}`));
  if (fields.location) lines.push(foldLine(`LOCATION:${escapeText(fields.location)}`));
  lines.push("END:VEVENT");
  return lines;
}

/**
 * Exports flights, stays, and (when scoped to a single day) day-plan
 * blocks as an RFC 5545 calendar. Flight/stay times carry a UTC offset
 * and are emitted in UTC; day-plan block times are local clock times
 * with no offset, so they're emitted as floating time on that day.
 */
export function exportIcs(repo: TripkitRepository, tripId: string, dayId?: string): string {
  const bundle = loadTripExportBundle(repo, tripId);
  const stamp = toUtcStamp(new Date().toISOString());
  const events: string[] = [];

  if (dayId) {
    const day = bundle.days.find((d) => d.id === dayId);
    if (!day) throw new NotFoundError("day", dayId);
    for (const block of day.blocks) {
      events.push(
        ...vevent({
          uid: `${block.id}@tripkit`,
          summary: block.title,
          description: block.notes,
          location: block.place,
          dtstamp: stamp,
          dtstart: toFloatingStamp(day.date, block.startTime),
          dtend: toFloatingStamp(day.date, block.endTime),
        }),
      );
    }
  } else {
    for (const f of bundle.flights) {
      events.push(
        ...vevent({
          uid: `${f.id}@tripkit`,
          summary: `${f.airline} ${f.flightNumber}: ${f.departureAirport} \u2192 ${f.arrivalAirport}`,
          description: [f.confirmation ? `Confirmation: ${f.confirmation}` : "", f.seat ? `Seat: ${f.seat}` : "", f.notes ?? ""]
            .filter(Boolean)
            .join("\n"),
          dtstamp: stamp,
          dtstart: toUtcStamp(f.departureTime),
          dtend: toUtcStamp(f.arrivalTime),
        }),
      );
    }
    for (const s of bundle.stays) {
      events.push(
        ...vevent({
          uid: `${s.id}@tripkit`,
          summary: s.name,
          description: [s.confirmation ? `Confirmation: ${s.confirmation}` : "", s.notes ?? ""].filter(Boolean).join("\n"),
          location: s.address,
          dtstamp: stamp,
          dtstart: toUtcStamp(s.checkIn),
          dtend: toUtcStamp(s.checkOut),
        }),
      );
    }
    for (const day of bundle.days) {
      for (const block of day.blocks) {
        events.push(
          ...vevent({
            uid: `${block.id}@tripkit`,
            summary: block.title,
            description: block.notes,
            location: block.place,
            dtstamp: stamp,
            dtstart: toFloatingStamp(day.date, block.startTime),
            dtend: toFloatingStamp(day.date, block.endTime),
          }),
        );
      }
    }
  }

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tripkit//tripkit//EN",
    "CALSCALE:GREGORIAN",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
