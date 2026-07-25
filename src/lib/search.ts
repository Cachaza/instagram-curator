const MAX_SEARCH_TERMS = 12;

export function searchTerms(query: string): string[] {
  return [...new Set(
    query
      .normalize("NFC")
      .trim()
      .split(/\s+/u)
      .map((term) => term.replace(/[%_\\]/gu, "\\$&"))
      .filter(Boolean),
  )].slice(0, MAX_SEARCH_TERMS);
}

