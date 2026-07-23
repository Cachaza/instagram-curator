import { db } from "./db";
import { parseInstagramUrl } from "./instagram-url";

export type ImportResult = {
  publicationId: string;
  status: string;
  created: boolean;
};

export function enqueueInstagramUrl(url: string, userId: string | null): ImportResult {
  const parsed = parseInstagramUrl(url);

  const transaction = db.transaction(() => {
    const existing = db.prepare(
      "SELECT id,processing_status FROM publications WHERE source_url=?",
    ).get(parsed.normalizedUrl) as { id: string; processing_status: string } | undefined;

    if (existing) {
      return {
        publicationId: existing.id,
        status: existing.processing_status,
        created: false,
      };
    }

    db.prepare(`
      INSERT INTO publications(
        id,source_url,shortcode,media_type,processing_status,current_stage,created_by_user_id
      ) VALUES (?,?,?,?,'pending','pending',?)
    `).run(parsed.id, parsed.normalizedUrl, parsed.shortcode, parsed.route === "reel" ? "video" : null, userId);

    db.prepare(`
      INSERT INTO pipeline_events(publication_id,stage,event_type,message)
      VALUES (?,'pending','queued','Publication accepted by import API')
    `).run(parsed.id);

    return {
      publicationId: parsed.id,
      status: "pending",
      created: true,
    };
  });

  const result = transaction();
  wakePipeline();
  return result;
}

function wakePipeline(): void {
  // Phase 2 will notify the supervised media worker. The durable SQLite row is
  // already sufficient to guarantee that accepted work is not lost.
}

export function recentImports(limit = 20) {
  return db.prepare(`
    SELECT id,shortcode,media_type,processing_status,last_error,created_at
    FROM publications ORDER BY created_at DESC LIMIT ?
  `).all(limit) as Array<{
    id: string;
    shortcode: string;
    media_type: string | null;
    processing_status: string;
    last_error: string | null;
    created_at: string;
  }>;
}
