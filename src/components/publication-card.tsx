import Image from "next/image";
import Link from "next/link";
import {
  Bookmark,
  Clapperboard,
  CookingPot,
  Dumbbell,
  House,
  Laptop,
  Lightbulb,
  Mountain,
  Plane,
  Shapes,
  Shirt,
  TrendingUp,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import type { ContentItem } from "@/lib/content";

const categoryMeta: Record<string, { label: string; Icon: LucideIcon; className: string }> = {
  restaurant: { label: "Restaurante", Icon: Utensils, className: "cat-orange" },
  recipe: { label: "Receta", Icon: CookingPot, className: "cat-amber" },
  travel: { label: "Viaje", Icon: Plane, className: "cat-sky" },
  technology: { label: "Tecnología", Icon: Laptop, className: "cat-violet" },
  startup_idea: { label: "Idea", Icon: Lightbulb, className: "cat-yellow" },
  startup_advice: { label: "Negocio", Icon: TrendingUp, className: "cat-green" },
  clothing: { label: "Estilo", Icon: Shirt, className: "cat-rose" },
  mountain_gear: { label: "Montaña", Icon: Mountain, className: "cat-lime" },
  fitness: { label: "Fitness", Icon: Dumbbell, className: "cat-cyan" },
  home: { label: "Hogar", Icon: House, className: "cat-pink" },
  entertainment: { label: "Cultura", Icon: Clapperboard, className: "cat-purple" },
  reference: { label: "Referencia", Icon: Bookmark, className: "cat-stone" },
};

export function categoryInfo(category: string) {
  return categoryMeta[category] ?? { label: category.replaceAll("_", " "), Icon: Shapes, className: "cat-stone" };
}

export function PublicationCard({ item, selected = false }: { item: ContentItem; selected?: boolean }) {
  const meta = categoryInfo(item.category);
  const CategoryIcon = meta.Icon;
  return (
    <Link className={`publication-card ${selected ? "publication-card-selected" : ""}`} href={`/publications/${encodeURIComponent(item.id)}`}>
      <div className="card-image">
        {item.hasImage
          ? <Image src={`/api/media/${encodeURIComponent(item.id)}`} width={700} height={440} unoptimized alt="" />
          : <span className="card-placeholder"><CategoryIcon aria-hidden="true" /></span>}
        <span className={`category-badge ${meta.className}`}><CategoryIcon aria-hidden="true" /> {meta.label}</span>
      </div>
      <div className="card-copy">
        <h2>{item.title}</h2>
        <p>{item.summary}</p>
        <div><span>{new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(new Date(item.publishedAt))}</span><strong>Abrir <span aria-hidden="true">→</span></strong></div>
      </div>
    </Link>
  );
}
