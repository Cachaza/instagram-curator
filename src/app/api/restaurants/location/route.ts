import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { GeocodingError, lookupAddress } from "@/lib/geocoding";
import { archiveRestaurantLocation, requireRestaurantPlace, saveRestaurantLocation } from "@/lib/restaurant-locations";

const identity = { publicationId: z.string().min(1), placeKey: z.string().min(1) };
const schema = z.discriminatedUnion("action", [
  z.object({ ...identity, action: z.literal("lookup"), query: z.string().trim().min(1) }),
  z.object({ ...identity, action: z.literal("confirm"), cacheKey: z.string().min(1), candidateId: z.string().min(1) }),
  z.object({ ...identity, action: z.literal("clear") }),
  z.object({ ...identity, action: z.literal("archive") }),
]);

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_location_request" }, { status: 400 });
  const input = parsed.data;
  try {
    if (input.action === "archive") {
      await archiveRestaurantLocation(input.publicationId, input.placeKey, session.user.id);
      return NextResponse.json({ ok: true });
    }
    await requireRestaurantPlace(input.publicationId, input.placeKey);
    if (input.action === "lookup") return NextResponse.json(await lookupAddress(input.query));
    await saveRestaurantLocation(input, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof GeocodingError) return NextResponse.json({ error: error.code, ...(error.status === 429 ? {
      limit: "geocoding_requests_per_second", allowed: 1, requested: "1 additional query while the current slot is occupied", correctiveAction: "Wait for Retry-After seconds and search again.",
    } : {}) }, { status: error.status, headers: error.retryAfter ? { "Retry-After": String(error.retryAfter) } : undefined });
    if (error instanceof Error && ["restaurant_place_not_found", "location_candidate_not_found"].includes(error.message)) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof Error && error.message === "location_not_pending_confirmation") return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
