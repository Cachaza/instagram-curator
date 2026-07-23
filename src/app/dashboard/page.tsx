import Link from "next/link";
import Image from "next/image";
import { Activity } from "lucide-react";
import { db } from "@/lib/db";
import { listContent } from "@/lib/content";
import { PublicationCard } from "@/components/publication-card";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireSession();
  const recent = listContent({ limit: 12 });
  const featured = recent[0];
  const stats = db.prepare(`
    SELECT
      COUNT(*) total,
      SUM(p.processing_status='analyzed') analyzed,
      SUM(p.processing_status='ready_for_analysis') waiting_ai,
      SUM(p.processing_status='failed') failed,
      SUM(p.review_status='unreviewed' AND p.processing_status='analyzed') unreviewed,
      SUM(a.category='restaurant') restaurants,
      SUM(a.category='recipe') recipes
    FROM publications p
    LEFT JOIN analyses a ON a.publication_id = p.id
  `).get() as Record<string, number>;
  const facts = featured
    ? Object.entries(featured.entities).flatMap(([group, value]) => {
        const values = Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === "string")
          : typeof value === "string" ? [value] : [];
        return values.slice(0, 2).map((entry) => ({
          group: group.replaceAll("_", " "),
          value: entry,
        }));
      }).slice(0, 2)
    : [];
  const knowledgePlane = (variant: "desktop" | "mobile") => featured && (
    <aside className={`knowledge-plane knowledge-plane-${variant}`} aria-labelledby={`knowledge-plane-title-${variant}`}>
      <span className="knowledge-anchor" aria-hidden="true" />
      <p className="section-kicker">CONOCIMIENTO EXTRAÍDO</p>
      <div className="knowledge-source">
        {featured.hasImage && <Image src={`/api/media/${encodeURIComponent(featured.id)}`} width={160} height={100} unoptimized alt="" />}
        <div>
          <span>Fuente seleccionada</span>
          <strong>{featured.title}</strong>
        </div>
      </div>
      <h2 id={`knowledge-plane-title-${variant}`}>{featured.summary}</h2>
      {featured.whyInteresting && <p>{featured.whyInteresting}</p>}
      {facts.length > 0 && (
        <dl className="knowledge-facts">
          {facts.map((fact) => (
            <div key={`${fact.group}-${fact.value}`}>
              <dt>{fact.group}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {featured.tags.length > 0 && (
        <div className="knowledge-tags" aria-label="Etiquetas">
          {featured.tags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      )}
      <ol className="knowledge-progress" aria-label="Proceso completado">
        <li>Fuente</li>
        <li>Extracción</li>
        <li className="is-current">Conocimiento</li>
      </ol>
      <div className="knowledge-status">
        <span>Estado</span>
        <strong>{featured.needsReview ? "Pendiente de revisión" : "Listo para consultar"}</strong>
      </div>
      <Link className="knowledge-link" href={`/publications/${encodeURIComponent(featured.id)}`}>Abrir conocimiento →</Link>
    </aside>
  );
  return (
    <div className="page-container">
      <section className="page-hero">
        <p className="section-kicker">TU ARCHIVO</p>
        <h1>Buenos días<span>.</span></h1>
        <p>Un resumen de lo último que has guardado y organizado.</p>
      </section>
      <section className="home-summary" aria-label="Resumen de la biblioteca">
        <Link href="/library"><strong>{stats.analyzed ?? 0}</strong> publicaciones</Link>
        <span />
        <Link href="/library?category=restaurant"><strong>{stats.restaurants ?? 0}</strong> restaurantes</Link>
        <span />
        <Link href="/library?category=recipe"><strong>{stats.recipes ?? 0}</strong> recetas</Link>
        <span />
        <Link href="/review"><strong>{stats.unreviewed ?? 0}</strong> por revisar</Link>
      </section>
      <section className="dashboard-section">
        <div className="section-title"><h2>Publicaciones recientes</h2><Link href="/library">Explorar todo →</Link></div>
        {featured ? (
          <div className="archive-section">
            <div className="archive-selection">
              <PublicationCard item={featured} selected />
              {knowledgePlane("mobile")}
              {recent.slice(1, 4).map((item) => <PublicationCard item={item} key={item.id} />)}
            </div>
            {knowledgePlane("desktop")}
          </div>
        ) : (
          <div className="empty-state"><div><h2>Tu archivo está esperando</h2><p>Añade una publicación para convertirla en conocimiento útil.</p></div></div>
        )}
      </section>
      {recent.length > 4 && (
        <section className="dashboard-section archive-more">
          <div className="section-title"><h2>Más de tu archivo</h2></div>
          <div className="masonry-grid">{recent.slice(4).map((item) => <PublicationCard item={item} key={item.id} />)}</div>
        </section>
      )}
      <Link className="floating-import" href="/import"><Activity /> Añadir publicación</Link>
    </div>
  );
}
