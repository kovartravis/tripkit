import { describe, it, expect, vi } from "vitest";
import { lookupPlace, googleMapsUrl } from "../src/integrations/nominatim.js";

function fakeFetch(rows: Array<{ display_name: string; lat: string; lon: string }>, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => rows,
  });
}

describe("lookupPlace", () => {
  it("resolves candidates with a maps link built from lat/lon", async () => {
    const fetchImpl = fakeFetch([
      { display_name: "Senso-ji, 2 Chome-3-1 Asakusa, Taito City, Tokyo, Japan", lat: "35.7148", lon: "139.7967" },
    ]);

    const results = await lookupPlace({ query: "Senso-ji" }, fetchImpl as unknown as typeof fetch);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      displayName: "Senso-ji, 2 Chome-3-1 Asakusa, Taito City, Tokyo, Japan",
      address: "Senso-ji, 2 Chome-3-1 Asakusa, Taito City, Tokyo, Japan",
      lat: 35.7148,
      lon: 139.7967,
      mapsUrl: googleMapsUrl(35.7148, 139.7967),
    });

    const requestedUrl = fetchImpl.mock.calls[0]![0] as URL;
    expect(requestedUrl.origin + requestedUrl.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(requestedUrl.searchParams.get("q")).toBe("Senso-ji");
    expect(requestedUrl.searchParams.get("limit")).toBe("3");
    expect(fetchImpl.mock.calls[0]![1].headers["User-Agent"]).toMatch(/tripkit/);
  });

  it("honors a custom limit", async () => {
    const fetchImpl = fakeFetch([
      { display_name: "A", lat: "1", lon: "2" },
      { display_name: "B", lat: "3", lon: "4" },
    ]);

    await lookupPlace({ query: "Springfield", limit: 2 }, fetchImpl as unknown as typeof fetch);

    const requestedUrl = fetchImpl.mock.calls[0]![0] as URL;
    expect(requestedUrl.searchParams.get("limit")).toBe("2");
  });

  it("throws when there are no results", async () => {
    const fetchImpl = fakeFetch([]);
    await expect(lookupPlace({ query: "nowhere at all" }, fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /No results/,
    );
  });

  it("throws when the request fails", async () => {
    const fetchImpl = fakeFetch([], false, 503);
    await expect(lookupPlace({ query: "Senso-ji" }, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/503/);
  });
});
