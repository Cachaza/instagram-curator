import { expect, test } from "bun:test";
import { withPostgresDatabase, runPostgresScript } from "./postgres";

test("concurrent PostgreSQL migrations create search triggers and index only searchable publications", async () => {
  await withPostgresDatabase(async (databaseUrl) => {
    const script = `
      import assert from 'node:assert/strict';
      import {spawn} from 'node:child_process';
      const url=process.env.DATABASE_URL;
      const children=[0,1].map(()=>spawn('node',['--import','tsx','--input-type=module','-e',"import {migrateAppDatabase,pool} from './src/lib/db.ts'; await migrateAppDatabase(); await pool.end();"],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']}));
      const results=await Promise.all(children.map(child=>new Promise(resolve=>{let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('exit',code=>resolve({code,out,err}));})));
      for(const result of results) assert.equal(result.code,0,result.err);
      const {db,pool}=await import('./src/lib/db.ts');
      const {listContent,getContent}=await import('./src/lib/content.ts');
      await db.execute("INSERT INTO publications(id,source_url,author,caption,transcript_text,processing_status) VALUES ($1,$2,$3,$4,$5,'ready_for_analysis')",['ready','https://www.instagram.com/reel/ready/','Cocinando','Tarta casera','hornear manzana']);
      await db.execute("INSERT INTO publications(id,source_url,caption,processing_status) VALUES ($1,$2,$3,'pending')",['pending','https://www.instagram.com/reel/pending/','manzana privada']);
      await db.execute("INSERT INTO publications(id,source_url,caption,processing_status) VALUES ($1,$2,$3,'failed')",['failed','https://www.instagram.com/reel/failed/','manzana fallida']);
      assert.deepEqual((await db.all('SELECT version FROM schema_migrations WHERE version=5')).length,1);
      assert.equal((await db.one("SELECT count(*)::int n FROM content_search WHERE publication_id='ready'")).n,1);
      assert.equal((await db.one("SELECT count(*)::int n FROM content_search WHERE publication_id IN ('pending','failed')")).n,0);
      assert.deepEqual((await listContent({query:'manzana'})).map(x=>x.id),['ready']);
      assert.equal((await getContent('ready')).title,'Tarta casera');
      await db.execute("INSERT INTO analyses(publication_id,category,title,summary,visual_description,confidence) VALUES ('ready','food','Analysis title','','',0.9)");
      await db.execute("UPDATE analyses SET title='Updated analysis' WHERE publication_id='ready'");
      assert.deepEqual((await listContent({query:'updated'})).map(x=>x.id),['ready']);
      await db.execute("INSERT INTO publication_reviews(publication_id,review_status,action_status,corrected_analysis_json,notes) VALUES ('ready','corrected','inbox',$1,'review note')",[JSON.stringify({title:'Corrección'})]);
      assert.deepEqual((await listContent({query:'correccion'})).map(x=>x.id),['ready']);
      await db.execute("DELETE FROM publications WHERE id='ready'");
      assert.equal((await db.one("SELECT count(*)::int n FROM content_search WHERE publication_id='ready'")).n,0);
      await pool.end();
    `;
    const result = runPostgresScript(script, databaseUrl);
    expect(result.status, result.stderr).toBe(0);
  });
});
