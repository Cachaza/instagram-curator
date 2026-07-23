"use client";

import { FormEvent, useEffect, useState } from "react";
import { messages, type Locale } from "@/lib/messages";

type Profile = { label: string; ytdlpValue: string; cookieFile: string };
type Configuration = {
  username: string;
  cookiesFromBrowser: string;
  instaloaderSessionFile: string;
  profiles: Profile[];
};

export function InstagramSetupForm({ locale }: { locale: Locale }) {
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const t = messages[locale];

  useEffect(() => {
    fetch("/api/setup/instagram").then((response) => response.json()).then(setConfiguration);
  }, []);

  async function submit(form: HTMLFormElement, action: "save" | "validate") {
    setLoading(true);
    setMessage("");
    const data = new FormData(form);
    const response = await fetch("/api/setup/instagram", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: data.get("username"),
        cookiesFromBrowser: data.get("cookiesFromBrowser"),
        instaloaderSessionFile: data.get("instaloaderSessionFile"),
        testUrl: data.get("testUrl") || undefined,
        action,
      }),
    });
    const body = await response.json();
    setLoading(false);
    setMessage(response.ok ? (action === "validate" ? t.instagram.valid : t.instagram.saved) : `Error: ${body.detail ?? body.error}`);
  }

  async function uploadCookies(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const response = await fetch("/api/setup/instagram/cookies", { method: "POST", body: new FormData(event.currentTarget) });
    const body = await response.json();
    setLoading(false);
    setMessage(response.ok ? "Archivo de cookies guardado." : `Error: ${body.error}`);
  }

  if (!configuration) return <p className="muted">{t.instagram.searching}</p>;
  return (
    <div>
    <form className="stack" onSubmit={(event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void submit(event.currentTarget, "save");
    }}>
      <label>{t.instagram.username}<input name="username" defaultValue={configuration.username} placeholder="tu_usuario" /></label>
      <label>{t.instagram.browserProfile}
        <select name="cookiesFromBrowser" defaultValue={configuration.cookiesFromBrowser}>
          <option value="">{t.instagram.noBrowserCookies}</option>
          {configuration.cookiesFromBrowser && !configuration.profiles.some((profile) => profile.ytdlpValue === configuration.cookiesFromBrowser) && (
            <option value={configuration.cookiesFromBrowser}>{configuration.cookiesFromBrowser}</option>
          )}
          {configuration.profiles.map((profile) => <option value={profile.ytdlpValue} key={profile.ytdlpValue}>{profile.label}</option>)}
        </select>
      </label>
      <label>{t.instagram.instaloaderSession}<input name="instaloaderSessionFile" defaultValue={configuration.instaloaderSessionFile} placeholder="/path/session-user" /></label>
      <label>{t.instagram.testReel}<input name="testUrl" type="url" placeholder="https://www.instagram.com/reel/…" /></label>
      {message && <p className="form-message">{message}</p>}
      <div className="button-row">
        <button className="primary" disabled={loading}>{t.common.save}</button>
        <button className="secondary" type="button" disabled={loading} onClick={(event) => void submit(event.currentTarget.form!, "validate")}>{t.instagram.saveAndTest}</button>
      </div>
    </form>
    <form className="stack cookie-upload" onSubmit={uploadCookies}>
      <label>Archivo de cookies de Instagram
        <input name="cookies" type="file" accept=".txt,text/plain" required />
      </label>
      <p className="fine-print">Para Docker o instalaciones remotas. Exporta cookies en formato Netscape; el archivo se guarda fuera del repositorio con permisos privados.</p>
      <button className="secondary" disabled={loading}>Subir cookies</button>
    </form>
    </div>
  );
}
