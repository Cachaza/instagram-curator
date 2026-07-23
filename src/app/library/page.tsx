import Link from "next/link";
import { LayoutGrid, SlidersHorizontal } from "lucide-react";
import { categories, listContent } from "@/lib/content";
import { PublicationCard, categoryInfo } from "@/components/publication-card";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSession();
  const query = await searchParams;
  const all = listContent({ category: query.category, query: query.q });
  const filtered = all.filter((item) => {
    const restaurant = item.facets.restaurant as Record<string, unknown> | undefined;
    const recipe = item.facets.recipe as Record<string, unknown> | undefined;
    const fitness = item.facets.fitness as Record<string, unknown> | undefined;
    const includes = (value: unknown, selected?: string) => !selected || (Array.isArray(value) && value.includes(selected));
    return includes(restaurant?.cuisine, query.cuisine)
      && (!query.budget || restaurant?.budget === query.budget)
      && includes(recipe?.nutritionGoals, query.recipeGoal)
      && includes(recipe?.foodStyles, query.recipeStyle)
      && includes(fitness?.goals, query.fitnessGoal)
      && includes(fitness?.muscleGroups, query.muscleGroup);
  });
  const currentPage = Math.max(1, Number(query.page) || 1);
  const pageSize = 60;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const categoryRows = categories();
  const facets = {
    cuisines: new Set<string>(), recipeGoals: new Set<string>(), recipeStyles: new Set<string>(),
    fitnessGoals: new Set<string>(), muscles: new Set<string>(),
  };
  for (const item of listContent()) {
    const add = (target: Set<string>, value: unknown) => Array.isArray(value) && value.forEach((entry) => typeof entry === "string" && target.add(entry));
    const r = item.facets.restaurant as Record<string, unknown> | undefined;
    const recipe = item.facets.recipe as Record<string, unknown> | undefined;
    const fitness = item.facets.fitness as Record<string, unknown> | undefined;
    add(facets.cuisines, r?.cuisine); add(facets.recipeGoals, recipe?.nutritionGoals);
    add(facets.recipeStyles, recipe?.foodStyles); add(facets.fitnessGoals, fitness?.goals);
    add(facets.muscles, fitness?.muscleGroups);
  }
  const params = new URLSearchParams(Object.entries(query).filter((entry): entry is [string,string] => Boolean(entry[1])));
  const categoryHref = (category?: string) => {
    const next = new URLSearchParams(params);
    if (category) next.set("category", category);
    else next.delete("category");
    return `/library?${next}`;
  };
  const select = (name: string, label: string, values: Set<string>) => <label>{label}<select name={name} defaultValue={query[name] ?? ""}><option value="">Cualquiera</option>{[...values].sort().map((value) => <option key={value}>{value}</option>)}</select></label>;
  return (
    <div className="page-container">
      <section className="page-hero"><p className="section-kicker">DESCUBRE DE NUEVO</p><h1>Explorar<span>.</span></h1><p>Encuentra esa idea que sabías que habías guardado en algún sitio.</p></section>
      <div className="category-pills"><Link className={!query.category ? "active" : ""} href={categoryHref()}><LayoutGrid aria-hidden="true" /> Todo</Link>{categoryRows.map((row) => {
        const meta = categoryInfo(row.category); const CategoryIcon = meta.Icon; return <Link className={query.category === row.category ? "active" : ""} href={categoryHref(row.category)} key={row.category}><CategoryIcon aria-hidden="true" /> {meta.label} <small>{row.count}</small></Link>;
      })}</div>
      <details className="advanced-filters" open={Boolean(query.cuisine || query.budget || query.recipeGoal || query.fitnessGoal)}>
        <summary><SlidersHorizontal />Filtros avanzados</summary>
        <form>
          {query.q && <input type="hidden" name="q" value={query.q} />}
          {query.category && <input type="hidden" name="category" value={query.category} />}
          {select("cuisine","Tipo de comida",facets.cuisines)}
          <label>Precio<select name="budget" defaultValue={query.budget ?? ""}><option value="">Cualquiera</option>{["€","€€","€€€","€€€€"].map((value) => <option key={value}>{value}</option>)}</select></label>
          {select("recipeGoal","Objetivo nutricional",facets.recipeGoals)}
          {select("recipeStyle","Estilo de receta",facets.recipeStyles)}
          {select("fitnessGoal","Objetivo fitness",facets.fitnessGoals)}
          {select("muscleGroup","Grupo muscular",facets.muscles)}
          <button className="primary">Aplicar</button>
        </form>
      </details>
      <div className="results-row"><strong>{filtered.length}</strong> hallazgos</div>
      <div className="masonry-grid">{visible.map((item) => <PublicationCard item={item} key={item.id} />)}</div>
      {filtered.length === 0 && <div className="empty-state"><h2>Nada por aquí</h2><p>Prueba con otra búsqueda o quita algún filtro.</p></div>}
      {totalPages > 1 && <nav className="pagination">{Array.from({ length: totalPages }, (_, index) => {
        const page = index + 1; const next = new URLSearchParams(params); next.set("page", String(page));
        return <Link className={page === currentPage ? "active" : ""} href={`/library?${next}`} key={page}>{page}</Link>;
      })}</nav>}
    </div>
  );
}
