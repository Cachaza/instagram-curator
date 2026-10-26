import { expect, test } from "bun:test";
import { withPostgresDatabase, runPostgresScript } from "./postgres";

test("SQLite library import preserves values, search, identities, and transaction safety", async () => {
  await withPostgresDatabase(async (databaseUrl) => {
    const script = `
      import assert from 'node:assert/strict';
      import { createHash } from 'node:crypto';
      import { join } from 'node:path';
      import Sqlite from 'better-sqlite3';
      const { migrateAppDatabase, db, pool } = await import('./src/lib/db.ts');
      const { importSqliteLibrary } = await import('./src/lib/postgres-import.ts');
      const { listContent } = await import('./src/lib/content.ts');
      await migrateAppDatabase();
      const source = new Sqlite(join(process.env.CURATOR_DATA_DIR, 'synthetic-library.sqlite'));
      source.exec(\`
        CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL, image TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, role TEXT NOT NULL, banned INTEGER, banReason TEXT, banExpires TEXT);
        CREATE TABLE account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL, userId TEXT NOT NULL, accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt TEXT, refreshTokenExpiresAt TEXT, scope TEXT, password TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
        CREATE TABLE session (id TEXT PRIMARY KEY, expiresAt TEXT NOT NULL, token TEXT NOT NULL UNIQUE, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL, impersonatedBy TEXT);
        CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt TEXT NOT NULL, createdAt TEXT, updatedAt TEXT);
        CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, is_secret INTEGER NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE publications (id TEXT PRIMARY KEY, source_url TEXT NOT NULL UNIQUE, source_type TEXT NOT NULL, shortcode TEXT, author TEXT, caption TEXT, instagram_json TEXT, media_type TEXT, processing_status TEXT NOT NULL, current_stage TEXT NOT NULL, review_status TEXT NOT NULL, action_status TEXT NOT NULL, video_path TEXT, audio_path TEXT, transcript_path TEXT, transcript_text TEXT, contact_sheet_path TEXT, frames_json TEXT NOT NULL, published_at TEXT, saved_order INTEGER, attempts INTEGER NOT NULL, leased_at TEXT, lease_until TEXT, last_error TEXT, created_by_user_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE analyses (publication_id TEXT PRIMARY KEY, category TEXT NOT NULL, subcategory TEXT, title TEXT NOT NULL, summary TEXT NOT NULL, visual_description TEXT NOT NULL, why_interesting TEXT, next_action TEXT, ai_action_status TEXT NOT NULL, tags_json TEXT NOT NULL, entities_json TEXT NOT NULL, facets_json TEXT NOT NULL, legacy_entities_json TEXT, confidence REAL NOT NULL, needs_review INTEGER NOT NULL, review_reason TEXT, codex_notes TEXT, prompt_version TEXT NOT NULL, output_locale TEXT NOT NULL, analyzed_at TEXT NOT NULL);
        CREATE TABLE analysis_versions (id INTEGER PRIMARY KEY, publication_id TEXT NOT NULL, analysis_json TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE publication_reviews (publication_id TEXT PRIMARY KEY, review_status TEXT NOT NULL, action_status TEXT NOT NULL, corrected_category TEXT, corrected_analysis_json TEXT, notes TEXT, discarded_reason TEXT, reviewed_by_user_id TEXT, reviewed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE pipeline_events (id INTEGER PRIMARY KEY, publication_id TEXT NOT NULL, stage TEXT NOT NULL, event_type TEXT NOT NULL, message TEXT, created_at TEXT NOT NULL);
        CREATE TABLE codex_usage (thread_id TEXT PRIMARY KEY, publication_id TEXT, turn_id TEXT, model TEXT, reasoning_effort TEXT NOT NULL, status TEXT NOT NULL, input_tokens INTEGER, cached_input_tokens INTEGER, output_tokens INTEGER, reasoning_output_tokens INTEGER, total_tokens INTEGER, estimated_credits_micros INTEGER, estimated_usd_micros INTEGER, started_at TEXT NOT NULL, completed_at TEXT);
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
      \`);
      const timestamp = '2025-02-03T04:05:06.000Z';
      source.prepare('INSERT INTO "user" VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('user-stable','Synthetic User','synthetic@example.invalid',1,null,timestamp,timestamp,'admin',0,null,null);
      source.prepare('INSERT INTO account VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('account-stable','synthetic@example.invalid','credential','user-stable',null,null,null,null,null,null,'synthetic-hash-only',timestamp,timestamp);
      source.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?)').run('session-stable', '2026-02-03T04:05:06.000Z','synthetic-session-token',timestamp,timestamp,'127.0.0.1','synthetic test','user-stable',null);
      source.prepare('INSERT INTO verification VALUES (?,?,?,?,?,?)').run('verification-stable','synthetic@example.invalid','synthetic-value','2025-02-04T04:05:06.000Z',timestamp,timestamp);
      source.prepare('INSERT INTO app_settings VALUES (?,?,?,?)').run('openai_api_key','"synthetic-secret-value"',1,timestamp);
      source.prepare('INSERT INTO publications VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('publication-stable','https://www.instagram.com/reel/synthetic/','instagram','synthetic','Synthetic Chef','Synthetic caption phrase','{"synthetic":true}','video','analyzed','complete','corrected','action','/tmp/synthetic-video.mp4',null,null,'Synthetic transcript phrase',null,'[{"time":12}]',timestamp,7,2,null,null,'synthetic error','user-stable',timestamp,timestamp);
      source.prepare('INSERT INTO analyses VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('publication-stable','food','dessert','Synthetic analysis phrase','Synthetic summary','Synthetic visual description','Synthetic why','Synthetic next action','action','["synthetic-tag"]','{"entity":"synthetic"}','{"cuisine":"synthetic"}',null,0.875,1,'review required','Synthetic notes','v2','en',timestamp);
      source.prepare('INSERT INTO analysis_versions VALUES (?,?,?,?,?)').run(41,'publication-stable','{"title":"Synthetic historical version"}','codex',timestamp);
      source.prepare('INSERT INTO publication_reviews VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('publication-stable','corrected','action','food','{"title":"Synthetic corrected title"}','Synthetic review notes',null,'user-stable',timestamp,timestamp,timestamp);
      source.prepare('INSERT INTO pipeline_events VALUES (?,?,?,?,?,?)').run(23,'publication-stable','analysis','completed','Synthetic pipeline event',timestamp);
      source.prepare('INSERT INTO codex_usage VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('synthetic-thread','publication-stable','synthetic-turn','synthetic-model','medium','completed',10,2,3,4,17,19,21,timestamp,timestamp);
      source.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(4,'synthetic legacy migration',timestamp);

      const report = await importSqliteLibrary(source);
      const canonical = (rows) => {
        const values = rows.map(row => JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key] instanceof Date ? row[key].toISOString() : row[key]])))).sort();
        return createHash('sha256').update(JSON.stringify(values)).digest('hex');
      };
      const expectedRows = { user:1, account:1, session:1, verification:1, app_settings:1, publications:1, analyses:1, analysis_versions:1, publication_reviews:1, pipeline_events:1, codex_usage:1 };
      for (const [table, count] of Object.entries(expectedRows)) {
        assert.equal(report.tables[table].rows, count, table + ' report row count');
        const columns = (await db.all("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position", [table])).map(row => row.column_name);
        const imported = await db.all('SELECT * FROM "' + table + '"');
        assert.equal(report.tables[table].sha256, canonical(imported.map(row => Object.fromEntries(columns.map(name => [name,row[name]])))), table + ' complete value checksum');
      }
      assert.equal(report.tables.codex_usage.rows, 1);
      assert.deepEqual(await db.one('SELECT email,role,"emailVerified" FROM "user" WHERE id=$1',['user-stable']), {email:'synthetic@example.invalid',role:'admin',emailVerified:true});
      assert.equal((await db.one('SELECT "expiresAt" FROM session WHERE id=$1',['session-stable'])).expiresAt.toISOString(), '2026-02-03T04:05:06.000Z');
      assert.equal((await db.one('SELECT confidence FROM analyses WHERE publication_id=$1',['publication-stable'])).confidence, 0.875);
      assert.equal((await db.one('SELECT value_json,is_secret FROM app_settings WHERE key=$1',['openai_api_key'])).is_secret, 1);
      assert.equal((await db.one('SELECT transcript_text,instagram_json FROM publications WHERE id=$1',['publication-stable'])).transcript_text,'Synthetic transcript phrase');
      assert.equal((await db.one('SELECT id FROM analysis_versions WHERE publication_id=$1',['publication-stable'])).id,41);
      assert.equal((await db.one('SELECT id FROM pipeline_events WHERE publication_id=$1',['publication-stable'])).id,23);
      assert.equal(report.indexedDocuments,1);
      assert.deepEqual((await listContent({query:'caption'})).map(item=>item.id),['publication-stable']);
      assert.deepEqual((await listContent({query:'transcript'})).map(item=>item.id),['publication-stable']);
      assert.deepEqual((await listContent({query:'summary'})).map(item=>item.id),['publication-stable']);
      assert.deepEqual((await listContent({query:'synthetic'})).map(item=>item.id),['publication-stable']);
      await db.execute("INSERT INTO analysis_versions(publication_id,analysis_json) VALUES ('publication-stable','{}')");
      await db.execute("INSERT INTO pipeline_events(publication_id,stage,event_type) VALUES ('publication-stable','test','next')");
      assert.equal((await db.one("SELECT max(id) id FROM analysis_versions")).id,42);
      assert.equal((await db.one("SELECT max(id) id FROM pipeline_events")).id,24);
      await assert.rejects(() => importSqliteLibrary(source), /requires an empty target/);
      assert.equal((await db.one('SELECT count(*)::int n FROM publications')).n,1);
      await pool.end();
      source.close();
    `;
    const result = runPostgresScript(script, databaseUrl);
    expect(result.status, result.stderr + result.stdout).toBe(0);
  });
});

test("SQLite import rolls back earlier tables when its last source table is invalid", async () => {
  await withPostgresDatabase(async (databaseUrl) => {
    const script = `
      import assert from 'node:assert/strict';
      import { join } from 'node:path';
      import Sqlite from 'better-sqlite3';
      const { migrateAppDatabase, db, pool } = await import('./src/lib/db.ts');
      const { importSqliteLibrary } = await import('./src/lib/postgres-import.ts');
      await migrateAppDatabase();
      const source = new Sqlite(join(process.env.CURATOR_DATA_DIR, 'invalid-synthetic-library.sqlite'));
      source.exec(\`
        CREATE TABLE publications (id TEXT PRIMARY KEY, source_url TEXT NOT NULL, source_type TEXT NOT NULL, processing_status TEXT NOT NULL, current_stage TEXT NOT NULL, review_status TEXT NOT NULL, action_status TEXT NOT NULL, frames_json TEXT NOT NULL, attempts INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        INSERT INTO publications VALUES ('rollback-publication','https://www.instagram.com/reel/rollback/','instagram','analyzed','complete','unreviewed','inbox','[]',0,'2025-01-01T00:00:00Z','2025-01-01T00:00:00Z');
        CREATE TABLE codex_usage (thread_id TEXT PRIMARY KEY, reasoning_effort TEXT NOT NULL, started_at TEXT NOT NULL, unmapped_fixture_column TEXT NOT NULL);
        INSERT INTO codex_usage VALUES ('synthetic-invalid','medium','2025-01-01T00:00:00Z','forces rollback');
      \`);
      await assert.rejects(() => importSqliteLibrary(source), /Unmapped column codex_usage\.unmapped_fixture_column/);
      assert.equal((await db.one('SELECT count(*)::int n FROM publications')).n,0);
      assert.equal((await db.one('SELECT count(*)::int n FROM codex_usage')).n,0);
      source.close();
      await pool.end();
    `;
    const result = runPostgresScript(script, databaseUrl);
    expect(result.status, result.stderr + result.stdout).toBe(0);
  });
});
