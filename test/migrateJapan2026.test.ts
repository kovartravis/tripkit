import { describe, it, expect } from "vitest";
import { mapFlight, mapStay, mapPackingItem } from "../scripts/migrate-japan-2026.mjs";

describe("migrate-japan-2026 row mapping", () => {
  it("re-serializes a flight's traveler_ids JSON string through a parse/stringify round trip", () => {
    const row = { id: "flight_1", traveler_ids: '["person_1","person_2"]' };
    expect(mapFlight(row)).toEqual({ ...row, traveler_ids: '["person_1","person_2"]' });
  });

  it("defaults a flight's missing traveler_ids to an empty array", () => {
    const row = { id: "flight_1", traveler_ids: null };
    expect(mapFlight(row)).toEqual({ ...row, traveler_ids: "[]" });
  });

  it("re-serializes a stay's guest_ids JSON string through a parse/stringify round trip", () => {
    const row = { id: "stay_1", guest_ids: '["person_1"]' };
    expect(mapStay(row)).toEqual({ ...row, guest_ids: '["person_1"]' });
  });

  it("coerces a packing item's SQLite integer packed flag to a boolean", () => {
    expect(mapPackingItem({ id: "item_1", packed: 1 }).packed).toBe(true);
    expect(mapPackingItem({ id: "item_2", packed: 0 }).packed).toBe(false);
  });
});
