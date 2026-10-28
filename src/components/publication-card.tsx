import Link from "next/link";
import { CardMediaImage } from "@/components/card-media-image";
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
import { messages, type Locale } from "@/lib/messages";
import { publicationHref, type LibraryQuery } from "@/lib/library-filters";
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

const englishCategories: Record<string, string> = {
  restaurant: "Restaurant", recipe: "Recipe", travel: "Travel", technology: "Technology",
  startup_idea: "Idea", startup_advice: "Business", clothing: "Style", mountain_gear: "Outdoors",
  fitness: "Fitness", home: "Home", entertainment: "Culture", reference: "Reference", unknown: "Uncategorized",
};

export function categoryInfo(category: string, locale: Locale = "es") {
  const meta = categoryMeta[category] ?? { label: category.replaceAll("_", " "), Icon: Shapes, className: "cat-stone" };
  return locale === "en" ? { ...meta, label: englishCategories[category] ?? meta.label } : meta;
}

export function PublicationCard({ item, selected = false, locale = "es", query }: { item: ContentItem; selected?: boolean; locale?: Locale; query?: LibraryQuery }) {
  const meta = categoryInfo(item.category, locale);
  const CategoryIcon = meta.Icon;
  return (
    <Link className={`publication-card ${selected ? "publication-card-selected" : ""}`} href={publicationHref(item.id, query)}>
      <div className="card-image">
        {item.hasImage
          ? <CardMediaImage src={`/api/media/${encodeURIComponent(item.id)}`} unavailable={messages[locale].media.cardUnavailable} />
          : <span className="card-placeholder"><CategoryIcon aria-hidden="true" /></span>}
        <span className={`category-badge ${meta.className}`}><CategoryIcon aria-hidden="true" /> {meta.label}</span>
      </div>
      <div className="card-copy">
        <h2>{item.title}</h2>
        <p>{item.summary}</p>
        <div><span>{new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(item.publishedAt))}</span><strong>{locale === "en" ? "Open" : "Abrir"} <span aria-hidden="true">→</span></strong></div>
      </div>
    </Link>
  );
}
