import { describe, expect, test } from "bun:test";
import { ftsQuery, searchTerms } from "../src/lib/search";

describe("searchTerms", () => {
  test("turns a multi-word search into independent terms", () => {
    expect(searchTerms("  tarta   queso ")).toEqual(["tarta", "queso"]);
  });

  test("deduplicates terms and strips surrounding punctuation", () => {
    expect(searchTerms("queso queso 100% _fácil_")).toEqual([
      "queso",
      "100",
      "fácil",
    ]);
  });

  test("removes common stop words when useful terms remain", () => {
    expect(searchTerms("tarta de queso con frutas")).toEqual([
      "tarta",
      "queso",
      "frutas",
    ]);
  });

  test("drops a query made entirely of stop words", () => {
    expect(searchTerms("con de")).toEqual([]);
  });

  test("builds a safe prefix FTS query", () => {
    expect(ftsQuery("Tarta de ques")).toBe("'tarta':* & 'ques':*");
  });

  test("limits overly broad queries", () => {
    expect(searchTerms("1 2 3 4 5 6 7 8 9 10 11 12 13")).toHaveLength(12);
  });
});
