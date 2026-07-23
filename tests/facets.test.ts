import { describe, expect, test } from "bun:test";
import { normalizeFacets } from "../src/lib/facets";

describe("analysis facet normalization", () => {
  test("wraps legacy flat recipe facets", () => {
    expect(normalizeFacets("recipe", {
      nutritionGoals: ["cutting"],
      foodStyles: ["gym", "gourmet"],
    })).toEqual({
      recipe: {
        nutritionGoals: ["cutting"],
        foodStyles: ["gym", "gourmet"],
      },
    });
  });

  test("keeps already nested facets unchanged", () => {
    const facets = { restaurant: { cuisine: ["italiana"], budget: "€€" } };
    expect(normalizeFacets("restaurant", facets)).toBe(facets);
  });

  test("does not attach unrelated facets to unsupported categories", () => {
    const facets = { topic: ["hardware"] };
    expect(normalizeFacets("technology", facets)).toBe(facets);
  });
});
