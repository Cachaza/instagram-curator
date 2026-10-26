"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { restaurantMessages } from "@/lib/restaurant-messages";
import type { Locale } from "@/lib/messages";

export function ArchiveRestaurantLocation({ publicationId, placeKey, label, locale }: { publicationId: string; placeKey: string; label: string; locale: Locale }) {
  const t = restaurantMessages[locale];
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <><button className="secondary" disabled={busy} aria-label={`${t.archivePreviousLocation}: ${label}`} onClick={async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/restaurants/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive", publicationId, placeKey }) });
      if (!response.ok) throw new Error();
      router.refresh();
    } catch { setError(t.archiveLocationError); }
    finally { setBusy(false); }
  }}>{t.archivePreviousLocation}</button><span role="status">{error}</span></>;
}
