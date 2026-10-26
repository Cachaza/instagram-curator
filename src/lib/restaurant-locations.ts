import type { ContentItem } from "./content";
import { getContent } from "./content";
import { db, transaction, type Database } from "./db";
import { candidateSchema } from "./geocoding";
import { restaurantPlaceQuery, restaurantPlaces, type RestaurantPlace } from "./restaurant-places";
import { z } from "zod";

// Review state belongs to the saved pin, rather than the provider candidate.
const savedLocationSchema = candidateSchema.extend({ needsReconfirmation: z.boolean().optional() });

export async function listRestaurantPlaces(items: ContentItem[]): Promise<RestaurantPlace[]> {
  const places = items.flatMap(restaurantPlaces);
  if (!places.length) return [];
  const rows = await db.all("SELECT publication_id,place_key,location_json FROM restaurant_locations WHERE publication_id=ANY($1::text[])", [[...new Set(places.map((place) => place.publicationId))]]);
  const locations = new Map(rows.map((row) => {
    const saved = savedLocationSchema.parse(JSON.parse(row.location_json));
    return [JSON.stringify([row.publication_id, row.place_key]), saved.needsReconfirmation ? null : candidateSchema.parse(saved)] as const;
  }));
  return places.map((place) => ({ ...place, location: locations.get(JSON.stringify([place.publicationId, place.key])) ?? null }));
}

export async function reconfirmChangedRestaurantLocations(before: ContentItem | null, after: ContentItem, database: Database) {
  const rows = await database.all("SELECT place_key,location_json FROM restaurant_locations WHERE publication_id=$1", [after.id]);
  const previous = new Map((before ? restaurantPlaces(before) : []).map((place) => [place.key, restaurantPlaceQuery(place)]));
  const current = new Map(restaurantPlaces(after).map((place) => [place.key, restaurantPlaceQuery(place)]));
  for (const row of rows) {
    if (!previous.has(row.place_key) || previous.get(row.place_key) !== current.get(row.place_key)) {
      const saved = savedLocationSchema.parse(JSON.parse(row.location_json));
      await database.execute("UPDATE restaurant_locations SET location_json=$1 WHERE publication_id=$2 AND place_key=$3", [JSON.stringify({ ...saved, needsReconfirmation: true }), after.id, row.place_key]);
    }
  }
}

export async function listRestaurantLocationsNeedingConfirmation() {
  const rows = await db.all("SELECT publication_id,place_key,location_json FROM restaurant_locations");
  const changes = [];
  for (const row of rows) {
    const item = await getContent(row.publication_id);
    if (!item || item.reviewStatus === "discarded") continue;
    const saved = savedLocationSchema.parse(JSON.parse(row.location_json));
    if (saved.needsReconfirmation || !restaurantPlaces(item).some((place) => place.key === row.place_key)) changes.push({ publicationId: item.id, placeKey: row.place_key, location: candidateSchema.parse(saved) });
  }
  return changes;
}

export async function requireRestaurantPlace(publicationId: string, key: string, database: Database = db) {
  const item = await getContent(publicationId, database);
  const place = item && restaurantPlaces(item).find((entry) => entry.key === key);
  if (!place) throw new Error("restaurant_place_not_found");
  return place;
}

export async function saveRestaurantLocation(input: { publicationId: string; placeKey: string; cacheKey?: string; candidateId?: string }, userId: string, options: { onlyIfUnmapped?: boolean; expectedQuery?: string } = {}) {
  return transaction(async (tx) => {
    // Reviews and deletion lock this same publication. Recheck current source
    // identity after acquiring it so a changed address never receives a stale pin.
    await tx.one("SELECT id FROM publications WHERE id=$1 FOR UPDATE", [input.publicationId]);
    const currentPlace = await requireRestaurantPlace(input.publicationId, input.placeKey, tx);
    if (options.expectedQuery !== undefined && restaurantPlaceQuery(currentPlace) !== options.expectedQuery) throw new Error("restaurant_place_evidence_changed");
    if (options.onlyIfUnmapped && await tx.one("SELECT 1 FROM restaurant_locations WHERE publication_id=$1 AND place_key=$2", [input.publicationId, input.placeKey])) return false;
    if (!input.cacheKey || !input.candidateId) {
      await tx.execute("DELETE FROM restaurant_locations WHERE publication_id=$1 AND place_key=$2", [input.publicationId, input.placeKey]);
      return true;
    }
    const cached = await tx.one("SELECT candidates_json,last_error FROM restaurant_geocodes WHERE cache_key=$1", [input.cacheKey]);
    const candidate = cached && !cached.last_error && z.array(candidateSchema).parse(JSON.parse(cached.candidates_json)).find((entry) => entry.id === input.candidateId);
    if (!candidate) throw new Error("location_candidate_not_found");
    await tx.execute(`INSERT INTO restaurant_locations(publication_id,place_key,location_json,confirmed_by_user_id) VALUES ($1,$2,$3,$4)
      ON CONFLICT(publication_id,place_key) DO UPDATE SET location_json=excluded.location_json,confirmed_by_user_id=excluded.confirmed_by_user_id,confirmed_at=CURRENT_TIMESTAMP`, [input.publicationId, input.placeKey, JSON.stringify(candidate), userId]);
    return true;
  });
}
