import { describe, expect, test } from "bun:test";
import type { ContentItem } from "../src/lib/content";
import { filterOptions, libraryHref, matchesFilters } from "../src/lib/library-filters";

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
