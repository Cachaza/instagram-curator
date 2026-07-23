"use client";

import { ClipboardCheck, EllipsisVertical, ExternalLink, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function PublicationActions({ id, title, sourceUrl }: { id: string; title: string; sourceUrl: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function deletePublication() {
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/publications/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("No se pudo eliminar la publicación.");
      dialogRef.current?.close();
      router.replace("/library");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo eliminar la publicación.");
      setDeleting(false);
    }
  }

  return (
    <>
      <details className="publication-actions">
        <summary aria-label="Abrir acciones de la publicación"><EllipsisVertical aria-hidden="true" /></summary>
        <div className="publication-actions-menu">
          <a href={sourceUrl} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />Abrir en Instagram</a>
          <Link href={`/review?id=${encodeURIComponent(id)}`}><ClipboardCheck aria-hidden="true" />Revisar análisis</Link>
          <button type="button" className="destructive-menu-item" onClick={() => dialogRef.current?.showModal()}><Trash2 aria-hidden="true" />Eliminar publicación</button>
        </div>
      </details>

      <dialog className="delete-dialog" ref={dialogRef} onClose={() => { setError(""); setDeleting(false); }}>
        <button className="dialog-close" type="button" aria-label="Cerrar confirmación" onClick={() => dialogRef.current?.close()}><X aria-hidden="true" /></button>
        <Trash2 className="delete-dialog-icon" aria-hidden="true" />
        <p className="section-kicker">ACCIÓN PERMANENTE</p>
        <h2>¿Eliminar esta publicación?</h2>
        <p>Se eliminarán <strong>{title}</strong>, su análisis y los archivos descargados. Esta acción no se puede deshacer.</p>
        {error && <p className="error" role="alert">{error} Inténtalo de nuevo.</p>}
        <div className="delete-dialog-actions">
          <button type="button" className="secondary" disabled={deleting} onClick={() => dialogRef.current?.close()}>Cancelar</button>
          <button type="button" className="delete-button" disabled={deleting} onClick={deletePublication}>
            <Trash2 aria-hidden="true" />{deleting ? "Eliminando…" : "Sí, eliminar"}
          </button>
        </div>
      </dialog>
    </>
  );
}
