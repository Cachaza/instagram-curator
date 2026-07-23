import { ArrowLeft, Check, ExternalLink, MapPin, Sparkles, Utensils } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryInfo } from "@/components/publication-card";
import { PublicationActions } from "@/components/publication-actions";
import { getContent } from "@/lib/content";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function EntityView({ value }: { value: unknown }) {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  if (Array.isArray(value)) return <ul>{value.map((item, index) => <li key={index}>{readableValue(item)}</li>)}</ul>;
  if (typeof value === "object") return <p>{readableValue(value)}</p>;
  return <p>{String(value)}</p>;
}

type EntityRecord = Record<string, unknown>;

function record(value: unknown): EntityRecord | null {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as EntityRecord : null;
}

function records(value: unknown): EntityRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map(record).filter((item): item is EntityRecord => Boolean(item));
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function readableValue(value: unknown): string {
  const item = record(value);
  if (!item) return String(value);
  return Object.values(item).map(text).filter(Boolean).join(" · ");
}

function label(key: string): string {
  const labels: Record<string, string> = {
    cuisine: "Cocina",
    occasion: "Ideal para",
    estimated_budget: "Presupuesto estimado",
    features: "Características",
    meal_type: "Tipo de comida",
    dietary_tags: "Preferencias",
    estimated_time_minutes: "Tiempo estimado",
  };
  return labels[key] ?? key.replaceAll("_", " ");
}

function IngredientList({ value }: { value: unknown }) {
  const ingredients = records(value);
  if (!ingredients.length) return null;
  return (
    <section className="recipe-section" aria-labelledby="ingredients-title">
      <div className="section-heading-row">
        <div><span>Preparación</span><h2 id="ingredients-title">Ingredientes</h2></div>
        <small>{ingredients.length} elementos</small>
      </div>
      <ul className="ingredient-list">
        {ingredients.map((ingredient, index) => {
          const name = text(ingredient.name) ?? `Ingrediente ${index + 1}`;
          const amount = [text(ingredient.quantity), text(ingredient.unit)].filter(Boolean).join(" ");
          return <li key={`${name}-${index}`}><Check aria-hidden="true" /><span><strong>{name}</strong>{amount && <small>{amount}</small>}</span>{ingredient.optional === true && <em>Opcional</em>}</li>;
        })}
      </ul>
    </section>
  );
}

function RecipeSteps({ value }: { value: unknown }) {
  const steps = records(value)
    .map((step, index) => ({ position: Number(step.position) || index + 1, instruction: text(step.instruction) }))
    .filter((step): step is { position: number; instruction: string } => Boolean(step.instruction))
    .sort((a, b) => a.position - b.position);
  if (!steps.length) return null;
  return (
    <section className="recipe-section" aria-labelledby="steps-title">
      <div className="section-heading-row"><div><span>En la cocina</span><h2 id="steps-title">Paso a paso</h2></div></div>
      <ol className="recipe-steps">
        {steps.map((step) => <li key={`${step.position}-${step.instruction}`}><span>{step.position}</span><p>{step.instruction}</p></li>)}
      </ol>
    </section>
  );
}

function RestaurantPlaces({ entities }: { entities: EntityRecord }) {
  const primaryName = text(entities.restaurant_name);
  const primaryAddress = text(entities.address_as_stated);
  const mentioned = Array.isArray(entities.mentioned_places) ? entities.mentioned_places : [];
  const places = primaryName
    ? [{ name: primaryName, location_hint: primaryAddress }]
    : mentioned.map((value) => record(value) ?? (text(value) ? { name: text(value) } : null))
      .filter((item): item is EntityRecord => Boolean(item));
  if (!places.length) return null;
  return (
    <section className="places-section" aria-labelledby="places-title">
      <div className="section-heading-row">
        <div><span>Lugares mencionados</span><h2 id="places-title">Restaurantes para explorar</h2></div>
        <small>{places.length} {places.length === 1 ? "lugar" : "lugares"}</small>
      </div>
      <div className="place-list">
        {places.map((place, index) => {
          const name = text(place.name) ?? `Lugar ${index + 1}`;
          const hint = text(place.location_hint);
          const query = [name, hint].filter(Boolean).join(", ");
          return (
            <article key={`${name}-${index}`}>
              <MapPin aria-hidden="true" />
              <div><h3>{name}</h3>{hint && <p>{hint}</p>}</div>
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer" aria-label={`Buscar ${name} en Google Maps`}>
                Ver en Maps <ExternalLink aria-hidden="true" />
              </a>
            </article>
          );
        })}
      </div>
      <p className="source-caveat">Los nombres y zonas proceden de la publicación. Comprueba el resultado antes de desplazarte.</p>
    </section>
  );
}

export default async function PublicationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const item = getContent(id);
  if (!item) notFound();
  const meta = categoryInfo(item.category);
  const CategoryIcon = meta.Icon;
  const isRecipe = item.category === "recipe";
  const isRestaurant = item.category === "restaurant";
  const hiddenEntityKeys = new Set(isRecipe
    ? ["dish_name", "ingredients", "steps"]
    : isRestaurant ? ["mentioned_places", "restaurant_name", "address_as_stated"] : []);
  const remainingEntities = Object.entries(item.entities).filter(([key, value]) =>
    !hiddenEntityKeys.has(key) && value != null && value !== "" && (!Array.isArray(value) || value.length > 0));
  return (
    <div className={`detail-page ${isRecipe ? "recipe-detail" : ""} ${isRestaurant ? "restaurant-detail" : ""}`}>
      <div className="detail-toolbar"><Link href="/library"><ArrowLeft />Volver</Link><PublicationActions id={item.id} title={item.title} sourceUrl={item.sourceUrl} /></div>
      <div className="detail-grid">
        <section className="detail-media">
          {item.hasVideo ? <video controls preload="metadata" poster={item.hasImage ? `/api/media/${item.id}` : undefined} src={`/api/media/${item.id}?kind=video`} /> : item.hasImage ? <Image src={`/api/media/${item.id}`} width={900} height={1200} unoptimized alt="" /> : <div className="detail-placeholder"><CategoryIcon aria-hidden="true" /></div>}
          {item.caption && <details><summary>Descripción original</summary><p>{item.caption}</p></details>}
          {item.transcript && <details><summary>Transcripción</summary><p className="transcript">{item.transcript}</p></details>}
        </section>
        <article className="detail-copy">
          <span className={`category-badge ${meta.className}`}><CategoryIcon aria-hidden="true" /> {meta.label}</span>
          <h1>{item.title}</h1>
          <p className="detail-summary">{item.summary}</p>
          <div className="confidence"><span style={{ width: `${Math.round(item.confidence * 100)}%` }} /><small>{Math.round(item.confidence * 100)}% confianza</small></div>
          <section><h2><Sparkles />Por qué interesa</h2><p>{item.whyInteresting}</p></section>
          {item.nextAction && <section className="next-action"><h2>Siguiente acción</h2><p>{item.nextAction}</p></section>}
          {isRecipe && <div className="knowledge-mode-heading"><Utensils /><div><span>Modo receta</span><strong>{text(item.entities.dish_name) ?? item.title}</strong></div></div>}
          {isRecipe && <IngredientList value={item.entities.ingredients} />}
          {isRecipe && <RecipeSteps value={item.entities.steps} />}
          {isRestaurant && <RestaurantPlaces entities={item.entities} />}
          {remainingEntities.length > 0 && <section><h2>{isRecipe || isRestaurant ? "Información adicional" : "Detalles"}</h2><div className="entity-grid">{remainingEntities.map(([key, value]) => <div key={key}><strong>{label(key)}</strong><EntityView value={value} /></div>)}</div></section>}
          <section><h2>Descripción visual</h2><p>{item.visualDescription}</p></section>
          <div className="tag-row">{item.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
          <div className="detail-actions"><Link className="primary" href={`/review?id=${item.id}`}>Revisar análisis</Link></div>
        </article>
      </div>
    </div>
  );
}
