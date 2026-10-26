import { describe, expect, test } from "bun:test";
import { distanceMeters, restaurantPlaces, validCoordinates } from "../src/lib/restaurant-places";
import { geocodingCacheKey, parseCandidates } from "../src/lib/geocoding";

const source = { id: "synthetic", category: "restaurant", reviewStatus: "unreviewed", entities: {} };

describe("restaurant map source data", () => {
  test("includes primary and all mentioned restaurants, deduplicating identical mentions", () => {
    const result = restaurantPlaces({ ...source, entities: { restaurant_name: "Example", address_as_stated: "Madrid", mentioned_places: [{ name: "Example", location_hint: "Madrid" }, { name: "Other", location_hint: "Sevilla" }, "Third"] } });
    expect(result.map(({ name, hint }) => [name, hint])).toEqual([["Example", "Madrid"], ["Other", "Sevilla"], ["Third", ""]]);
    expect(result.every((place) => place.location === null)).toBe(true);
  });

  test("handles legacy encoded objects without displaying JSON as a restaurant name", () => {
    const result = restaurantPlaces({ ...source, entities: { mentioned_places: ['{"name":"Example","location_hint":"Madrid"}', null, {}, 42] } });
    expect(result.map((place) => place.name)).toEqual(["Example"]);
  });

  test("corrected source hints invalidate identity; recipes and discarded publications have no map places", () => {
    const before = restaurantPlaces({ ...source, entities: { mentioned_places: [{ name: "Example", location_hint: "Madrid" }] } });
    const after = restaurantPlaces({ ...source, entities: { mentioned_places: [{ name: "Example", location_hint: "Sevilla" }] } });
    expect(before[0].key).not.toBe(after[0].key);
    expect(restaurantPlaces({ ...source, category: "recipe", entities: { restaurant_name: "Example" } })).toEqual([]);
    expect(restaurantPlaces({ ...source, reviewStatus: "discarded", entities: { restaurant_name: "Example" } })).toEqual([]);
  });

  test("validates geographic bounds and rejects nonfinite coordinates", () => {
    expect(validCoordinates(90, -180)).toBe(true);
    expect(validCoordinates(91, 0)).toBe(false);
    expect(validCoordinates(0, 181)).toBe(false);
    expect(validCoordinates(NaN, 0)).toBe(false);
    expect(validCoordinates(0, Infinity)).toBe(false);
  });

  test("distance is symmetric, zero at the same point and finite across the date line", () => {
    const a = { latitude: 0, longitude: 179 };
    const b = { latitude: 0, longitude: -179 };
    expect(distanceMeters(a, a)).toBe(0);
    expect(distanceMeters(a, b)).toBe(distanceMeters(b, a));
    expect(distanceMeters(a, b)).toBeLessThan(distanceMeters(a, { latitude: 0, longitude: 0 }));
  });

  test("opaque cache keys do not expose configured provider credentials", () => {
    const endpoint = new URL("https://geocoder.example.invalid/search?token=synthetic-private-provider-token");
    const key = geocodingCacheKey(endpoint, "Example Madrid");
    expect(key).not.toContain("synthetic-private-provider-token");
    expect(key).not.toContain("geocoder.example.invalid");
    expect(geocodingCacheKey(endpoint, " Example   Madrid ")).toBe(key);
    expect(geocodingCacheKey(new URL("https://different.example.invalid/search"), "Example Madrid")).not.toBe(key);
  });

  test("parses provider coordinates and rejects malformed success payloads", () => {
    expect(parseCandidates([{ osm_type: "node", osm_id: 1, display_name: "Synthetic address", lat: "40", lon: "-3" }])).toEqual([{ id: "node/1", label: "Synthetic address", latitude: 40, longitude: -3 }]);
    expect(() => parseCandidates([{ osm_type: "node", osm_id: 1, display_name: "Bad", lat: "", lon: "0" }])).toThrow();
    expect(() => parseCandidates([{ osm_type: "node", osm_id: 1, display_name: "Bad", lat: "91", lon: "0" }])).toThrow();
    expect(() => parseCandidates({ error: "provider failed" })).toThrow();
  });
});
