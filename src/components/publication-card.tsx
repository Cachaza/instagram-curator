import Image from "next/image";
import Link from "next/link";
import type { ContentItem } from "@/lib/content";

const categoryMeta: Record<string, { label: string; emoji: string; className: string }> = {
  restaurant: { label: "Restaurante", emoji: "🍽️", className: "cat-orange" },
  recipe: { label: "Receta", emoji: "🍳", className: "cat-amber" },
  travel: { label: "Viaje", emoji: "🌍", className: "cat-sky" },
  technology: { label: "Tecnología", emoji: "💻", className: "cat-violet" },
  startup_idea: { label: "Idea", emoji: "💡", className: "cat-yellow" },
  startup_advice: { label: "Negocio", emoji: "📈", className: "cat-green" },
  clothing: { label: "Estilo", emoji: "👕", className: "cat-rose" },
  mountain_gear: { label: "Montaña", emoji: "⛰️", className: "cat-lime" },
  fitness: { label: "Fitness", emoji: "🏃", className: "cat-cyan" },
  home: { label: "Hogar", emoji: "🏡", className: "cat-pink" },
  entertainment: { label: "Cultura", emoji: "🎬", className: "cat-purple" },
  reference: { label: "Referencia", emoji: "📌", className: "cat-stone" },
};

export function categoryInfo(category: string) {
  return categoryMeta[category] ?? { label: category.replaceAll("_", " "), emoji: "✦", className: "cat-stone" };
}

export function PublicationCard({ item }: { item: ContentItem }) {
  const meta = categoryInfo(item.category);
  return (
    <Link className="publication-card" href={`/publications/${encodeURIComponent(item.id)}`}>
      <div className="card-image">
        {item.hasImage
          ? <Image src={`/api/media/${encodeURIComponent(item.id)}`} width={700} height={440} unoptimized alt="" />
          : <span className="card-placeholder">{meta.emoji}</span>}
        <span className={`category-badge ${meta.className}`}>{meta.emoji} {meta.label}</span>
      </div>
      <div className="card-copy">
        <h2>{item.title}</h2>
        <p>{item.summary}</p>
        <div><span>{new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(new Date(item.publishedAt))}</span><strong>Abrir ↗</strong></div>
      </div>
    </Link>
  );
}
