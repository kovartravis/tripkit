import type { Flight, Stay } from "../../domain/types.js";
import type { TripExportBundle } from "../../export/markdown.js";

export interface DayItinerary {
  date: string;
  day: TripExportBundle["days"][number] | undefined;
  flightsDeparting: Flight[];
  flightsArriving: Flight[];
  staysCheckingIn: Stay[];
  staysCheckingOut: Stay[];
}

function dateOf(isoDateTime: string): string {
  return isoDateTime.slice(0, 10);
}

function dateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 24 * 60 * 60 * 1000;
  }
  return dates;
}

/**
 * Merges a trip's flights, stays, and day plans into one entry per calendar
 * date spanning the trip, so the UI can render a complete day-by-day
 * timeline even for dates that have no `Day` record yet.
 */
export function buildDayItineraries(bundle: TripExportBundle): DayItinerary[] {
  const dayByDate = new Map(bundle.days.map((day) => [day.date, day]));

  return dateRange(bundle.trip.startDate, bundle.trip.endDate).map((date) => ({
    date,
    day: dayByDate.get(date),
    flightsDeparting: bundle.flights.filter((f) => dateOf(f.departureTime) === date),
    flightsArriving: bundle.flights.filter((f) => dateOf(f.arrivalTime) === date),
    staysCheckingIn: bundle.stays.filter((s) => dateOf(s.checkIn) === date),
    staysCheckingOut: bundle.stays.filter((s) => dateOf(s.checkOut) === date),
  }));
}
