import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const fixtureDir = mkdtempSync(join(tmpdir(), "curator-search-v3-"));
afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

describe("FTS migration v2 to v3", () => {
  test("indexes ready publications, tracks analyses once, and retains raw text after deletion", () => {
    const script = `
      import { db, migrateAppDatabase } from "./src/lib/db.ts";
      import { listContent, getContent } from "./src/lib/content.ts";
      const run = (sql, ...args) => db.prepare(sql).run(...args);
      run("INSERT INTO publications(id,source_url,author,caption,transcript_text,processing_status) VALUES (?,?,?,?,?,'ready_for_analysis')", "ready", "https://www.instagram.com/reel/ready/", "Cocinando", "Tarta casera", "hornear manzana");
      run("INSERT INTO publications(id,source_url,caption,processing_status) VALUES (?,?,?,'pending')", "pending", "https://www.instagram.com/reel/pending/", "manzana privada");
      run("INSERT INTO publications(id,source_url,caption,processing_status) VALUES (?,?,?,'failed')", "failed", "https://www.instagram.com/reel/failed/", "manzana fallida");
      // Recreate the v2 schema state to verify an in-place upgrade of an existing DB.
      db.exec("DROP TRIGGER content_search_analysis_insert; DROP TRIGGER content_search_analysis_update; DROP TRIGGER content_search_analysis_delete; DROP TRIGGER content_search_publication_update; DROP TRIGGER content_search_publication_delete; DROP TRIGGER content_search_review_insert; DROP TRIGGER content_search_review_update; DROP TRIGGER content_search_review_delete; DROP VIEW content_search_documents;");
      db.exec("CREATE VIEW content_search_documents AS SELECT p.id publication_id, COALESCE(json_extract(r.corrected_analysis_json,'$.title'),a.title,'') title, COALESCE(json_extract(r.corrected_analysis_json,'$.tags'),a.tags_json,'') tags, COALESCE(json_extract(r.corrected_analysis_json,'$.summary'),a.summary,'') summary, concat_ws(' ',p.author,p.caption,p.transcript_text,COALESCE(r.corrected_category,a.category),a.subcategory,a.visual_description,a.why_interesting,a.next_action,a.entities_json,a.facets_json,r.corrected_analysis_json,r.notes) body FROM publications p JOIN analyses a ON a.publication_id=p.id LEFT JOIN publication_reviews r ON r.publication_id=p.id;");
      db.exec("CREATE TRIGGER content_search_analysis_insert AFTER INSERT ON analyses BEGIN INSERT INTO content_search SELECT publication_id,title,tags,summary,body FROM content_search_documents WHERE publication_id=NEW.publication_id; END;");
      db.exec("CREATE TRIGGER content_search_analysis_update AFTER UPDATE ON analyses BEGIN DELETE FROM content_search WHERE publication_id=NEW.publication_id; INSERT INTO content_search SELECT publication_id,title,tags,summary,body FROM content_search_documents WHERE publication_id=NEW.publication_id; END;");
      db.exec("CREATE TRIGGER content_search_analysis_delete AFTER DELETE ON analyses BEGIN DELETE FROM content_search WHERE publication_id=OLD.publication_id; END;");
      db.exec("CREATE TRIGGER content_search_publication_update AFTER UPDATE OF author,caption,transcript_text ON publications BEGIN DELETE FROM content_search WHERE publication_id=NEW.id; INSERT INTO content_search SELECT publication_id,title,tags,summary,body FROM content_search_documents WHERE publication_id=NEW.id; END;");
      db.exec("CREATE TRIGGER content_search_publication_delete AFTER DELETE ON publications BEGIN DELETE FROM content_search WHERE publication_id=OLD.id; END;");
      db.exec("CREATE TRIGGER content_search_review_insert AFTER INSERT ON publication_reviews BEGIN DELETE FROM content_search WHERE publication_id=NEW.publication_id; INSERT INTO content_search SELECT publication_id,title,tags,summary,body FROM content_search_documents WHERE publication_id=NEW.publication_id; END;");
      db.exec("CREATE TRIGGER content_search_review_update AFTER UPDATE ON publication_reviews BEGIN DELETE FROM content_search WHERE publication_id=NEW.publication_id; INSERT INTO content_search SELECT publication_id,title,tags,summary,body FROM content_search_documents WHERE publication_id=NEW.publication_id; END;");
      db.exec("CREATE TRIGGER content_search_review_delete AFTER DELETE ON publication_reviews BEGIN DELETE FROM content_search WHERE publication_id=OLD.publication_id; INSERT INTO content_search SELECT publication_id,title,tags,summary,body FROM content_search_documents WHERE publication_id=OLD.publication_id; END;");
      db.exec("DELETE FROM content_search; DELETE FROM schema_migrations WHERE version=3;");
      migrateAppDatabase();
      const indexed = (q) => db.prepare("SELECT count(*) n FROM content_search WHERE content_search MATCH ?").get(q).n;
      const rawVisible = listContent({ query: "manzana" }).map(x => x.id);
      const ready = getContent("ready");
      const results = { version: db.prepare("SELECT name FROM schema_migrations WHERE version=3").get()?.name, rawVisible, title: ready?.title, category: ready?.category, status: ready?.processingStatus, ftsCount: db.prepare("SELECT count(*) n FROM content_search WHERE publication_id='ready'").get().n, pendingSearch: indexed('privada'), failedSearch: indexed('fallida') };
      run("INSERT INTO analyses(publication_id,category,title,summary,visual_description,confidence) VALUES ('ready','food','Analysis title','','',0.9)");
      results.afterInsertCount = db.prepare("SELECT count(*) n FROM content_search WHERE publication_id='ready'").get().n;
      run("UPDATE analyses SET title='Updated analysis' WHERE publication_id='ready'");
      results.afterUpdateCount = db.prepare("SELECT count(*) n FROM content_search WHERE publication_id='ready'").get().n;
      results.afterUpdateSearch = listContent({ query: "updated" }).map(x => x.id);
      run("DELETE FROM analyses WHERE publication_id='ready'");
      results.afterDeleteCount = db.prepare("SELECT count(*) n FROM content_search WHERE publication_id='ready'").get().n;
      results.afterDeleteSearch = listContent({ query: "hornear" }).map(x => x.id);
      results.afterDeleteTitle = getContent("ready")?.title;
      db.close();
      console.log(JSON.stringify(results));
    `;
    const result = spawnSync("node", ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: { ...process.env, CURATOR_DATA_DIR: fixtureDir },
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
    expect(output).toEqual({
      version: "fts-search-unanalysed-publications",
      rawVisible: ["ready"],
      title: "Tarta casera",
      category: "unknown",
      status: "ready_for_analysis",
      ftsCount: 1,
      pendingSearch: 0,
      failedSearch: 0,
      afterInsertCount: 1,
      afterUpdateCount: 1,
      afterUpdateSearch: ["ready"],
      afterDeleteCount: 1,
      afterDeleteSearch: ["ready"],
      afterDeleteTitle: "Tarta casera",
    });
  });
});
