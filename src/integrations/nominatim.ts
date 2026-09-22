import type { PlaceCandidate, PlaceLookupInput } from "../domain/types.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "tripkit-mcp/0.1 (+https://github.com/kovartravis/tripkit)";

export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

interface NominatimRow {
  display_name: string;
  lat: string;
  lon: string;
}

/**
 * Resolves a free-text place name to real addresses via OpenStreetMap's Nominatim
 * search API — no API key needed, but usage-policy-limited to light, ~1 req/sec
 * traffic with a descriptive User-Agent, which is what a personal trip ledger
 * generates in practice.
 */
export async function lookupPlace(
  input: PlaceLookupInput,
  fetchImpl: typeof fetch = fetch,
): Promise<PlaceCandidate[]> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", input.query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(input.limit ?? 3));

  const res = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Place lookup failed: ${res.status} ${res.statusText}`);
  }

  const rows = (await res.json()) as NominatimRow[];
  if (rows.length === 0) {
    throw new Error(`No results for "${input.query}"`);
  }

  return rows.map((row) => {
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    return {
      displayName: row.display_name,
      address: row.display_name,
      lat,
      lon,
      mapsUrl: googleMapsUrl(lat, lon),
    };
  });
}
