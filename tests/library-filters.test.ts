import { describe, expect, test } from "bun:test";
import type { ContentItem } from "../src/lib/content";
import { filterOptions, libraryHref, matchesFilters, publicationHref, publicationNeighbors } from "../src/lib/library-filters";

function item(category: string, facets: Record<string, unknown>) {
  return { category, facets: { [category]: facets } } as ContentItem;
}

const restaurants = [
  item("restaurant", { cuisine: ["Italian"], budget: "€€", features: ["terrace"] }),
  item("restaurant", { cuisine: ["Japanese"], budget: "€€€", features: [] }),
  item("restaurant", { cuisine: ["Spanish"], budget: "€€", features: [] }),
];

describe("library category filters", () => {
  test("combines category, scalar and array facets", () => {
    const query = { category: "restaurant", budget: "€€", feature: "terrace" };
    expect(restaurants.filter((entry) => matchesFilters(entry, query))).toEqual([restaurants[0]]);
    expect(matchesFilters(item("recipe", {}), query)).toBe(false);
    expect(matchesFilters(item("restaurant", {}), query)).toBe(false);
  });

  test("options respect the other filters without hiding alternatives in the current field", () => {
    const query = { category: "restaurant", cuisine: "Italian", budget: "€€" };
    expect(filterOptions(restaurants, query, "cuisine")).toEqual(["Italian", "Spanish"]);
    expect(filterOptions(restaurants, query, "budget")).toEqual(["€€"]);
  });

  test("keeps an active option visible when a search returns no results", () => {
    expect(filterOptions([], { category: "restaurant", cuisine: "Italian" }, "cuisine")).toEqual(["Italian"]);
  });

  test("ignores unrelated facets and supports dietary and equipment filters", () => {
    expect(matchesFilters(restaurants[0], { category: "restaurant", recipeGoal: "cutting" })).toBe(true);
    expect(matchesFilters(item("recipe", { dietaryTags: ["vegan"] }), { category: "recipe", dietaryTag: "vegan" })).toBe(true);
    expect(matchesFilters(item("fitness", { equipment: ["barbell"] }), { category: "fitness", equipment: "barbell" })).toBe(true);
  });

  test("matches review and action status filters", () => {
    const reviewed = { ...item("restaurant", {}), reviewStatus: "approved", actionStatus: "done" } as ContentItem;
    expect(matchesFilters(reviewed, { review: "approved", action: "done" })).toBe(true);
    expect(matchesFilters(reviewed, { review: "unreviewed" })).toBe(false);
    expect(matchesFilters(reviewed, { action: "all" })).toBe(true);
  });

  test("changing category clears all facets and pagination while preserving search", () => {
    const href = libraryHref({ q: "ramen & noodles", category: "restaurant", cuisine: "Japanese", budget: "€€", occasion: "dinner", page: "2" }, { category: "recipe" }, true);
    const params = new URL(href, "https://curator.invalid").searchParams;
    expect(Object.fromEntries(params)).toEqual({ q: "ramen & noodles", category: "recipe" });
  });

  test("pagination preserves filters; removing search preserves category and filters", () => {
    expect(libraryHref({ q: "dinner", category: "restaurant", feature: "terrace" }, { page: "2" })).toBe("/library?q=dinner&category=restaurant&feature=terrace&page=2");
    expect(libraryHref({ q: "dinner", category: "restaurant", feature: "terrace", page: "2" }, { q: undefined })).toBe("/library?category=restaurant&feature=terrace");
    expect(libraryHref({})).toBe("/library");
  });
});


describe("publication navigation", () => {
  const items = [
    { ...restaurants[0], id: "first" },
    { ...item("recipe", {}), id: "recipe" },
    { ...restaurants[1], id: "second" },
    { ...restaurants[2], id: "third" },
  ];

  test("follows the supplied search order within category and facet filters", () => {
    expect(publicationNeighbors(items, "second", { category: "restaurant" })).toEqual({ previous: items[0], next: items[3] });
    expect(publicationNeighbors(items, "first", { category: "restaurant", budget: "€€" })).toEqual({ previous: null, next: items[3] });
    expect(publicationNeighbors([items[3], items[0]], "third", {})).toEqual({ previous: null, next: items[0] });
  });

  test("does not wrap at boundaries or navigate from an item outside the results", () => {
    expect(publicationNeighbors(items, "first", {})).toEqual({ previous: null, next: items[1] });
    expect(publicationNeighbors(items, "third", {})).toEqual({ previous: items[2], next: null });
    expect(publicationNeighbors(items, "recipe", { category: "restaurant" })).toEqual({ previous: null, next: null });
    expect(publicationNeighbors([], "missing", {})).toEqual({ previous: null, next: null });
  });

  test("carries search, filters and return page safely between detail pages", () => {
    const query = { q: "rice & noodles", category: "restaurant", cuisine: "Japanese", page: "2", sort: "oldest", review: "corrected", action: "done", ignored: "value" };
    const url = new URL(publicationHref("id/with spaces", query), "https://curator.invalid");
    expect(url.pathname).toBe("/publications/id%2Fwith%20spaces");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: query.q, category: query.category, page: "2", cuisine: "Japanese", sort: "oldest", review: "corrected", action: "done" });
    expect(libraryHref(Object.fromEntries(url.searchParams), { page: "2" })).toBe("/library?q=rice+%26+noodles&category=restaurant&page=2&cuisine=Japanese&sort=oldest&review=corrected&action=done");
    expect(publicationHref("first")).toBe("/publications/first");
  });
});
