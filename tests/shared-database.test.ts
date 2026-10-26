import { expect, test } from "bun:test";
import { withPostgresDatabase, runPostgresScript } from "./postgres";

test("concurrent imports across connections create one queue item and event", async () => {
  await withPostgresDatabase(async (url) => {
    const result = runPostgresScript(`
      import assert from 'node:assert/strict';
      import {db,pool,migrateAppDatabase} from './src/lib/db.ts';
      import {enqueueInstagramUrl} from './src/lib/imports.ts';
      await migrateAppDatabase();
      const results=await Promise.all([
        enqueueInstagramUrl('https://www.instagram.com/reel/sharedfixture/',null),
        enqueueInstagramUrl('https://www.instagram.com/reel/sharedfixture/?utm_source=test',null),
      ]);
      assert.equal(results.filter(r=>r.created).length,1);
      assert.equal(new Set(results.map(r=>r.publicationId)).size,1);
      assert.equal((await db.one('SELECT COUNT(*) count FROM publications')).count,1);
      assert.equal((await db.one('SELECT COUNT(*) count FROM pipeline_events')).count,1);
      await pool.end();
    `,url);
    expect(result.status,result.stderr).toBe(0);
  });
});

test("a second worker refuses ownership before recovering another host's work", async () => {
  await withPostgresDatabase(async (url) => {
    const result = runPostgresScript(`
      import assert from 'node:assert/strict';
      import {spawnSync} from 'node:child_process';
      import {db,pool,migrateAppDatabase} from './src/lib/db.ts';
      await migrateAppDatabase();
      await db.execute("INSERT INTO publications(id,source_url,processing_status) VALUES ('working','https://www.instagram.com/reel/working/','transcribing')");
      const owner=await pool.connect();
      await owner.query("SELECT pg_advisory_lock(hashtextextended('curator-worker',0))");
      const second=spawnSync('node',['--import','tsx','src/worker/cli.ts'],{env:process.env,encoding:'utf8'});
      assert.notEqual(second.status,0);
      assert.match(second.stderr,/capacity is 1 active processing host/);
      assert.equal((await db.one("SELECT processing_status FROM publications WHERE id='working'")).processing_status,'transcribing');
      assert.equal((await db.one('SELECT COUNT(*) count FROM pipeline_events')).count,0);
      await owner.query("SELECT pg_advisory_unlock(hashtextextended('curator-worker',0))");
      owner.release();await pool.end();
    `,url);
    expect(result.status,result.stderr).toBe(0);
  });
});
