import { parseInstagramUrl } from "./instagram-url";

/** Preserve the saved-list response sequence; publication dates are unrelated. */
export function savedSnapshotShortcodes(text: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    let entry: unknown;
    try { entry = JSON.parse(line); } catch { throw new Error(`Invalid saved-list JSON at line ${index + 1}. No changes applied.`); }
    const shortcode = entry && typeof entry === "object" && "shortcode" in entry ? entry.shortcode : null;
    if (typeof shortcode !== "string" || parseInstagramUrl(`https://www.instagram.com/p/${shortcode}/`).shortcode !== shortcode) {
      throw new Error(`Invalid saved-list shortcode at line ${index + 1}. No changes applied.`);
    }
    if (seen.has(shortcode)) throw new Error(`Duplicate saved-list shortcode at line ${index + 1}. Use an unambiguous saved-list snapshot.`);
    seen.add(shortcode);
    result.push(shortcode);
  }
  if (!result.length) throw new Error("Saved-list snapshot is empty. No changes applied.");
  return result;
}

export type SavedOrderRow = { id: string; shortcode: string | null; saved_order: number | null };
export function savedOrderPlan(rows: SavedOrderRow[], shortcodes: string[]) {
  const positions = new Map(shortcodes.map((shortcode, index) => [shortcode, index + 1]));
  return rows.map((row) => ({
    id: row.id,
    before: row.saved_order,
    // A partial snapshot establishes only the positions it actually contains.
    // Missing entries remain unknown, never assigned invented chronology.
    after: row.shortcode === null ? null : positions.get(row.shortcode) ?? null,
  }));
}
