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

test("concurrent public bootstrap creates exactly one administrator", async () => {
  await withPostgresDatabase(async (url) => {
    const result=runPostgresScript(`
      import assert from 'node:assert/strict';
      import {db,pool,authPool,migrateAppDatabase} from './src/lib/db.ts';
      import {auth} from './src/lib/auth.ts';
      await migrateAppDatabase();
      const results=await Promise.allSettled(['first','second'].map(name=>auth.api.signUpEmail({body:{name,email:name+'@example.invalid',password:'synthetic-fixture-password'}})));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(results.filter(r=>r.status==='rejected').length,1);
      assert.equal((await db.one('SELECT COUNT(*) count FROM "user"')).count,1);
      assert.equal((await db.one('SELECT role FROM "user"')).role,'admin');
      await pool.end();await authPool.end();
    `,url);
    expect(result.status,result.stderr).toBe(0);
  });
});


test("concurrent retries cannot reset work already retried or claimed", async () => {
  await withPostgresDatabase(async (url) => {
    const result=runPostgresScript(`
      import assert from 'node:assert/strict';
      import {db,pool,migrateAppDatabase} from './src/lib/db.ts';
      import {retryPublication} from './src/lib/retry.ts';
      await migrateAppDatabase();
      await db.execute("INSERT INTO publications(id,source_url,processing_status,current_stage) VALUES ('retry','https://www.instagram.com/reel/retry/','failed','analyzing')");
      const results=await Promise.all([retryPublication('retry'),retryPublication('retry')]);
      assert.equal(results.filter(r=>'next' in r).length,1);
      assert.equal(results.filter(r=>r.error==='not_failed').length,1);
      await db.execute("UPDATE publications SET processing_status='analyzing' WHERE id='retry'");
      assert.equal((await retryPublication('retry')).error,'not_failed');
      assert.equal((await db.one("SELECT processing_status FROM publications WHERE id='retry'")).processing_status,'analyzing');
      assert.equal((await db.one('SELECT COUNT(*) count FROM pipeline_events')).count,1);
      await pool.end();
    `,url);
    expect(result.status,result.stderr).toBe(0);
  });
});


test("concurrent setup returns one stable share token without replacing it", async () => {
  await withPostgresDatabase(async (url) => {
    const result=runPostgresScript(`
      import assert from 'node:assert/strict';
      import {pool,migrateAppDatabase} from './src/lib/db.ts';
      import {createShareToken,verifyShareToken,getSetting} from './src/lib/settings.ts';
      await migrateAppDatabase();
      const results=await Promise.all([createShareToken(),createShareToken()]);
      const returned=results.filter(token=>typeof token==='string');
      assert.equal(returned.length,1);
      assert.equal(await verifyShareToken(returned[0]),true);
      assert.equal(await getSetting('api.share_token',null),returned[0]);
      assert.equal(await createShareToken(),undefined);
      assert.equal(await verifyShareToken(returned[0]),true);
      await pool.end();
    `,url);
    expect(result.status,result.stderr).toBe(0);
  });
});
