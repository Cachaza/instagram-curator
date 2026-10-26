import type { ContentItem } from "./content";

export type PlaceCandidate = { id: string; label: string; latitude: number; longitude: number };
export type RestaurantPlace = {
  publicationId: string;
  key: string;
  name: string;
  hint: string;
  location: PlaceCandidate | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// Identity includes the source hint: a corrected address must not reuse an old pin.
export function restaurantPlaces(item: Pick<ContentItem, "id" | "category" | "entities" | "reviewStatus">): RestaurantPlace[] {
  if (item.category !== "restaurant" || item.reviewStatus === "discarded") return [];
  const entities = item.entities;
  const mentions: unknown[] = Array.isArray(entities.mentioned_places) ? entities.mentioned_places : [];
  const primaryName = text(entities.restaurant_name);
  const primary = primaryName ? [{ name: primaryName, location_hint: entities.address_as_stated }] : [];
  const places = new Map<string, RestaurantPlace>();
  for (const value of [...primary, ...mentions]) {
    const entry = record(value);
    const name = text(entry.name) || (typeof value === "string" && !Object.keys(entry).length ? text(value) : "");
    if (!name) continue;
    const hint = text(entry.location_hint) || text(entry.address_as_stated);
    const key = JSON.stringify([name, hint]);
    places.set(key, { publicationId: item.id, key, name, hint, location: null });
  }
  return [...places.values()];
}

export function validCoordinates(latitude: number, longitude: number) {
  // Geographic coordinate bounds, in degrees.
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
}

export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = Math.PI / 180;
  const latitude = (b.latitude - a.latitude) * radians;
  const longitude = (b.longitude - a.longitude) * radians;
  const h = Math.sin(latitude / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(longitude / 2) ** 2;
  // IUGG mean Earth radius (metres); great-circle distance, not driving distance.
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
