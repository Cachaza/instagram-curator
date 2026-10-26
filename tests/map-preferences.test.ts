import { expect, test } from "bun:test";
import { readMapPreferences, saveMapPreferences } from "../src/lib/map-preferences";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test("map preferences retain existing public tokens and remain isolated across accounts", () => {
  const store = storage();
  store.setItem("curator-mapbox-public-token:first", "pk.synthetic");
  expect(readMapPreferences(store, "first")).toEqual({ provider: "mapbox", token: "pk.synthetic" });
  expect(readMapPreferences(store, "second")).toEqual({ provider: "osm", token: "" });
  saveMapPreferences(store, "first", { provider: "osm", token: "pk.synthetic" });
  expect(readMapPreferences(store, "first")).toEqual({ provider: "osm", token: "pk.synthetic" });
  saveMapPreferences(store, "second", { provider: "mapbox", token: "pk.second" });
  saveMapPreferences(store, "first", { provider: "osm", token: "" });
  expect(readMapPreferences(store, "first")).toEqual({ provider: "osm", token: "" });
  expect(readMapPreferences(store, "second")).toEqual({ provider: "mapbox", token: "pk.second" });
});

test("invalid and secret tokens cannot be stored or used; storage failures reach the form", () => {
  const store = storage();
  expect(() => saveMapPreferences(store, "first", { provider: "mapbox", token: "sk.synthetic" })).toThrow("invalid_mapbox_public_token");
  store.setItem("curator-mapbox-public-token:first", "sk.synthetic");
  store.setItem("curator-map-provider:first", "mapbox");
  expect(readMapPreferences(store, "first")).toEqual({ provider: "osm", token: "" });
  const denied = { ...store, setItem: () => { throw new Error("storage_denied"); } };
  expect(() => saveMapPreferences(denied, "second", { provider: "mapbox", token: "pk.synthetic" })).toThrow("storage_denied");
});
