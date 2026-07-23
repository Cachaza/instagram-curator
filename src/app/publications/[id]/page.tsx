import { ArrowLeft, ExternalLink, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryInfo } from "@/components/publication-card";
import { getContent } from "@/lib/content";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function EntityView({ value }: { value: unknown }) {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  if (Array.isArray(value)) return <ul>{value.map((item, index) => <li key={index}>{typeof item === "object" ? JSON.stringify(item) : String(item)}</li>)}</ul>;
  if (typeof value === "object") return <pre>{JSON.stringify(value, null, 2)}</pre>;
  return <p>{String(value)}</p>;
}

export default async function PublicationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const item = getContent(id);
  if (!item) notFound();
  const meta = categoryInfo(item.category);
  return (
    <div className="detail-page">
      <div className="detail-toolbar"><Link href="/library"><ArrowLeft />Volver</Link><a href={item.sourceUrl} target="_blank" rel="noreferrer">Abrir en Instagram <ExternalLink /></a></div>
      <div className="detail-grid">
        <section className="detail-media">
          {item.hasVideo ? <video controls preload="metadata" poster={item.hasImage ? `/api/media/${item.id}` : undefined} src={`/api/media/${item.id}?kind=video`} /> : item.hasImage ? <Image src={`/api/media/${item.id}`} width={900} height={1200} unoptimized alt="" /> : <div className="detail-placeholder">{meta.emoji}</div>}
          {item.caption && <details><summary>Descripción original</summary><p>{item.caption}</p></details>}
          {item.transcript && <details><summary>Transcripción</summary><p className="transcript">{item.transcript}</p></details>}
        </section>
        <article className="detail-copy">
          <span className={`category-badge ${meta.className}`}>{meta.emoji} {meta.label}</span>
          <h1>{item.title}</h1>
          <p className="detail-summary">{item.summary}</p>
          <div className="confidence"><span style={{ width: `${Math.round(item.confidence * 100)}%` }} /><small>{Math.round(item.confidence * 100)}% confianza</small></div>
          <section><h2><Sparkles />Por qué interesa</h2><p>{item.whyInteresting}</p></section>
          {item.nextAction && <section className="next-action"><h2>Siguiente acción</h2><p>{item.nextAction}</p></section>}
          <section><h2>Detalles</h2><div className="entity-grid">{Object.entries(item.entities).map(([key, value]) => <div key={key}><strong>{key.replaceAll("_", " ")}</strong><EntityView value={value} /></div>)}</div></section>
          <section><h2>Descripción visual</h2><p>{item.visualDescription}</p></section>
          <div className="tag-row">{item.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
          <div className="detail-actions"><Link className="primary" href={`/review?id=${item.id}`}>Revisar análisis</Link></div>
        </article>
      </div>
    </div>
  );
}
