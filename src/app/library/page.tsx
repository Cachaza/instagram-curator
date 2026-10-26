import Link from "next/link";
import { LayoutGrid, Search, SlidersHorizontal } from "lucide-react";
import { listContent } from "@/lib/content";
import { PublicationCard, categoryInfo } from "@/components/publication-card";
import { requireSession } from "@/lib/session";
import { dictionary, appLocale } from "@/lib/i18n";
import { restaurantMessages } from "@/lib/restaurant-messages";
import { filterOptions, filtersFor, libraryHref, matchesFilters } from "@/lib/library-filters";

export const dynamic = "force-dynamic";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSession();
  const query = await searchParams;
  const locale = await appLocale();
  const t = (await dictionary(locale)).library;
  const all = await listContent({ query: query.q });
  const filtered = all.filter((item) => matchesFilters(item, query));
  // Preserve the library's existing page capacity.
  const pageSize = 60;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const requestedPage = Number(query.page);
  const currentPage = Number.isSafeInteger(requestedPage) ? Math.min(totalPages, Math.max(1, requestedPage)) : 1;
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const categoryCounts = new Map<string, number>();
  for (const item of all) categoryCounts.set(item.category, (categoryCounts.get(item.category) ?? 0) + 1);
  // Keep the selected category reachable when a search has no matches.
  if (query.category && !categoryCounts.has(query.category)) categoryCounts.set(query.category, 0);
  const filters = filtersFor(query.category);
  const hasActiveFilter = filters.some(({ name }) => Boolean(query[name]));
  return (
    <div className="page-container">
      <section className="page-hero compact-hero"><h1>{t.title}<span>.</span></h1><p>{t.intro}</p></section>
      <nav className="category-pills" aria-label={t.category}>
        <Link className={!query.category ? "active" : ""} aria-current={!query.category ? "page" : undefined} href={libraryHref(query, { category: undefined }, true)}><LayoutGrid aria-hidden="true" />{t.allCategories}<small>{all.length}</small></Link>
        {[...categoryCounts].map(([category, count]) => {
          const meta = categoryInfo(category, locale); const CategoryIcon = meta.Icon;
          return <Link className={query.category === category ? "active" : ""} aria-current={query.category === category ? "page" : undefined} href={libraryHref(query, { category }, true)} key={category}><CategoryIcon aria-hidden="true" />{meta.label}<small>{count}</small></Link>;
        })}
      </nav>
      <form className="library-search" action="/library">
        {query.category && <input type="hidden" name="category" value={query.category} />}
        <label className="library-query">{t.search}<span><Search aria-hidden="true" /><input type="search" name="q" defaultValue={query.q ?? ""} placeholder={t.searchPlaceholder} /></span></label>
        {filters.length > 0 && <fieldset className="library-filters"><legend><SlidersHorizontal aria-hidden="true" />{t.filters}</legend>
          {filters.map(({ name }) => <label key={name}>{t[name]}<select name={name} defaultValue={query[name] ?? ""}><option value="">{t.any}</option>{filterOptions(all, query, name).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>)}
        </fieldset>}
        <div className="filter-actions"><button className="primary" type="submit">{filters.length ? t.apply : t.search}</button>
          {hasActiveFilter && <Link className="secondary" href={libraryHref(query, {}, true)}>{t.clear}</Link>}
          {query.q && <Link className="secondary" href={libraryHref(query, { q: undefined })}>{t.clearSearch}</Link>}
        </div>
      </form>
      {query.category === "restaurant" && <p><Link className="secondary" href={libraryHref(query).replace("/library", "/map")}>{restaurantMessages[locale].map}</Link></p>}
      <div className="results-row" role="status"><strong>{filtered.length}</strong> {t.results}</div>
      <div className="masonry-grid">{visible.map((item) => <PublicationCard item={item} locale={locale} key={item.id} />)}</div>
      {filtered.length === 0 && <div className="empty-state"><h2>{t.empty}</h2><p>{t.emptyHelp}</p><Link className="secondary" href={libraryHref({}, { category: query.category })}>{t.clear}</Link></div>}
      {totalPages > 1 && <nav className="pagination" aria-label={t.pagination}>{Array.from({ length: totalPages }, (_, index) => {
        const page = index + 1;
        return <Link className={page === currentPage ? "active" : ""} aria-current={page === currentPage ? "page" : undefined} href={libraryHref(query, { page: String(page) })} key={page}>{page}</Link>;
      })}</nav>}
    </div>
  );
}
