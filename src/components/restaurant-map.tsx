"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { distanceMeters, type PlaceCandidate, type RestaurantPlace } from "@/lib/restaurant-places";
import { restaurantMessages } from "@/lib/restaurant-messages";
import type { Locale } from "@/lib/messages";
import type { BrowserPosition } from "./restaurant-map-canvas";

const MapCanvas = dynamic(() => import("./restaurant-map-canvas"), { ssr: false });

function PlaceAddress({ place, locale }: { place: RestaurantPlace; locale: Locale }) {
  const t = restaurantMessages[locale];
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ cacheKey: string; candidates: PlaceCandidate[] } | null>(null);

  async function request(action: "lookup" | "confirm" | "clear", extra: Record<string, string> = {}) {
    setBusy(true); setError("");
    if (action === "lookup") setResult(null);
    try {
      const response = await fetch("/api/restaurants/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, publicationId: place.publicationId, placeKey: place.key, ...extra }) });
      const body = await response.json();
      if (!response.ok) {
        setError(response.status === 429 ? t.rateLimit : response.status === 404 ? t.stale : t.failed);
        return;
      }
      if (action === "lookup") setResult(body);
      else { setResult(null); router.refresh(); }
    } catch { setError(t.failed); }
    finally { setBusy(false); }
  }

  function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void request("lookup", { query: String(new FormData(event.currentTarget).get("query") ?? "") });
  }

  return <details className="place-address">
    <summary aria-label={`${t.locatePlace}: ${place.name}`}>{t.locatePlace}</summary>
    <form onSubmit={lookup}>
      <label>{t.query}<input name="query" required defaultValue={[place.name, place.hint].filter(Boolean).join(", ")} /></label>
      <p>{t.geocodingHelp}</p>
      <button className="secondary" disabled={busy}>{busy ? t.searching : t.locatePlace}</button>
    </form>
    <div role="status">{error || (result?.candidates.length === 0 ? t.noResults : "")}</div>
    {result && result.candidates.length > 0 && <div><p>{t.choose}</p><ul className="candidate-list">{result.candidates.map((candidate) => <li key={candidate.id}><span>{candidate.label}</span><button className="secondary" aria-label={`${t.confirm}: ${candidate.label}`} disabled={busy} onClick={() => request("confirm", { cacheKey: result.cacheKey, candidateId: candidate.id })}>{t.confirm}</button></li>)}</ul></div>}
    {place.location && <button className="secondary" disabled={busy} onClick={() => request("clear")}>{t.clear}</button>}
  </details>;
}

export function RestaurantMap({ places, locale, tileUrl, userId }: { places: RestaurantPlace[]; locale: Locale; tileUrl: string; userId: string }) {
  const t = restaurantMessages[locale];
  const [position, setPosition] = useState<BrowserPosition | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [selected, setSelected] = useState<RestaurantPlace | null>(null);
  const [provider, setProvider] = useState<"osm" | "mapbox">("osm");
  const [mapboxToken, setMapboxToken] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [tokenError, setTokenError] = useState("");
  const storageKey = `curator-mapbox-public-token:${userId}`;
  const mapped = places.filter((place) => place.location);
  const sorted = position ? [...places].sort((a, b) => (a.location ? distanceMeters(position, a.location) : Infinity) - (b.location ? distanceMeters(position, b.location) : Infinity)) : places;

  function locate() {
    setLocationError("");
    if (!navigator.geolocation) { setLocationError(t.locationError); return; }
    setLocating(true); setSelected(null);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setPosition({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }); setLocating(false);
    }, () => { setLocationError(t.locationError); setLocating(false); });
  }

  function chooseProvider(value: string) {
    setTokenError("");
    if (value === "osm") { setProvider("osm"); return; }
    try {
      const saved = localStorage.getItem(storageKey) ?? "";
      setTokenDraft(saved); setMapboxToken(saved.startsWith("pk.") ? saved : "");
    } catch { setTokenDraft(""); setMapboxToken(""); }
    setProvider("mapbox");
  }

  function saveToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = tokenDraft.trim();
    if (!/^pk\.[A-Za-z0-9_.-]+$/.test(token)) { setTokenError(t.invalidToken); return; }
    setMapboxToken(token); setTokenError("");
    try { localStorage.setItem(storageKey, token); } catch { setTokenError(t.tokenNotSaved); }
  }

  return <>
    <div className="map-tools"><button className="primary" disabled={locating} onClick={locate}>{locating ? t.locating : t.locate}</button><label>{t.mapProvider}<select value={provider} onChange={(event) => chooseProvider(event.target.value)}><option value="osm">OpenStreetMap</option><option value="mapbox">Mapbox</option></select></label><span>{mapped.length} {t.mapped} · {places.length - mapped.length} {t.unmapped}</span></div>
    <p className="source-caveat">{t.locationHelp}</p><p role="status">{locationError}</p>
    {provider === "mapbox" && <form className="map-token-form" onSubmit={saveToken}><label>{t.publicToken}<input type="password" autoComplete="off" value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} placeholder="pk.…" required /></label><p>{t.tokenHelp}</p><button className="secondary">{t.useMapbox}</button><button className="secondary" type="button" onClick={() => { setMapboxToken(""); setTokenDraft(""); setProvider("osm"); try { localStorage.removeItem(storageKey); } catch { /* Public token is already cleared from memory. */ } }}>{t.forgetToken}</button><p role="status">{tokenError}</p></form>}
    {(!mapped.length && !position) && <p>{t.noPins}</p>}
    {(mapped.length > 0 || position) && <MapCanvas places={places} position={position} selected={selected} locale={locale} tileUrl={tileUrl} mapboxToken={provider === "mapbox" ? mapboxToken : undefined} />}
    <div className="restaurant-list">{sorted.map((place) => <article className="restaurant-place" key={JSON.stringify([place.publicationId, place.key])}>
      <h2>{place.name}</h2>{place.hint && <p>{place.hint}</p>}
      <p>{place.location ? t.confirmed : t.pending}{position && place.location && <> · {new Intl.NumberFormat(locale, { style: "unit", unit: "meter", maximumFractionDigits: 0 }).format(distanceMeters(position, place.location))}</>}</p>
      {place.location && <p>{place.location.label}</p>}
      <div className="filter-actions"><Link href={`/publications/${encodeURIComponent(place.publicationId)}`}>{t.open}</Link>{place.location && <><button className="secondary" onClick={() => setSelected({ ...place })}>{t.show}</button><a href={`https://www.google.com/maps/dir/?api=1&destination=${place.location.latitude},${place.location.longitude}`} target="_blank" rel="noreferrer">{t.directions}</a></>}</div>
      <PlaceAddress place={place} locale={locale} />
    </article>)}</div>
    <p className="source-caveat"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">{t.attribution}</a></p>
  </>;
}
