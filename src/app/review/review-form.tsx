"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import type { ContentItem } from "@/lib/content";

const categories = ["restaurant","recipe","clothing","mountain_gear","travel","startup_idea","startup_advice","technology","fitness","home","entertainment","reference","unknown"];

export function ReviewForm({ item, nextId }: { item: ContentItem; nextId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function save(form: HTMLFormElement, reviewStatus: "approved" | "corrected" | "discarded") {
    setBusy(true);
    const data = new FormData(form);
    const response = await fetch(`/api/reviews/${encodeURIComponent(item.id)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewStatus,
        actionStatus: data.get("actionStatus"),
        correctedCategory: reviewStatus === "corrected" ? data.get("category") : null,
        correctedAnalysis: reviewStatus === "corrected" ? {
          title: data.get("title"), summary: data.get("summary"),
          whyInteresting: data.get("whyInteresting"), nextAction: data.get("nextAction") || null,
        } : null,
        notes: data.get("notes") || null,
        discardedReason: reviewStatus === "discarded" ? data.get("notes") || "Descartado en revisión" : null,
      }),
    });
    setBusy(false);
    if (!response.ok) return alert("No se pudo guardar la revisión");
    router.push(nextId ? `/review?id=${encodeURIComponent(nextId)}` : "/review");
    router.refresh();
  }
  async function reanalyze() {
    setBusy(true);
    await fetch(`/api/reanalyze/${encodeURIComponent(item.id)}`, { method: "POST" });
    router.push("/pipeline");
    router.refresh();
  }
  return (
    <form className="review-form" onSubmit={(event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void save(event.currentTarget, "corrected");
    }}>
      <label>Categoría<select name="category" defaultValue={item.category}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
      <label>Título<input name="title" defaultValue={item.title} required /></label>
      <label>Resumen<textarea name="summary" defaultValue={item.summary} rows={6} required /></label>
      <label>Por qué interesa<textarea name="whyInteresting" defaultValue={item.whyInteresting} rows={3} /></label>
      <label>Estado de acción<select name="actionStatus" defaultValue={item.actionStatus}><option value="inbox">Inbox</option><option value="action">Acción</option><option value="someday">Algún día</option><option value="reference">Referencia</option><option value="done">Hecho</option></select></label>
      <label>Siguiente acción<textarea name="nextAction" defaultValue={item.nextAction ?? ""} rows={2} /></label>
      <label>Notas<textarea name="notes" rows={2} /></label>
      <div className="review-buttons">
        <button type="button" disabled={busy} className="danger-button" onClick={(event) => void save(event.currentTarget.form!, "discarded")}>Descartar</button>
        <button type="button" disabled={busy} className="secondary" onClick={reanalyze}>Reanalizar</button>
        <button type="submit" disabled={busy} className="secondary">Guardar corrección</button>
        <button type="button" disabled={busy} className="primary" onClick={(event) => void save(event.currentTarget.form!, "approved")}>Aprobar</button>
      </div>
    </form>
  );
}
