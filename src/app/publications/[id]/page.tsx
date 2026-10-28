import { ArrowLeft, ArrowRight, Check, ExternalLink, MapPin, Sparkles, Utensils } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryInfo } from "@/components/publication-card";
import { PublicationActions } from "@/components/publication-actions";
import { getContent, listContent } from "@/lib/content";
import { requireSession } from "@/lib/session";
import { dictionary } from "@/lib/i18n";
import { libraryHref, publicationHref, publicationNeighbors, type LibraryQuery } from "@/lib/library-filters";
import { nestedRecipes, recipeIngredients, recipeSteps } from "@/lib/recipe-entities";

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

function IngredientList({ value, suffix = "" }: { value: unknown; suffix?: string }) {
  const ingredients = recipeIngredients(value);
  if (!ingredients.length) return null;
  return (
    <section className="recipe-section" aria-labelledby={`ingredients-title${suffix}`}>
      <div className="section-heading-row">
        <div><span>Preparación</span><h2 id={`ingredients-title${suffix}`}>Ingredientes</h2></div>
        <small>{ingredients.length} elementos</small>
      </div>
      <ul className="ingredient-list">
        {ingredients.map((ingredient, index) => {
          const name = ingredient.name;
          const amount = [text(ingredient.quantity), text(ingredient.unit)].filter(Boolean).join(" ");
          return <li key={`${name}-${index}`}><Check aria-hidden="true" /><span><strong>{name}</strong>{amount && <small>{amount}</small>}{ingredient.section && <small>{ingredient.section}</small>}{ingredient.notes && <small>{ingredient.notes}</small>}{ingredient.source && <small>{ingredient.source}</small>}</span>{ingredient.optional === true && <em>Opcional</em>}</li>;
        })}
      </ul>
    </section>
  );
}

function RecipeSteps({ value, suffix = "" }: { value: unknown; suffix?: string }) {
  const steps = recipeSteps(value);
  if (!steps.length) return null;
  return (
    <section className="recipe-section" aria-labelledby={`steps-title${suffix}`}>
      <div className="section-heading-row"><div><span>En la cocina</span><h2 id={`steps-title${suffix}`}>Paso a paso</h2></div></div>
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

export default async function PublicationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<LibraryQuery> }) {
  await requireSession();
  const t = await dictionary();
  const { id } = await params;
  const item = await getContent(id);
  if (!item) notFound();
  const query = await searchParams;
  const { previous, next } = publicationNeighbors(await listContent({
    query: query.q,
    sort: query.sort === "newest" || query.sort === "oldest" || query.sort === "recently_added" ? query.sort : undefined,
    review: query.review && query.review !== "all" ? query.review : undefined,
    action: query.action && query.action !== "all" ? query.action : undefined,
  }), id, query);
  const backHref = libraryHref(query, { page: query.page });
  const meta = categoryInfo(item.category);
  const CategoryIcon = meta.Icon;
  const isRecipe = item.category === "recipe";
  const isRestaurant = item.category === "restaurant";
  const recipes = nestedRecipes(item.entities);
  const hiddenEntityKeys = new Set(isRecipe
    ? ["dish_name", "ingredients", "steps", "recipe", "recipes"]
    : isRestaurant ? ["mentioned_places", "restaurant_name", "address_as_stated"] : []);
  const remainingEntities = Object.entries(item.entities).filter(([key, value]) =>
    !hiddenEntityKeys.has(key) && value != null && value !== "" && (!Array.isArray(value) || value.length > 0));
  return (
    <div className={`detail-page ${isRecipe ? "recipe-detail" : ""} ${isRestaurant ? "restaurant-detail" : ""}`}>
      <div className="detail-toolbar"><Link href={backHref}><ArrowLeft aria-hidden="true" />{t.library.back}</Link><PublicationActions id={item.id} title={item.title} sourceUrl={item.sourceUrl} /></div>
      <nav className="publication-navigation" aria-label={t.library.browse}>
        {previous ? <Link className="secondary" rel="prev" href={publicationHref(previous.id, query)} title={previous.title}><ArrowLeft aria-hidden="true" />{t.library.previous}</Link> : <span className="secondary" aria-disabled="true"><ArrowLeft aria-hidden="true" />{t.library.previous}</span>}
        {next ? <Link className="secondary" rel="next" href={publicationHref(next.id, query)} title={next.title}>{t.library.next}<ArrowRight aria-hidden="true" /></Link> : <span className="secondary" aria-disabled="true">{t.library.next}<ArrowRight aria-hidden="true" /></span>}
      </nav>
      <div className="detail-grid">
        <section className="detail-media">
          {item.hasVideo ? <video controls preload="metadata" poster={item.hasImage ? `/api/media/${item.id}` : undefined} src={`/api/media/${item.id}?kind=video`} /> : item.hasImage ? <Image src={`/api/media/${item.id}`} width={900} height={1200} unoptimized alt="" /> : <div className="detail-placeholder"><CategoryIcon aria-hidden="true" /></div>}
          {!item.hasVideo && !item.hasImage && <p className="media-unavailable">{t.media.unavailable} <a href={item.sourceUrl} target="_blank" rel="noreferrer">{t.media.openSource}</a></p>}
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
          {isRecipe && recipes.map((recipe, index) => <section key={index}>{text(recipe.name) && <h2>{text(recipe.name)}</h2>}<IngredientList value={recipe.ingredients} suffix={`-${index}`} /><RecipeSteps value={recipe.steps} suffix={`-${index}`} /></section>)}
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
