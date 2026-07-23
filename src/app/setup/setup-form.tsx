"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { messages, type Locale } from "@/lib/messages";

export function SetupForm({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shareToken, setShareToken] = useState("");
  const t = messages[locale];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uiLocale: data.get("uiLocale"),
        analysisLocale: data.get("analysisLocale"),
        transcriptionModel: data.get("transcriptionModel"),
        openaiApiKey: data.get("openaiApiKey") || undefined,
      }),
    });
    const body = await response.json();
    setLoading(false);
    if (!response.ok) return setError(body.error ?? t.common.error);
    if (body.shareToken) return setShareToken(body.shareToken);
    router.push("/import");
    router.refresh();
  }

  if (shareToken) {
    return (
      <div className="token-panel">
        <h2>{t.setup.tokenTitle}</h2>
        <p className="muted">{t.setup.tokenHelp}</p>
        <code>{shareToken}</code>
        <button className="primary" onClick={() => router.push("/import")}>{t.setup.goToImport}</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="stack setup-form">
      <div className="two-columns">
        <label>{t.setup.uiLanguage}<select name="uiLocale" defaultValue={locale}><option value="es">Español</option><option value="en">English</option></select></label>
        <label>{t.setup.analysisLanguage}<select name="analysisLocale" defaultValue={locale}><option value="es">Español</option><option value="en">English</option></select></label>
      </div>
      <label>{t.setup.apiKey}<input name="openaiApiKey" type="password" placeholder="sk-…" minLength={8} /></label>
      <label>{t.setup.transcriptionModel}<input name="transcriptionModel" defaultValue="whisper-1" required /></label>
      <p className="fine-print">{t.setup.secretHelp}</p>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={loading}>{loading ? t.common.saving : t.setup.finish}</button>
    </form>
  );
}
