import { expect, test } from "bun:test";
import { savedOrderPlan, savedSnapshotShortcodes } from "../src/lib/saved-order";
import { withPostgresDatabase, runPostgresScript } from "./postgres";

test("saved-list parsing preserves response sequence and rejects ambiguous input", () => {
  expect(savedSnapshotShortcodes('{"shortcode":"latest","metadata":{"caption":"line\u2028separator"}}\n{"shortcode":"earlier"}\n')).toEqual(["latest", "earlier"]);
  expect(() => savedSnapshotShortcodes("\n")).toThrow("empty");
  expect(() => savedSnapshotShortcodes('{"shortcode":"same"}\n{"shortcode":"same"}')).toThrow("Duplicate");
  expect(() => savedSnapshotShortcodes('{"shortcode":"valid"}\nbroken')).toThrow("line 2");
  expect(() => savedSnapshotShortcodes('{"shortcode":null}')).toThrow();
  expect(() => savedSnapshotShortcodes('{"shortcode":"bad/extra"}')).toThrow();
});

test("repair puts known saves in one sequence and leaves unmatched entries unknown", () => {
  expect(savedOrderPlan([
    { id: "bulk", shortcode: "latest", saved_order: null },
    { id: "legacy", shortcode: "earlier", saved_order: 1 },
    { id: "not-in-partial-list", shortcode: "unseen", saved_order: 2 },
  ], ["latest", "not-imported", "earlier"])).toEqual([
    { id: "bulk", before: null, after: 1 },
    { id: "legacy", before: 1, after: 3 },
    { id: "not-in-partial-list", before: 2, after: null },
  ]);
});

test("saved-order CLI dry-run, backup, idempotency and rollback use synthetic PostgreSQL", async () => {
  await withPostgresDatabase(async (databaseUrl) => {
    const result = runPostgresScript(`
      import assert from 'node:assert/strict';
      import {writeFileSync,readFileSync,statSync} from 'node:fs';
      import {join} from 'node:path';
      import {spawnSync} from 'node:child_process';
      import {db,pool,authPool,migrateAppDatabase} from './src/lib/db.ts';
      import {listContent} from './src/lib/content.ts';
      await migrateAppDatabase();
      await db.execute("INSERT INTO publications(id,source_url,shortcode,saved_order,caption,processing_status,created_at) VALUES ('bulk','https://www.instagram.com/reel/latest/','latest',NULL,'keep this caption automation','analyzed','2026-10-26'),('legacy','https://www.instagram.com/reel/earlier/','earlier',1,'legacy caption','analyzed','2026-07-22'),('unknown','https://www.instagram.com/reel/unseen/','unseen',2,'not in snapshot','analyzed','2026-10-27')");
      await db.execute("INSERT INTO analyses(publication_id,category,title,summary,visual_description,confidence) VALUES ('legacy','technology','automation','','',0.9),('bulk','technology','other topic','','',0.9)");
      const snapshot=join(process.env.CURATOR_DATA_DIR,'saved.jsonl');
      writeFileSync(snapshot,JSON.stringify({shortcode:'latest'})+'\\n'+JSON.stringify({shortcode:'earlier'})+'\\n');
      const cli=(apply=false)=>spawnSync('bun',['run','scripts/repair-saved-order.ts','--snapshot',snapshot,...(apply?['--apply']:[])],{cwd:process.cwd(),env:process.env,encoding:'utf8'});
      const orders=async()=>await db.all('SELECT id,saved_order FROM publications ORDER BY id');
      const before=await orders();
      let run=cli();assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).applied,false);assert.deepEqual(await orders(),before);
      run=cli(true);assert.equal(run.status,0,run.stderr);const summary=JSON.parse(run.stdout);
      assert.equal(summary.matched,2);assert.equal(summary.unknown,1);assert.equal(summary.changed,3);
      assert.equal(statSync(summary.backupPath).mode & 0o777,0o600);
      const backup=JSON.parse(readFileSync(summary.backupPath,'utf8'));assert.equal(backup.changes.length,3);
      assert.deepEqual((await listContent({sort:'newest'})).map(x=>x.id),['bulk','legacy','unknown']);
      assert.deepEqual((await listContent({sort:'oldest'})).map(x=>x.id),['legacy','bulk','unknown']);
      assert.deepEqual((await listContent({query:'automation'})).map(x=>x.id),['legacy','bulk']);
      assert.deepEqual((await listContent({query:'automation',sort:'newest'})).map(x=>x.id),['bulk','legacy']);
      assert.deepEqual((await listContent({sort:'recently_added'})).map(x=>x.id),['unknown','bulk','legacy']);
      assert.equal((await db.one("SELECT caption FROM publications WHERE id='bulk'")).caption,'keep this caption automation');
      run=cli(true);assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).changed,0);assert.equal(JSON.parse(run.stdout).backupPath,null);
      // A failure after an earlier row update must roll back the entire repair.
      await db.execute("UPDATE publications SET saved_order=8");const rollbackBefore=await orders();
      await db.execute("CREATE FUNCTION reject_order_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='legacy' THEN RAISE EXCEPTION 'synthetic update failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_order_update BEFORE UPDATE OF saved_order ON publications FOR EACH ROW EXECUTE FUNCTION reject_order_update()");
      run=cli(true);assert.notEqual(run.status,0);assert.match(run.stderr,/synthetic update failure/);assert.deepEqual(await orders(),rollbackBefore);
      writeFileSync(snapshot,JSON.stringify({shortcode:'noMatch'}));run=cli(true);assert.notEqual(run.status,0);assert.match(run.stderr,/matches no/);assert.deepEqual(await orders(),rollbackBefore);
      await pool.end();await authPool.end();
    `, databaseUrl);
    expect(result.status, result.stderr).toBe(0);
  });
});
