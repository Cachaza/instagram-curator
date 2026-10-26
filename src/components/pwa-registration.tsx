"use client";

import { useEffect, useState } from "react";
import { observeServiceWorkerUpdates } from "@/lib/pwa-registration";
import type { Locale } from "@/lib/messages";

const copy = {
  es: { error: "No se pudo preparar la app para usarla sin conexión.", retry: "Reintentar" },
  en: { error: "Could not prepare the app for offline use.", retry: "Try again" },
};

export function PwaRegistration({ locale }: { locale: Locale }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !window.isSecureContext || !("serviceWorker" in navigator)) return;
    let disposed = false;
    let stopObserving: (() => void) | undefined;
    navigator.serviceWorker.register(`/sw.js?locale=${locale}`, { scope: "/", updateViaCache: "none" }).then((result) => {
      if (disposed) return;
      stopObserving = observeServiceWorkerUpdates(result, (error) => {
        if (disposed) return;
        if (error) console.error("pwa_installation_failed", error);
        setFailed(Boolean(error));
      });
    }).catch((error) => {
      console.error("pwa_registration_failed", error);
      if (!disposed) setFailed(true);
    });
    return () => { disposed = true; stopObserving?.(); };
  }, [locale]);

  if (!failed) return null;
  return <div className="pwa-status" role="status"><p>{copy[locale].error}</p><button className="secondary" onClick={() => window.location.reload()}>{copy[locale].retry}</button></div>;
}
