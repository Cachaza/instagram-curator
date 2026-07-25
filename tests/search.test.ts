import { describe, expect, test } from "bun:test";
import { searchTerms } from "../src/lib/search";

describe("searchTerms", () => {
  test("turns a multi-word search into independent terms", () => {
    expect(searchTerms("  tarta   queso ")).toEqual(["tarta", "queso"]);
  });

  test("deduplicates terms and escapes LIKE wildcards", () => {
    expect(searchTerms("queso queso 100% _fácil_")).toEqual([
      "queso",
      "100\\%",
      "\\_fácil\\_",
    ]);
  });

  test("limits overly broad queries", () => {
    expect(searchTerms("1 2 3 4 5 6 7 8 9 10 11 12 13")).toHaveLength(12);
  });
});
