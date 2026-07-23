import Link from "next/link";
import { Activity } from "lucide-react";
import { db } from "@/lib/db";
import { listContent } from "@/lib/content";
import { PublicationCard } from "@/components/publication-card";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireSession();
  const recent = listContent({ limit: 12 });
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
  return (
    <div className="page-container">
      <section className="page-hero">
        <p className="section-kicker">TU ARCHIVO PERSONAL</p>
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
        <div className="section-title"><div><p className="section-kicker">LO ÚLTIMO</p><h2>Publicaciones recientes</h2></div><Link href="/library">Explorar todo →</Link></div>
        <div className="masonry-grid">{recent.map((item) => <PublicationCard item={item} key={item.id} />)}</div>
      </section>
      <Link className="floating-import" href="/import"><Activity /> Importar otra publicación</Link>
    </div>
  );
}
