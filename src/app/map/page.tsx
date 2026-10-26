import Link from "next/link";
import { RestaurantMap } from "@/components/restaurant-map";
import { listContent } from "@/lib/content";
import { appLocale } from "@/lib/i18n";
import { libraryHref, matchesFilters, type LibraryQuery } from "@/lib/library-filters";
import { listRestaurantPlaces, listRestaurantLocationsNeedingConfirmation } from "@/lib/restaurant-locations";
import { restaurantMessages } from "@/lib/restaurant-messages";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function MapPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const locale = await appLocale();
  const t = restaurantMessages[locale];
  const query: LibraryQuery = { ...await searchParams, category: "restaurant" };
  const items = (await listContent({ category: "restaurant", query: query.q })).filter((item) => matchesFilters(item, query));
  const places = await listRestaurantPlaces(items);
  const locationChanges = await listRestaurantLocationsNeedingConfirmation();
  return <div className="page-container">
    <section className="page-hero compact-hero"><h1>{t.title}<span>.</span></h1><p>{t.intro}</p></section>
    <div className="filter-actions"><Link href={libraryHref(query)}>{t.library}</Link><Link href={libraryHref(query)}>{t.filters}</Link></div>
    <form className="library-search" action="/map">
      {Object.entries(query).filter(([key, value]) => key !== "q" && key !== "page" && Boolean(value)).map(([key, value]) => <input type="hidden" name={key} value={value} key={key} />)}
      <label className="library-query">{t.search}<input type="search" name="q" defaultValue={query.q ?? ""} placeholder={t.searchPlaceholder} /></label><button className="secondary">{t.search}</button>
    </form>
    {places.length === 0 && <p>{t.empty}</p>}
    {locationChanges.length > 0 && <details className="place-address"><summary>{t.locationChanges} ({locationChanges.length})</summary><p>{t.locationChangesHelp}</p><ul>{locationChanges.map((change) => <li key={JSON.stringify([change.publicationId, change.placeKey])}>{change.location.label} · <Link href={`/publications/${encodeURIComponent(change.publicationId)}`}>{t.open}</Link> · <a href={`https://www.google.com/maps/search/?api=1&query=${change.location.latitude},${change.location.longitude}`} target="_blank" rel="noreferrer">{t.previousLocation}</a></li>)}</ul></details>}
    <RestaurantMap key={session.user.id} places={places} locale={locale} userId={session.user.id} tileUrl={process.env.CURATOR_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png"} />
  </div>;
}
