import type { ContentItem } from "./content";

export const categoryFilters = {
  restaurant: [
    { name: "cuisine", field: "cuisine" },
    { name: "budget", field: "budget" },
    { name: "occasion", field: "occasion" },
    { name: "feature", field: "features" },
  ],
  recipe: [
    { name: "recipeGoal", field: "nutritionGoals" },
    { name: "recipeStyle", field: "foodStyles" },
    { name: "dietaryTag", field: "dietaryTags" },
    { name: "mealType", field: "mealType" },
  ],
  fitness: [
    { name: "fitnessGoal", field: "goals" },
    { name: "muscleGroup", field: "muscleGroups" },
    { name: "equipment", field: "equipment" },
    { name: "difficulty", field: "difficulty" },
  ],
} as const;

export type LibraryQuery = Record<string, string | undefined>;
export type FilterName = (typeof categoryFilters)[keyof typeof categoryFilters][number]["name"];
const filterNames = Object.values(categoryFilters).flat().map(({ name }) => name);

export function filtersFor(category?: string) {
  return categoryFilters[category as keyof typeof categoryFilters] ?? [];
}

function facetValues(item: ContentItem, field: string): string[] {
  const facet = item.facets[item.category];
  if (!facet || typeof facet !== "object") return [];
  const value = (facet as Record<string, unknown>)[field];
  return (Array.isArray(value) ? value : [value]).filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()));
}

export function matchesFilters(item: ContentItem, query: LibraryQuery, except?: string) {
  return (!query.category || item.category === query.category) && filtersFor(query.category).every(({ name, field }) =>
    name === except || !query[name] || facetValues(item, field).includes(query[name]!));
}

// Each option keeps the other selected filters, so it describes available results.
export function filterOptions(items: ContentItem[], query: LibraryQuery, name: FilterName) {
  const field = filtersFor(query.category).find((filter) => filter.name === name)?.field;
  if (!field) return [];
  const values = new Set(items.filter((item) => matchesFilters(item, query, name)).flatMap((item) => facetValues(item, field)));
  if (query[name]) values.add(query[name]!);
  return [...values].sort();
}

export function libraryHref(query: LibraryQuery, changes: LibraryQuery = {}, clearFacets = false) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, page: undefined, ...changes })) {
    if (value && !(clearFacets && filterNames.includes(key as FilterName))) params.set(key, value);
  }
  return `/library${params.size ? `?${params}` : ""}`;
}

// Carry library context across detail pages, including the return page.
export function publicationHref(id: string, query: LibraryQuery = {}) {
  const params = new URLSearchParams();
  for (const key of ["q", "category", "page", ...filterNames]) {
    if (query[key]) params.set(key, query[key]!);
  }
  return `/publications/${encodeURIComponent(id)}${params.size ? `?${params}` : ""}`;
}

export function publicationNeighbors(items: ContentItem[], id: string, query: LibraryQuery) {
  const filtered = items.filter((item) => matchesFilters(item, query));
  const index = filtered.findIndex((item) => item.id === id);
  return {
    previous: index > 0 ? filtered[index - 1] : null,
    next: index >= 0 ? filtered[index + 1] ?? null : null,
  };
}
