import Link from "next/link";
import { AlertTriangle, Bot, CheckCircle2, Clock3, Download, FileAudio } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { RetryButton } from "./retry-button";

export const dynamic = "force-dynamic";

const statusMeta: Record<string, { label: string; icon: typeof Clock3 }> = {
  pending: { label: "Pendiente", icon: Clock3 },
  downloading: { label: "Descargando", icon: Download },
  extracting_media: { label: "Extrayendo multimedia", icon: FileAudio },
  transcribing: { label: "Transcribiendo", icon: FileAudio },
  ready_for_analysis: { label: "Esperando a Codex", icon: Bot },
  analyzing: { label: "Analizando", icon: Bot },
  ready_for_review: { label: "Lista para revisar", icon: CheckCircle2 },
  analyzed: { label: "Analizada", icon: CheckCircle2 },
  failed: { label: "Fallida", icon: AlertTriangle },
};

export default async function PipelinePage() {
  await requireSession();
  const statuses = db.prepare("SELECT processing_status status,COUNT(*) count FROM publications GROUP BY processing_status ORDER BY count DESC")
    .all() as Array<{ status: string; count: number }>;
  const failures = db.prepare("SELECT id,source_url,current_stage,last_error,attempts,updated_at FROM publications WHERE processing_status='failed' ORDER BY updated_at DESC LIMIT 20")
    .all() as Array<Record<string, string | number>>;
  const events = db.prepare("SELECT e.*,p.source_url FROM pipeline_events e JOIN publications p ON p.id=e.publication_id ORDER BY e.id DESC LIMIT 25")
    .all() as Array<Record<string, string>>;
  return (
    <div className="page-container">
      <section className="page-hero"><p className="section-kicker">ESTADO OPERATIVO</p><h1>Pipeline<span>.</span></h1><p>Descargas, transcripciones, análisis y errores persistidos en tiempo real.</p></section>
      <div className="pipeline-status-grid">{statuses.map(({ status, count }) => {
        const meta = statusMeta[status] ?? { label: status, icon: Clock3 }; const Icon = meta.icon;
        return <article key={status}><Icon /><strong>{count}</strong><span>{meta.label}</span></article>;
      })}</div>
      <div className="two-panel-grid">
        <section className="panel"><div className="section-title"><h2>Actividad reciente</h2></div><div className="event-list">{events.map((event) => <div key={event.id}><span className={`event-dot event-${event.event_type}`} /><div><strong>{event.stage}</strong><small>{event.source_url}</small><p>{event.message}</p></div></div>)}</div></section>
        <section className="panel"><div className="section-title"><h2>Fallos</h2><span>{failures.length}</span></div><div className="failure-list">{failures.map((failure) => <Link href={`/publications/${failure.id}`} key={String(failure.id)}><AlertTriangle /><div><strong>{failure.current_stage}</strong><small>{failure.source_url}</small><p>{failure.last_error}</p></div><span>×{failure.attempts}</span><RetryButton id={String(failure.id)} /></Link>)}</div></section>
      </div>
    </div>
  );
}
