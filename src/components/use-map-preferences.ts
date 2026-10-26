"use client";

import { useSyncExternalStore } from "react";
import { readMapPreferences, type MapPreferences } from "@/lib/map-preferences";

const changeEvent = "curator-map-preferences";
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changeEvent, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(changeEvent, listener); };
}

export function mapPreferencesChanged() { window.dispatchEvent(new Event(changeEvent)); }

export function useMapPreferences(userId: string) {
  const snapshot = useSyncExternalStore(subscribe, () => {
    try { return JSON.stringify(readMapPreferences(window.localStorage, userId)); }
    catch { return JSON.stringify({ provider: "osm", token: "" }); }
  }, () => null);
  const preferences: MapPreferences = snapshot ? JSON.parse(snapshot) : { provider: "osm", token: "" };
  return { ...preferences, ready: snapshot !== null, snapshot };
}
