import { db, transaction } from "./db";
import { parseInstagramUrl } from "./instagram-url";

export type ImportResult = {
  publicationId: string;
  status: string;
  created: boolean;
};

export async function enqueueInstagramUrl(url: string, userId: string | null): Promise<ImportResult> {
  const parsed = parseInstagramUrl(url);
  return transaction(async (tx) => {
    // The unique URL is the arbiter across Mac/server imports, not a prior read.
    const inserted = await tx.one<{id: string}>(`
      INSERT INTO publications(id,source_url,shortcode,media_type,created_by_user_id)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT(source_url) DO NOTHING RETURNING id
    `, [parsed.id,parsed.normalizedUrl,parsed.shortcode,parsed.route === "reel" ? "video" : null,userId]);
    const row = await tx.one<{id: string; processing_status: string}>(
      "SELECT id,processing_status FROM publications WHERE source_url=$1", [parsed.normalizedUrl]);
    if (!row) throw new Error("Imported publication could not be read");
    if (inserted) await tx.execute(`INSERT INTO pipeline_events(publication_id,stage,event_type,message)
      VALUES ($1,'pending','queued','Publication accepted by import API')`,[row.id]);
    return { publicationId: row.id, status: row.processing_status, created: Boolean(inserted) };
  });
}

export async function recentImports(limit = 20) {
  return (await db.all(`
    SELECT id,shortcode,media_type,processing_status,last_error,created_at
    FROM publications ORDER BY created_at DESC LIMIT $1
  `,[limit])) as Array<{
    id: string;
    shortcode: string;
    media_type: string | null;
    processing_status: string;
    last_error: string | null;
    created_at: string;
  }>;
}
