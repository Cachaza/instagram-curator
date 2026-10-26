const MAX_SEARCH_TERMS = 12;

const STOP_WORDS = new Set([
  "a", "al", "algo", "como", "con", "de", "del", "el", "en", "es", "esta",
  "este", "la", "las", "lo", "los", "o", "para", "por", "que", "se", "sin",
  "su", "sus", "un", "una", "unos", "unas", "y",
  "a", "an", "and", "for", "in", "is", "of", "on", "or", "the", "to", "with",
]);

export function searchTerms(query: string): string[] {
  const terms = [...new Set(
    query
      .normalize("NFC")
      .toLocaleLowerCase("es")
      .trim()
      .split(/\s+/u)
      .map((term) => term.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
      .filter(Boolean),
  )].slice(0, MAX_SEARCH_TERMS);
  return terms.filter((term) => !STOP_WORDS.has(term));
}

export function ftsQuery(query: string): string {
  return searchTerms(query)
    .map((term) => `'${term.replaceAll("\\", "\\\\").replaceAll("'", "''")}':*`)
    .join(" & ");
}
