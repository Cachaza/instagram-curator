import { createHash } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db";
import { validCoordinates, type PlaceCandidate } from "./restaurant-places";

export const candidateSchema = z.object({
  id: z.string().min(1), label: z.string().min(1), latitude: z.number(), longitude: z.number(), category: z.string().optional(), kind: z.string().optional(),
}).refine((value) => validCoordinates(value.latitude, value.longitude));

export class GeocodingError extends Error {
  constructor(public code: string, public status = 502, public retryAfter?: number) { super(code); }
}

export function geocodingCacheKey(endpoint: URL, query: string) {
  // The endpoint may contain private provider credentials. Return only an opaque
  // digest to clients, never its URL or the query/endpoint identity in plaintext.
  return createHash("sha256").update(JSON.stringify([endpoint.toString(), query.trim().replace(/\s+/gu, " ")])).digest("hex");
}

export function parseCandidates(value: unknown): PlaceCandidate[] {
  if (!Array.isArray(value)) throw new Error("invalid_geocoding_response");
  return value.map((entry) => {
    const raw = z.object({ osm_type: z.string(), osm_id: z.union([z.number(), z.string()]), display_name: z.string(), lat: z.string().min(1), lon: z.string().min(1), category: z.string().optional(), class: z.string().optional(), type: z.string().optional() }).parse(entry);
    return candidateSchema.parse({ id: `${raw.osm_type}/${raw.osm_id}`, label: raw.display_name, latitude: Number(raw.lat), longitude: Number(raw.lon), ...((raw.category || raw.class) ? { category: raw.category || raw.class } : {}), ...(raw.type ? { kind: raw.type } : {}) });
  });
}

export async function lookupAddress(query: string, options: { signal?: AbortSignal } = {}): Promise<{ cacheKey: string; candidates: PlaceCandidate[] }> {
  options.signal?.throwIfAborted();
  const endpoint = new URL(process.env.CURATOR_GEOCODING_URL || "https://nominatim.openstreetmap.org/search");
  const serviceUrl = endpoint.toString();
  const normalized = query.trim().replace(/\s+/gu, " ");
  const cacheKey = geocodingCacheKey(endpoint, normalized);
  // Nominatim allows at most one request per second across the application.
  // Hold the shared lock throughout fetch, and measure from completion, so
  // delayed commits or stalled hosts cannot send reserved requests together.
  const intervalMs = 1000;
  const result = await transaction(async (tx) => {
    const cached = await tx.one("SELECT candidates_json,last_error FROM restaurant_geocodes WHERE cache_key=$1", [cacheKey]);
    if (cached && !cached.last_error) return { cacheKey, candidates: z.array(candidateSchema).parse(JSON.parse(cached.candidates_json)) };
    const lock = await tx.one("SELECT pg_try_advisory_xact_lock(hashtextextended('curator-geocoding',0)) acquired");
    if (!lock?.acquired) throw new GeocodingError("geocoding_capacity", 429, intervalMs / 1000);
    const service = await tx.one(`SELECT EXTRACT(EPOCH FROM (clock_timestamp()-requested_at))*1000 elapsed_ms
      FROM geocoding_service_requests WHERE service_url=$1`, [serviceUrl]);
    if (service && Number(service.elapsed_ms) < intervalMs) throw new GeocodingError("geocoding_rate_limit", 429, Math.ceil((intervalMs - Number(service.elapsed_ms)) / 1000));

    endpoint.searchParams.set("q", normalized);
    endpoint.searchParams.set("format", "jsonv2");
    let candidates: PlaceCandidate[];
    try {
      const response = await fetch(endpoint, { headers: { "User-Agent": "InstagramCuratorOSS (https://github.com/Cachaza/instagram-curator)", Accept: "application/json" }, cache: "no-store", redirect: "error", signal: options.signal });
      if (!response.ok) throw new Error(`geocoding_http_${response.status}`);
      candidates = parseCandidates(await response.json());
    } catch (error) {
      // Do not persist fetch error text: upstream errors can contain a private
      // URL/token. Keep the stage and a non-sensitive cause for diagnostics.
      const cause = error instanceof Error && /^geocoding_http_\d+$/.test(error.message) ? error.message : "geocoding_lookup_failed";
      await tx.execute(`INSERT INTO restaurant_geocodes(cache_key,last_error) VALUES ($1,$2)
        ON CONFLICT(cache_key) DO UPDATE SET last_error=excluded.last_error,updated_at=CURRENT_TIMESTAMP`, [cacheKey, cause]);
      await recordCompletion();
      // Return the error so failure and throttle state commit before throwing.
      return { error: new GeocodingError("geocoding_failed") };
    }
    await tx.execute(`INSERT INTO restaurant_geocodes(cache_key,candidates_json,last_error) VALUES ($1,$2,NULL)
      ON CONFLICT(cache_key) DO UPDATE SET candidates_json=excluded.candidates_json,last_error=NULL,updated_at=CURRENT_TIMESTAMP`, [cacheKey, JSON.stringify(candidates)]);
    await recordCompletion();
    return { cacheKey, candidates };

    async function recordCompletion() {
      await tx.execute(`INSERT INTO geocoding_service_requests(service_url,requested_at) VALUES ($1,clock_timestamp())
        ON CONFLICT(service_url) DO UPDATE SET requested_at=clock_timestamp()`, [serviceUrl]);
    }
  });
  if ("error" in result) throw result.error;
  return result;
}
