import type { ContentItem } from "./content";
import { getContent } from "./content";
import { db, transaction, type Database } from "./db";
import { candidateSchema } from "./geocoding";
import { restaurantPlaces, type RestaurantPlace } from "./restaurant-places";
import { z } from "zod";

export async function listRestaurantPlaces(items: ContentItem[]): Promise<RestaurantPlace[]> {
  const places = items.flatMap(restaurantPlaces);
  if (!places.length) return [];
  const rows = await db.all("SELECT publication_id,place_key,location_json FROM restaurant_locations WHERE publication_id=ANY($1::text[])", [[...new Set(places.map((place) => place.publicationId))]]);
  const locations = new Map(rows.map((row) => [JSON.stringify([row.publication_id, row.place_key]), candidateSchema.parse(JSON.parse(row.location_json))]));
  return places.map((place) => ({ ...place, location: locations.get(JSON.stringify([place.publicationId, place.key])) ?? null }));
}

export async function requireRestaurantPlace(publicationId: string, key: string, database: Database = db) {
  const item = await getContent(publicationId, database);
  const place = item && restaurantPlaces(item).find((entry) => entry.key === key);
  if (!place) throw new Error("restaurant_place_not_found");
  return place;
}

export async function saveRestaurantLocation(input: { publicationId: string; placeKey: string; cacheKey?: string; candidateId?: string }, userId: string, options: { onlyIfUnmapped?: boolean } = {}) {
  return transaction(async (tx) => {
    // Reviews and deletion lock this same publication. Recheck current source
    // identity after acquiring it so a changed address never receives a stale pin.
    await tx.one("SELECT id FROM publications WHERE id=$1 FOR UPDATE", [input.publicationId]);
    await requireRestaurantPlace(input.publicationId, input.placeKey, tx);
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
