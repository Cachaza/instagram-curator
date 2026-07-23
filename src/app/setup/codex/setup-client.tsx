"use client";

import { useEffect, useState } from "react";

type Status = { connected?: boolean; available?: boolean; error?: string; account?: Record<string, unknown> };
type Login = { loginId: string; verificationUrl: string; userCode: string };

export function CodexSetup() {
  const [status, setStatus] = useState<Status>({});
  const [login, setLogin] = useState<Login | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/setup/codex", { cache: "no-store" });
    setStatus(await response.json());
  }
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!login || status.connected) return;
    const timer = setInterval(() => void refresh(), 2_500);
    return () => clearInterval(timer);
  }, [login, status.connected]);

  async function connect() {
    setBusy(true);
    const response = await fetch("/api/setup/codex", { method: "POST" });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return setStatus({ error: body.error });
    setLogin(body);
  }

  if (status.connected) {
    return <div className="token-panel success-panel"><h2>Codex está conectado</h2><p>La cola de análisis puede usar tu suscripción.</p><a className="primary" href="/pipeline">Ver pipeline</a></div>;
  }
  return (
    <div className="token-panel">
      {status.error && <p className="error">{status.error}</p>}
      {!login
        ? <button className="primary" disabled={busy || status.available === false} onClick={connect}>{busy ? "Iniciando…" : "Conectar con ChatGPT"}</button>
        : <>
          <p>Abre el enlace e introduce este código:</p>
          <a className="primary" href={login.verificationUrl} target="_blank" rel="noreferrer">Abrir autorización</a>
          <code className="device-code">{login.userCode}</code>
          <p className="muted">Esta página detectará automáticamente cuando termines.</p>
        </>}
    </div>
  );
}
