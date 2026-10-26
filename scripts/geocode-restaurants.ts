import { restaurantPlaceQuery } from "../src/lib/restaurant-places";
import { pool, authPool } from "../src/lib/db";
import { geocodeRestaurantLibrary, restaurantGeocodingInventory } from "../src/lib/restaurant-geocoding";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
try {
  if (!apply) {
    const { items, places, pending } = await restaurantGeocodingInventory();
    console.log(JSON.stringify({ mode: "preview", publications: items.length, places: places.length, unmapped: pending.length, uniqueQueries: new Set(pending.map((place) => restaurantPlaceQuery(place))).size, action: "Run with --apply for a one-time lookup. Only unambiguous venue/name/address matches become pins; other results need review." }));
  } else {
    const runIdIndex = args.indexOf("--run-id");
    const summary = await geocodeRestaurantLibrary({ runId: runIdIndex >= 0 ? args[runIdIndex + 1] : undefined, signal: controller.signal, progress: (value) => console.log(JSON.stringify(value)) });
    console.log(JSON.stringify({ status: "completed", ...summary }));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "geocoding_batch_failed");
  process.exitCode = 1;
} finally { await pool.end(); await authPool.end(); }
