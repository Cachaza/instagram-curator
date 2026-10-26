"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import { distanceMeters, type RestaurantPlace } from "@/lib/restaurant-places";
import { restaurantMessages } from "@/lib/restaurant-messages";
import type { Locale } from "@/lib/messages";
import "leaflet/dist/leaflet.css";

export type BrowserPosition = { latitude: number; longitude: number; accuracy: number };

export default function RestaurantMapCanvas({ places, position, selected, locale, tileUrl, mapboxToken }: {
  places: RestaurantPlace[]; position: BrowserPosition | null; selected: RestaurantPlace | null; locale: Locale; tileUrl: string; mapboxToken?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const selection = useRef<RestaurantPlace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = restaurantMessages[locale];

  useEffect(() => {
    let disposed = false;
    let map: LeafletMap | undefined;
    import("leaflet").then((L) => {
      if (disposed || !container.current) return;
      map = L.map(container.current, { scrollWheelZoom: false, zoomControl: false });
      L.control.zoom({ zoomInTitle: t.zoomIn, zoomOutTitle: t.zoomOut }).addTo(map);
      setError(null);
      mapRef.current = map;
      // OSM's standard raster layer and Leaflet's official quick-start use zoom 19.
      const url = mapboxToken ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}?access_token=${encodeURIComponent(mapboxToken)}` : tileUrl;
      L.tileLayer(url, { maxZoom: 19, ...(mapboxToken ? { tileSize: 512, zoomOffset: -1 } : {}), attribution: mapboxToken
        ? '<a href="https://www.mapbox.com/about/maps/">© Mapbox</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> <a href="https://apps.mapbox.com/feedback/">Improve this map</a>'
        : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' })
        .on("tileerror", () => { if (!disposed) setError(t.tilesError); }).addTo(map);
      const pins = places.filter((place) => place.location);
      for (const place of pins) {
        const location = place.location!;
        const label = document.createElement("span");
        label.textContent = `${place.name}: ${location.label}`;
        L.circleMarker([location.latitude, location.longitude]).bindPopup(label).addTo(map);
      }
      if (position) {
        L.circle([position.latitude, position.longitude], { radius: position.accuracy }).bindTooltip(t.yourLocation).addTo(map);
        const nearest = [...pins].sort((a, b) => distanceMeters(position, a.location!) - distanceMeters(position, b.location!))[0];
        const bounds = L.circle([position.latitude, position.longitude], { radius: position.accuracy }).getBounds();
        if (nearest) bounds.extend([nearest.location!.latitude, nearest.location!.longitude]);
        map.fitBounds(bounds);
      } else if (pins.length) {
        map.fitBounds(L.latLngBounds(pins.map((place) => [place.location!.latitude, place.location!.longitude])));
      } else map.fitWorld();
      const focus = places.find((place) => place.key === selection.current?.key && place.publicationId === selection.current?.publicationId);
      if (focus?.location) map.setView([focus.location.latitude, focus.location.longitude], map.getMaxZoom());
    }).catch(() => { if (!disposed) setError(t.mapError); });
    return () => { disposed = true; mapRef.current = null; map?.remove(); };
  }, [places, position, t, tileUrl, mapboxToken]);

  useEffect(() => {
    selection.current = selected;
    const place = places.find((entry) => entry.key === selected?.key && entry.publicationId === selected?.publicationId);
    if (place?.location && mapRef.current) mapRef.current.setView([place.location.latitude, place.location.longitude], mapRef.current.getMaxZoom());
  }, [selected, places]);

  return <><div className="restaurant-map-frame"><div className="restaurant-map" ref={container} role="region" aria-label={t.map} />{mapboxToken && <a className="mapbox-wordmark" href="https://www.mapbox.com/" aria-label="Mapbox" />}</div>{error && <p role="status">{error}</p>}</>;
}
