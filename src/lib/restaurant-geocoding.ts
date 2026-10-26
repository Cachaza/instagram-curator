import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { listContent } from "./content";
import { db, pool } from "./db";
import { GeocodingError, lookupAddress } from "./geocoding";
import { listRestaurantPlaces, saveRestaurantLocation } from "./restaurant-locations";
import type { PlaceCandidate, RestaurantPlace } from "./restaurant-places";

function normalize(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function automaticRestaurantMatch(place: Pick<RestaurantPlace, "name" | "hint">, candidates: PlaceCandidate[]) {
  if (!place.hint.trim()) return null;
  // OSM's sustenance tags. Never mistake a city/street centroid for a venue.
  const kinds = ["restaurant", "cafe", "bar", "pub", "fast_food", "food_court", "ice_cream", "biergarten"];
  const matches = candidates.filter((candidate) => {
    if (candidate.category !== "amenity" || !kinds.includes(candidate.kind ?? "")) return false;
    const [name, ...address] = candidate.label.split(",");
    if (normalize(name) !== normalize(place.name)) return false;
    const addressWords = new Set(normalize(address.join(",")).split(" "));
    const hintWords = normalize(place.hint).split(" ").filter(Boolean);
    return hintWords.length > 0 && hintWords.every((word) => addressWords.has(word));
  });
  const unique = [...new Map(matches.map((candidate) => [candidate.id, candidate])).values()];
  return unique.length === 1 ? unique[0] : null;
}

export async function restaurantGeocodingInventory() {
  const items = (await listContent({ category: "restaurant" })).filter((item) => item.reviewStatus !== "discarded");
  const places = await listRestaurantPlaces(items);
  return { items, places, pending: places.filter((place) => !place.location) };
}

export async function geocodeRestaurantLibrary(options: { runId?: string; signal?: AbortSignal; progress?: (value: Record<string, unknown>) => void } = {}) {
  const runId = options.runId ?? randomUUID();
  const owner = await pool.connect();
  const lockName = "curator-restaurant-geocoding-batch";
  let locked = false;
  const stats = { runId, total: 0, saved: 0, review: 0, notFound: 0, preserved: 0, failed: 0, missingName: 0 };
  try {
    locked = (await owner.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) acquired", [lockName])).rows[0].acquired;
    if (!locked) throw new Error("Restaurant geocoding capacity: allowed 1 batch; requested 1 additional batch. Wait for the running batch to finish.");
    const { items, places, pending } = await restaurantGeocodingInventory();
    stats.total = pending.length;
    const publish = () => options.progress?.({ ...stats });
    async function event(publicationId: string, status: string, detail: Record<string, unknown> = {}) {
      await db.execute("INSERT INTO pipeline_events(publication_id,stage,event_type,message) SELECT id,'geocoding',$2,$3 FROM publications WHERE id=$1", [publicationId, status, JSON.stringify({ runId, ...detail })]);
    }
    for (const place of pending) await event(place.publicationId, "queued", { placeKey: place.key });
    for (const item of items.filter((item) => !places.some((place) => place.publicationId === item.id))) {
      stats.missingName++;
      await event(item.id, "needs_review", { reason: "missing_place_name" });
    }
    publish();
    for (let index = 0; index < pending.length; index++) {
      const place = pending[index];
      try {
        options.signal?.throwIfAborted();
        const query = [place.name, place.hint].filter(Boolean).join(", ");
        let result: Awaited<ReturnType<typeof lookupAddress>>;
        for (;;) {
          try { result = await lookupAddress(query); break; }
          catch (error) {
            if (!(error instanceof GeocodingError) || !["geocoding_capacity", "geocoding_rate_limit"].includes(error.code) || !error.retryAfter) throw error;
            // Use the provider-policy-derived Retry-After; no independent timer.
            await wait(error.retryAfter * 1000, undefined, { signal: options.signal });
          }
        }
        const candidate = automaticRestaurantMatch(place, result.candidates);
        if (candidate) {
          const saved = await saveRestaurantLocation({ publicationId: place.publicationId, placeKey: place.key, cacheKey: result.cacheKey, candidateId: candidate.id }, `system:geocoding:${runId}`, { onlyIfUnmapped: true });
          if (saved) stats.saved++; else stats.preserved++;
          await event(place.publicationId, saved ? "located" : "preserved", { placeKey: place.key, candidateId: candidate.id });
        } else {
          const status = result.candidates.length ? "needs_review" : "not_found";
          if (result.candidates.length) stats.review++; else stats.notFound++;
          await event(place.publicationId, status, { placeKey: place.key, cacheKey: result.cacheKey, candidates: result.candidates.length });
        }
        publish();
      } catch (error) {
        stats.failed++;
        const reason = error instanceof GeocodingError ? error.code : options.signal?.aborted ? "cancelled" : "geocoding_batch_failed";
        await event(place.publicationId, "failed", { placeKey: place.key, reason });
        for (const remaining of pending.slice(index + 1)) await event(remaining.publicationId, "deferred", { placeKey: remaining.key, reason });
        publish();
        throw new Error(`Restaurant geocoding stopped at stage geocoding: ${reason}. Completed results are saved; inspect pipeline_events and retry after correcting the cause.`);
      }
    }
    if (items[0]) await event(items[0].id, "batch_completed", { ...stats });
    return stats;
  } finally {
    if (locked) await owner.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lockName]);
    owner.release();
  }
}
