"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/messages";
import { saveMapPreferences, validMapboxPublicToken, type MapPreferences } from "@/lib/map-preferences";
import { restaurantMessages } from "@/lib/restaurant-messages";
import { mapPreferencesChanged, useMapPreferences } from "./use-map-preferences";

export function MapSettings({ userId, locale }: { userId: string; locale: Locale }) {
  const preferences = useMapPreferences(userId);
  return preferences.ready ? <MapSettingsForm key={userId} userId={userId} locale={locale} initial={preferences} /> : null;
}

function MapSettingsForm({ userId, locale, initial }: { userId: string; locale: Locale; initial: MapPreferences }) {
  const t = restaurantMessages[locale];
  const [provider, setProvider] = useState(initial.provider);
  const [token, setToken] = useState(initial.token);
  const [status, setStatus] = useState("");
  const [invalid, setInvalid] = useState(false);
  const tokenInput = useRef<HTMLInputElement>(null);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const publicToken = token.trim();
    if (provider === "mapbox" && !validMapboxPublicToken(publicToken)) { setInvalid(true); tokenInput.current?.focus(); return; }
    setInvalid(false);
    try {
      saveMapPreferences(localStorage, userId, { provider, token: validMapboxPublicToken(publicToken) ? publicToken : initial.token });
      mapPreferencesChanged();
      setStatus(t.settingsSaved);
    } catch { setStatus(t.settingsNotSaved); }
  }

  function forget() {
    try {
      saveMapPreferences(localStorage, userId, { provider: "osm", token: "" });
      setProvider("osm"); setToken(""); setInvalid(false); setStatus(t.tokenForgotten); mapPreferencesChanged();
    } catch { setStatus(t.settingsNotSaved); }
  }

  return <form className="map-token-form" onSubmit={save}>
    <label>{t.mapProvider}<select value={provider} onChange={(event) => { setProvider(event.target.value as MapPreferences["provider"]); setStatus(""); }}><option value="osm">OpenStreetMap</option><option value="mapbox">Mapbox</option></select></label>
    {provider === "mapbox" && <><label htmlFor="mapbox-token">{t.publicToken}</label><input ref={tokenInput} id="mapbox-token" type="password" autoComplete="off" value={token} onChange={(event) => { setToken(event.target.value); setInvalid(false); setStatus(""); }} placeholder="pk.…" aria-invalid={invalid} aria-describedby={`mapbox-token-help${invalid ? " mapbox-token-error" : ""}`} required /><p id="mapbox-token-help">{t.tokenHelp}</p>{invalid && <p id="mapbox-token-error" role="alert">{t.invalidToken}</p>}</>}
    <p>{t.searchProviderHelp}</p>
    <div className="filter-actions"><button className="primary">{t.saveSettings}</button>{token && <button className="secondary" type="button" onClick={forget}>{t.forgetToken}</button>}</div>
    <p role="status">{status}</p>
  </form>;
}
