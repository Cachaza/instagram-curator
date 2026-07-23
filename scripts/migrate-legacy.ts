/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from "better-sqlite3";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { db, migrateAppDatabase } from "../src/lib/db";
import { dataDir } from "../src/lib/paths";
import { deriveFacets } from "../src/lib/facets";

const args = process.argv.slice(2);
function option(name: string, fallback?: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : fallback;
  if (!value) throw new Error(`Missing ${name}`);
  return resolve(value);
}

const legacyDatabasePath = option(
  "--database",
  "../instagram-curator/data/curator.sqlite",
);
const legacyMediaRoot = option(
  "--media",
  "../instagram-curator/data/reels",
);
const savedImportRoot = resolve(dirname(legacyDatabasePath), "instagram-saved-import");
const targetMediaRoot = resolve(dataDir, "media");
const legacy = new Database(legacyDatabasePath, { readonly: true });
migrateAppDatabase();
mkdirSync(targetMediaRoot, { recursive: true, mode: 0o700 });

const admin = db.prepare(`SELECT id FROM "user" WHERE role='admin' ORDER BY createdAt LIMIT 1`)
  .get() as { id: string } | undefined;
if (!admin) throw new Error("Create the administrator account before migrating legacy data");

type LegacyPublication = Record<string, any>;
const savedOrderByShortcode = new Map<string, number>();
if (existsSync(savedImportRoot)) {
  const metadataFiles = readdirSync(savedImportRoot)
    .filter((name) => !name.startsWith(":") && (name.endsWith(".json") || name.endsWith(".json.xz")))
    .sort((left, right) =>
      statSync(join(savedImportRoot, left)).mtimeMs - statSync(join(savedImportRoot, right)).mtimeMs);
  metadataFiles.forEach((name, index) => {
    savedOrderByShortcode.set(name.replace(/\.json(?:\.xz)?$/, ""), index + 1);
  });
}
const publications = legacy.prepare("SELECT rowid AS legacy_rowid,* FROM reels ORDER BY rowid").all() as LegacyPublication[];
let linked = 0;
let copied = 0;
let missing = 0;

function portablePath(path: string | null): string | null {
  if (!path) return null;
  const absolute = resolve(path);
  if (!absolute.startsWith(`${legacyMediaRoot}/`) && absolute !== legacyMediaRoot) return null;
  return join("media", relative(legacyMediaRoot, absolute));
}

function transferTree(source: string, target: string): void {
  if (!existsSync(source)) {
    missing++;
    return;
  }
  const stat = statSync(source);
  if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(source)) transferTree(join(source, entry), join(target, entry));
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) return;
  try {
    linkSync(source, target);
    linked++;
  } catch {
    copyFileSync(source, target);
    copied++;
  }
}

function mapStatus(status: string): string {
  const statuses: Record<string, string> = {
    pending: "pending",
    downloading: "downloading",
    downloaded: "extracting_media",
    transcribing: "transcribing",
    ready_for_ai: "ready_for_analysis",
    processing_ai: "ready_for_analysis",
    analyzed: "analyzed",
    failed: "failed",
  };
  return statuses[status] ?? "failed";
}

const migratePublication = db.prepare(`
  INSERT INTO publications(
    id,source_url,source_type,shortcode,author,caption,instagram_json,media_type,
    processing_status,current_stage,review_status,action_status,
    video_path,audio_path,transcript_path,transcript_text,contact_sheet_path,frames_json,
    published_at,saved_order,attempts,leased_at,lease_until,last_error,created_by_user_id,created_at,updated_at
  ) VALUES (
    @id,@source_url,'instagram',@shortcode,@author,@caption,@instagram_json,@media_type,
    @processing_status,@current_stage,@review_status,@action_status,
    @video_path,@audio_path,@transcript_path,@transcript_text,@contact_sheet_path,@frames_json,
    @published_at,@saved_order,@attempts,@leased_at,@lease_until,@last_error,@created_by_user_id,@created_at,@updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    source_url=excluded.source_url,shortcode=excluded.shortcode,author=excluded.author,
    caption=excluded.caption,instagram_json=excluded.instagram_json,media_type=excluded.media_type,
    processing_status=excluded.processing_status,current_stage=excluded.current_stage,
    review_status=excluded.review_status,action_status=excluded.action_status,
    video_path=excluded.video_path,audio_path=excluded.audio_path,
    transcript_path=excluded.transcript_path,transcript_text=excluded.transcript_text,
    contact_sheet_path=excluded.contact_sheet_path,frames_json=excluded.frames_json,
    published_at=excluded.published_at,saved_order=excluded.saved_order,
    attempts=excluded.attempts,last_error=excluded.last_error,
    updated_at=excluded.updated_at
`);

const transaction = db.transaction(() => {
  for (const publication of publications) {
    const sourceDir = join(legacyMediaRoot, publication.id);
    const targetDir = join(targetMediaRoot, publication.id);
    transferTree(sourceDir, targetDir);

    const transcriptAbsolute = publication.transcript_path ? resolve(publication.transcript_path) : null;
    const transcriptText = transcriptAbsolute && existsSync(transcriptAbsolute)
      ? readFileSync(transcriptAbsolute, "utf8")
      : null;
    const frames = JSON.parse(publication.frames_json || "[]") as string[];
    const portableFrames = frames.map(portablePath).filter(Boolean);
    const status = mapStatus(publication.processing_status);
    migratePublication.run({
      ...publication,
      source_url: publication.source_url.endsWith("/") ? publication.source_url : `${publication.source_url}/`,
      processing_status: status,
      current_stage: status,
      video_path: portablePath(publication.video_path),
      audio_path: portablePath(publication.audio_path),
      transcript_path: portablePath(publication.transcript_path),
      transcript_text: transcriptText,
      contact_sheet_path: portablePath(publication.contact_sheet_path),
      frames_json: JSON.stringify(portableFrames),
      saved_order: savedOrderByShortcode.get(publication.shortcode)
        ?? savedOrderByShortcode.size + publication.legacy_rowid,
      created_by_user_id: admin.id,
    });
  }

  const analyses = legacy.prepare("SELECT * FROM analyses").all() as Array<Record<string, any>>;
  const insertAnalysis = db.prepare(`
    INSERT INTO analyses(
      publication_id,category,subcategory,title,summary,visual_description,why_interesting,
      next_action,ai_action_status,tags_json,entities_json,facets_json,legacy_entities_json,
      confidence,needs_review,review_reason,codex_notes,prompt_version,output_locale,analyzed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(publication_id) DO UPDATE SET
      category=excluded.category,subcategory=excluded.subcategory,title=excluded.title,
      summary=excluded.summary,visual_description=excluded.visual_description,
      why_interesting=excluded.why_interesting,next_action=excluded.next_action,
      ai_action_status=excluded.ai_action_status,tags_json=excluded.tags_json,
      entities_json=excluded.entities_json,facets_json=excluded.facets_json,
      legacy_entities_json=excluded.legacy_entities_json,confidence=excluded.confidence,
      needs_review=excluded.needs_review,review_reason=excluded.review_reason,
      codex_notes=excluded.codex_notes,prompt_version=excluded.prompt_version,
      output_locale=excluded.output_locale,analyzed_at=excluded.analyzed_at
  `);
  for (const analysis of analyses) {
    const tags = JSON.parse(analysis.tags_json || "[]") as string[];
    const entities = JSON.parse(analysis.entities_json || "{}") as Record<string, unknown>;
    insertAnalysis.run(
      analysis.reel_id, analysis.category, analysis.subcategory, analysis.title,
      analysis.summary, analysis.visual_description, analysis.why_interesting,
      analysis.next_action, analysis.ai_action_status, analysis.tags_json,
      analysis.entities_json, JSON.stringify(deriveFacets(analysis.category, entities, tags)),
      analysis.legacy_entities_json, analysis.confidence, analysis.needs_review,
      analysis.review_reason, analysis.codex_notes, analysis.prompt_version, "es",
      analysis.analyzed_at,
    );
  }

  db.prepare("DELETE FROM analysis_versions").run();
  const versions = legacy.prepare("SELECT * FROM analysis_versions ORDER BY id").all() as Array<Record<string, any>>;
  const insertVersion = db.prepare(`
    INSERT INTO analysis_versions(id,publication_id,analysis_json,source,created_at)
    VALUES (?,?,?,?,?)
  `);
  for (const version of versions) {
    insertVersion.run(version.id, version.reel_id, version.analysis_json, version.source, version.created_at);
  }

  const reviews = legacy.prepare("SELECT * FROM reel_reviews").all() as Array<Record<string, any>>;
  const insertReview = db.prepare(`
    INSERT INTO publication_reviews(
      publication_id,review_status,action_status,corrected_category,corrected_analysis_json,
      notes,discarded_reason,reviewed_by_user_id,reviewed_at,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(publication_id) DO UPDATE SET
      review_status=excluded.review_status,action_status=excluded.action_status,
      corrected_category=excluded.corrected_category,
      corrected_analysis_json=excluded.corrected_analysis_json,notes=excluded.notes,
      discarded_reason=excluded.discarded_reason,reviewed_by_user_id=excluded.reviewed_by_user_id,
      reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at
  `);
  for (const review of reviews) {
    insertReview.run(
      review.reel_id, review.review_status, review.action_status, review.corrected_category,
      review.corrected_analysis_json, review.notes, review.discarded_reason, admin.id,
      review.reviewed_at, review.created_at, review.updated_at,
    );
  }
});

transaction();

const counts = {
  publications: (db.prepare("SELECT COUNT(*) count FROM publications").get() as { count: number }).count,
  transcripts: (db.prepare("SELECT COUNT(*) count FROM publications WHERE transcript_text IS NOT NULL").get() as { count: number }).count,
  analyses: (db.prepare("SELECT COUNT(*) count FROM analyses").get() as { count: number }).count,
  versions: (db.prepare("SELECT COUNT(*) count FROM analysis_versions").get() as { count: number }).count,
  reviews: (db.prepare("SELECT COUNT(*) count FROM publication_reviews").get() as { count: number }).count,
  linkedFiles: linked,
  copiedFiles: copied,
  missingPaths: missing,
};
console.log(JSON.stringify(counts, null, 2));
