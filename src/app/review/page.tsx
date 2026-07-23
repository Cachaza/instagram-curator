import Image from "next/image";
import Link from "next/link";
import { getContent } from "@/lib/content";
import { requireSession } from "@/lib/session";
import { reviewQueue } from "@/lib/reviews";
import { ReviewForm } from "./review-form";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ id?: string; filter?: string }> }) {
  await requireSession();
  const query = await searchParams;
  const filter = query.filter ?? "unreviewed";
  const queue = reviewQueue(filter);
  const selected = query.id ? getContent(query.id) : queue[0] ?? null;
  const index = selected ? queue.findIndex((item) => item.id === selected.id) : -1;
  const nextId = queue.length > 1 ? queue[(index + 1 + queue.length) % queue.length]?.id ?? null : null;
  return (
    <div className="page-container">
      <section className="page-hero compact-hero"><p className="section-kicker">CONTROL HUMANO</p><h1>Revisar<span>.</span></h1><p>{queue.length} análisis en esta cola.</p></section>
      <div className="review-filter-row">{[
        ["unreviewed","Sin revisar"],["needs_review","Necesitan revisión"],["low_confidence","Confianza baja"],["approved","Aprobados"],["discarded","Descartados"],["all","Todos"],
      ].map(([value,label]) => <Link className={filter === value ? "active" : ""} href={`/review?filter=${value}`} key={value}>{label}</Link>)}</div>
      {!selected ? <div className="empty-state"><h2>Cola terminada</h2><p>No quedan elementos para este filtro.</p></div> : (
        <div className="review-layout">
          <section className="review-preview">
            {selected.hasImage && <Image src={`/api/media/${selected.id}`} width={800} height={500} unoptimized alt="" />}
            <span className="pill">{selected.category} · {Math.round(selected.confidence * 100)}%</span>
            <h2>{selected.title}</h2>
            <p>{selected.summary}</p>
            {selected.reviewReason && <div className="review-warning">{selected.reviewReason}</div>}
            <Link href={`/publications/${selected.id}`}>Abrir detalle completo →</Link>
          </section>
          <ReviewForm item={selected} nextId={nextId} />
        </div>
      )}
    </div>
  );
}
