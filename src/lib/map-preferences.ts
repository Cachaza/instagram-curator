export type MapPreferences = { provider: "osm" | "mapbox"; token: string };
type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function validMapboxPublicToken(token: string) {
  return /^pk\.[A-Za-z0-9_.-]+$/.test(token);
}

export function readMapPreferences(storage: PreferenceStorage, userId: string): MapPreferences {
  const saved = storage.getItem(`curator-mapbox-public-token:${userId}`) ?? "";
  const token = validMapboxPublicToken(saved) ? saved : "";
  const provider = storage.getItem(`curator-map-provider:${userId}`);
  // Existing public tokens remain usable when moving their controls to Settings.
  return { provider: provider === "osm" ? "osm" : token ? "mapbox" : "osm", token };
}

export function saveMapPreferences(storage: PreferenceStorage, userId: string, preferences: MapPreferences) {
  if (preferences.token && !validMapboxPublicToken(preferences.token)) throw new Error("invalid_mapbox_public_token");
  if (preferences.token) storage.setItem(`curator-mapbox-public-token:${userId}`, preferences.token);
  else storage.removeItem(`curator-mapbox-public-token:${userId}`);
  storage.setItem(`curator-map-provider:${userId}`, preferences.provider);
}
