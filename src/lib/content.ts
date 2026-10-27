import { db, type Database } from "./db";
import { normalizeFacets } from "./facets";
import { ftsQuery } from "./search";
import { resolveMediaPath } from "./media";

export type ContentItem = {
  id: string;
  sourceUrl: string;
  author: string | null;
  caption: string | null;
  transcript: string | null;
  mediaType: string | null;
  processingStatus: string;
  reviewStatus: string;
  actionStatus: string;
  publishedAt: string;
  hasImage: boolean;
  hasVideo: boolean;
  category: string;
  subcategory: string | null;
  title: string;
  summary: string;
  visualDescription: string;
  whyInteresting: string;
  nextAction: string | null;
  tags: string[];
  entities: Record<string, unknown>;
  facets: Record<string, unknown>;
  confidence: number;
  needsReview: boolean;
  reviewReason: string | null;
  correctedAnalysis: Record<string, unknown> | null;
};

type Row = Record<string, unknown>;

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function merge(base: Record<string, unknown>, correction: Record<string, unknown> | null) {
  return correction ? { ...base, ...correction } : base;
}

function mapRow(row: Row): ContentItem {
  const correction = json<Record<string, unknown> | null>(row.corrected_analysis_json, null);
  const effective = merge({
    category: row.corrected_category ?? row.category,
    subcategory: row.subcategory,
    title: row.title,
    summary: row.summary,
    visualDescription: row.visual_description,
    whyInteresting: row.why_interesting,
    nextAction: row.next_action,
    tags: json(row.tags_json, []),
    entities: json(row.entities_json, {}),
  }, correction);
  const category = String(effective.category ?? "unknown");
  const rawFacets = json<Record<string, unknown>>(row.facets_json, {});
  return {
    id: String(row.id),
    sourceUrl: String(row.source_url),
    author: row.author ? String(row.author) : null,
    caption: row.caption ? String(row.caption) : null,
    transcript: row.transcript_text ? String(row.transcript_text) : null,
    mediaType: row.media_type ? String(row.media_type) : null,
    processingStatus: String(row.processing_status),
    reviewStatus: String(row.review_review_status ?? row.review_status),
    actionStatus: String(row.review_action_status ?? row.action_status),
    publishedAt: String(row.published_at ?? row.created_at),
    hasImage: Boolean(resolveMediaPath(typeof row.contact_sheet_path === "string" ? row.contact_sheet_path : null)),
    hasVideo: Boolean(resolveMediaPath(typeof row.video_path === "string" ? row.video_path : null)),
    category,
    subcategory: effective.subcategory ? String(effective.subcategory) : null,
    title: String(effective.title || (typeof row.caption === "string" && row.caption.trim()) ||
      (typeof row.author === "string" && row.author.trim()) || "Sin título"),
    summary: String(effective.summary ?? ""),
    visualDescription: String(effective.visualDescription ?? effective.visual_description ?? ""),
    whyInteresting: String(effective.whyInteresting ?? effective.why_interesting ?? ""),
    nextAction: effective.nextAction ? String(effective.nextAction) : effective.next_action ? String(effective.next_action) : null,
    tags: Array.isArray(effective.tags) ? effective.tags.map(String) : [],
    entities: typeof effective.entities === "object" && effective.entities ? effective.entities as Record<string, unknown> : {},
    facets: normalizeFacets(category, rawFacets),
    confidence: Number(row.confidence ?? 0),
    needsReview: Boolean(row.needs_review),
    reviewReason: row.review_reason ? String(row.review_reason) : null,
    correctedAnalysis: correction,
  };
}

const SELECT = `
  SELECT p.*,a.category,a.subcategory,a.title,a.summary,a.visual_description,
    a.why_interesting,a.next_action,a.tags_json,a.entities_json,a.facets_json,
    a.confidence,a.needs_review,a.review_reason,a.ai_action_status,
    r.review_status review_review_status,r.action_status review_action_status,
    r.corrected_category,r.corrected_analysis_json,r.notes,r.discarded_reason
  FROM publications p
  LEFT JOIN analyses a ON a.publication_id=p.id
  LEFT JOIN publication_reviews r ON r.publication_id=p.id
`;

const VISIBLE_CONTENT = `(a.publication_id IS NOT NULL OR p.processing_status='analyzed' OR
  (p.processing_status='ready_for_analysis' AND
    (NULLIF(trim(p.caption),'') IS NOT NULL OR NULLIF(trim(p.transcript_text),'') IS NOT NULL)))`;

export async function listContent(options: {
  category?: string; query?: string; review?: string; action?: string; sort?: "newest" | "oldest"; limit?: number;
} = {}): Promise<ContentItem[]> {
  const clauses = [VISIBLE_CONTENT];
  const params: Array<string | number> = [];
  const search = options.query ? ftsQuery(options.query) : "";
  if (options.query?.trim() && !search) return [];
  if (options.category) { params.push(options.category); clauses.push(`COALESCE(r.corrected_category,a.category,'unknown')=$${params.length}`); }
  if (options.review) { params.push(options.review); clauses.push(`COALESCE(r.review_status,p.review_status)=$${params.length}`); }
  if (options.action) { params.push(options.action); clauses.push(`COALESCE(r.action_status,p.action_status)=$${params.length}`); }
  if (search) { params.push(search); clauses.push(`content_search.document @@ to_tsquery('curator_search',$${params.length})`); }
  const limit = options.limit ? ` LIMIT $${params.length + 1}` : "";
  if (options.limit) params.push(options.limit);
  const searchJoin = search
    ? "JOIN content_search ON content_search.publication_id=p.id"
    : "";
  const searchPosition = params.indexOf(search) + 1;
  const searchOrder = search && !options.sort
    ? `ts_rank(content_search.document,to_tsquery('curator_search',$${searchPosition})) DESC,`
    : "";
  const dateOrder = options.sort === "oldest"
    ? `CASE WHEN p.saved_order IS NULL THEN 1 ELSE 0 END,
      CASE WHEN p.saved_order IS NULL THEN p.created_at END ASC,
      p.saved_order DESC,p.id DESC`
    : `CASE WHEN p.saved_order IS NULL THEN 0 ELSE 1 END,
      CASE WHEN p.saved_order IS NULL THEN p.created_at END DESC,
      p.saved_order ASC,p.id ASC`;
  return ((await db.all(`${SELECT} ${searchJoin} WHERE ${clauses.join(" AND ")}
    ORDER BY
      ${searchOrder}
      ${dateOrder}${limit}`,[...params])) as Row[]).map(mapRow);
}

export async function getContent(id: string, database: Database = db): Promise<ContentItem | null> {
  const row = (await database.one(`${SELECT} WHERE p.id=$1 AND ${VISIBLE_CONTENT}`,[id])) as Row | undefined;
  return row ? mapRow(row) : null;
}

export async function categories() {
  return (await db.all(`
    SELECT COALESCE(r.corrected_category,a.category) category,COUNT(*)::int count
    FROM analyses a JOIN publications p ON p.id=a.publication_id
    LEFT JOIN publication_reviews r ON r.publication_id=p.id
    GROUP BY COALESCE(r.corrected_category,a.category) ORDER BY count DESC
  `,[])) as Array<{ category: string; count: number }>;
}
