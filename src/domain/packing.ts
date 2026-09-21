import type { ClimateHint } from "./types.js";

export interface PackingRuleContext {
  nights: number;
  travelerCount: number;
  climateHints: ClimateHint[];
  activityHints: string[];
}

export interface GeneratedPackingItem {
  category: string;
  label: string;
  quantity: number;
}

const CLIMATE_ITEMS: Record<ClimateHint, GeneratedPackingItem[]> = {
  cold: [
    { category: "clothing", label: "insulated jacket", quantity: 1 },
    { category: "clothing", label: "thermal base layer", quantity: 2 },
    { category: "accessories", label: "gloves", quantity: 1 },
    { category: "accessories", label: "warm hat", quantity: 1 },
  ],
  mild: [
    { category: "clothing", label: "light jacket", quantity: 1 },
    { category: "clothing", label: "long-sleeve shirt", quantity: 2 },
  ],
  hot: [
    { category: "clothing", label: "sunglasses", quantity: 1 },
    { category: "toiletries", label: "sunscreen", quantity: 1 },
    { category: "clothing", label: "hat", quantity: 1 },
  ],
  rainy: [
    { category: "clothing", label: "rain jacket", quantity: 1 },
    { category: "accessories", label: "compact umbrella", quantity: 1 },
  ],
  mixed: [
    { category: "clothing", label: "packable layer", quantity: 1 },
    { category: "accessories", label: "compact umbrella", quantity: 1 },
  ],
};

const BASE_ITEMS: GeneratedPackingItem[] = [
  { category: "documents", label: "passport / ID", quantity: 1 },
  { category: "documents", label: "travel insurance info", quantity: 1 },
  { category: "electronics", label: "phone charger", quantity: 1 },
  { category: "toiletries", label: "toothbrush", quantity: 1 },
  { category: "toiletries", label: "toothpaste", quantity: 1 },
];

const ACTIVITY_ITEMS: Record<string, GeneratedPackingItem[]> = {
  hiking: [
    { category: "gear", label: "hiking boots", quantity: 1 },
    { category: "gear", label: "refillable water bottle", quantity: 1 },
  ],
  swimming: [
    { category: "clothing", label: "swimsuit", quantity: 1 },
    { category: "accessories", label: "quick-dry towel", quantity: 1 },
  ],
  business: [
    { category: "clothing", label: "business attire", quantity: 1 },
    { category: "electronics", label: "laptop + charger", quantity: 1 },
  ],
  formal: [{ category: "clothing", label: "formal outfit", quantity: 1 }],
  camping: [
    { category: "gear", label: "headlamp", quantity: 1 },
    { category: "gear", label: "sleeping bag liner", quantity: 1 },
  ],
};

/**
 * Deterministic v1 packing generator: combines fixed base items,
 * per-climate-hint items, per-activity-hint items, and clothing
 * quantities scaled by night count and traveler count.
 */
export function generatePackingItems(
  ctx: PackingRuleContext,
): GeneratedPackingItem[] {
  const items = new Map<string, GeneratedPackingItem>();
  const add = (item: GeneratedPackingItem, multiplier = 1) => {
    const key = `${item.category}::${item.label}`;
    const quantity = item.quantity * multiplier;
    const existing = items.get(key);
    if (existing) {
      existing.quantity = Math.max(existing.quantity, quantity);
    } else {
      items.set(key, { ...item, quantity });
    }
  };

  for (const item of BASE_ITEMS) add(item, ctx.travelerCount);

  for (const hint of ctx.climateHints) {
    for (const item of CLIMATE_ITEMS[hint]) add(item, ctx.travelerCount);
  }

  for (const activity of ctx.activityHints) {
    const key = activity.toLowerCase().trim();
    const activityItems = ACTIVITY_ITEMS[key];
    if (activityItems) {
      for (const item of activityItems) add(item, ctx.travelerCount);
    }
  }

  const nights = Math.max(1, ctx.nights);
  const underwearPerNight = Math.min(nights, 10);
  const socksPerNight = Math.min(nights, 10);
  add(
    { category: "clothing", label: "underwear", quantity: underwearPerNight },
    ctx.travelerCount,
  );
  add(
    { category: "clothing", label: "socks", quantity: socksPerNight },
    ctx.travelerCount,
  );
  add(
    {
      category: "clothing",
      label: "t-shirt / top",
      quantity: Math.min(Math.ceil(nights / 2) + 1, 7),
    },
    ctx.travelerCount,
  );

  return [...items.values()].sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.label.localeCompare(b.label),
  );
}
