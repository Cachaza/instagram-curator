"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RetryButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <button className="retry-button" disabled={busy} onClick={async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setBusy(true);
    await fetch(`/api/retry/${encodeURIComponent(id)}`, { method: "POST" });
    router.refresh();
  }}>{busy ? "…" : "Reintentar"}</button>;
}
