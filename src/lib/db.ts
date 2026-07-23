import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dataDir, databasePath } from "./paths";

mkdirSync(dataDir, { recursive: true, mode: 0o700 });

export const db = new Database(databasePath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

export function migrateAppDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      is_secret INTEGER NOT NULL DEFAULT 0 CHECK(is_secret IN (0, 1)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS publications (
      id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL DEFAULT 'instagram',
      shortcode TEXT,
      author TEXT,
      caption TEXT,
      instagram_json TEXT,
      media_type TEXT,
      processing_status TEXT NOT NULL DEFAULT 'pending'
        CHECK(processing_status IN (
          'pending', 'downloading', 'extracting_media', 'transcribing',
          'ready_for_analysis', 'analyzing', 'ready_for_review', 'analyzed', 'failed'
        )),
      current_stage TEXT NOT NULL DEFAULT 'pending',
      review_status TEXT NOT NULL DEFAULT 'unreviewed'
        CHECK(review_status IN ('unreviewed','approved','corrected','discarded')),
      action_status TEXT NOT NULL DEFAULT 'inbox'
        CHECK(action_status IN ('inbox','action','someday','reference','done')),
      video_path TEXT,
      audio_path TEXT,
      transcript_path TEXT,
      transcript_text TEXT,
      contact_sheet_path TEXT,
      frames_json TEXT NOT NULL DEFAULT '[]',
      published_at TEXT,
      saved_order INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      leased_at TEXT,
      lease_until TEXT,
      last_error TEXT,
      created_by_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pipeline_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS analyses (
      publication_id TEXT PRIMARY KEY REFERENCES publications(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      subcategory TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      visual_description TEXT NOT NULL,
      why_interesting TEXT,
      next_action TEXT,
      ai_action_status TEXT NOT NULL DEFAULT 'inbox'
        CHECK(ai_action_status IN ('inbox','action','someday','reference','done')),
      tags_json TEXT NOT NULL DEFAULT '[]',
      entities_json TEXT NOT NULL DEFAULT '{}',
      facets_json TEXT NOT NULL DEFAULT '{}',
      legacy_entities_json TEXT,
      confidence REAL NOT NULL,
      needs_review INTEGER NOT NULL DEFAULT 0,
      review_reason TEXT,
      codex_notes TEXT,
      prompt_version TEXT NOT NULL DEFAULT 'v2',
      output_locale TEXT NOT NULL DEFAULT 'es',
      analyzed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS analysis_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      analysis_json TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'codex',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS publication_reviews (
      publication_id TEXT PRIMARY KEY REFERENCES publications(id) ON DELETE CASCADE,
      review_status TEXT NOT NULL
        CHECK(review_status IN ('unreviewed','approved','corrected','discarded')),
      action_status TEXT NOT NULL
        CHECK(action_status IN ('inbox','action','someday','reference','done')),
      corrected_category TEXT,
      corrected_analysis_json TEXT,
      notes TEXT,
      discarded_reason TEXT,
      reviewed_by_user_id TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_publications_queue
      ON publications(processing_status, created_at);
    CREATE INDEX IF NOT EXISTS idx_publications_creator
      ON publications(created_by_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_pipeline_events_publication
      ON pipeline_events(publication_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_analyses_category
      ON analyses(category, subcategory);
  `);

  // Existing development databases created before the complete model need the
  // same additive columns. SQLite has no IF NOT EXISTS for ADD COLUMN.
  const columns = new Set(
    (db.prepare("PRAGMA table_info(publications)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  const additions: Array<[string, string]> = [
    ["author", "TEXT"],
    ["caption", "TEXT"],
    ["instagram_json", "TEXT"],
    ["review_status", "TEXT NOT NULL DEFAULT 'unreviewed'"],
    ["action_status", "TEXT NOT NULL DEFAULT 'inbox'"],
    ["video_path", "TEXT"],
    ["audio_path", "TEXT"],
    ["transcript_path", "TEXT"],
    ["transcript_text", "TEXT"],
    ["contact_sheet_path", "TEXT"],
    ["frames_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["published_at", "TEXT"],
    ["saved_order", "INTEGER"],
    ["leased_at", "TEXT"],
    ["lease_until", "TEXT"],
  ];
  const addedSavedOrder = !columns.has("saved_order");
  for (const [name, definition] of additions) {
    if (!columns.has(name)) db.exec(`ALTER TABLE publications ADD COLUMN ${name} ${definition}`);
  }
  if (addedSavedOrder) {
    db.exec("UPDATE publications SET saved_order=rowid WHERE id LIKE 'reel_%'");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_publications_review
      ON publications(review_status, processing_status);
    CREATE INDEX IF NOT EXISTS idx_publications_action
      ON publications(action_status, processing_status);
    CREATE INDEX IF NOT EXISTS idx_publications_saved_order
      ON publications(saved_order);
  `);
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (?,?)")
    .run(1, "complete-curator-model");
}

migrateAppDatabase();
