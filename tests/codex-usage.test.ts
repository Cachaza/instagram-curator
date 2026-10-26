import { test, expect } from "bun:test";
import { withPostgresDatabase, runPostgresScript } from "./postgres";

test("Codex usage deduplicates cumulative tokens, preserves nullable cost, failures, and deletion", async () => {
  await withPostgresDatabase(async (databaseUrl) => {
    const result = runPostgresScript(`
      import assert from 'node:assert/strict';
      import {db,pool,migrateAppDatabase} from './src/lib/db.ts';
      import {beginCodexUsage,recordCodexTokens,finishCodexUsage,recordCodexCost,curatorUsage} from './src/lib/codex/usage.ts';
      await migrateAppDatabase();
      await db.execute("INSERT INTO publications(id,source_url) VALUES ($1,$2)",['usage','https://www.instagram.com/reel/usage/']);
      await beginCodexUsage('thread-usage','usage','resolved-model','medium');
      const event=n=>({threadId:'thread-usage',turnId:'turn-usage',tokenUsage:{total:{inputTokens:n-3,cachedInputTokens:2,outputTokens:3,reasoningOutputTokens:1,totalTokens:n}}});
      await recordCodexTokens(event(10)); await recordCodexTokens(event(10)); await recordCodexTokens(event(8));
      await recordCodexTokens({...event(50),threadId:'unrelated'});
      await recordCodexTokens({...event(50),tokenUsage:{total:{totalTokens:-1}}});
      await recordCodexCost('thread-usage',{request:async()=>({threadUsage:{threadId:'other',estimatedUsageCreditsMicros:100,estimatedUsageUsdMicros:200}})});
      assert.equal((await curatorUsage()).totals.usdMicros,null);
      await recordCodexCost('thread-usage',{request:async()=>{throw new Error('unsupported method')}});
      assert.equal((await curatorUsage()).totals.creditRuns,0);
      await recordCodexCost('thread-usage',{request:async()=>({threadUsage:{threadId:'thread-usage',estimatedUsageCreditsMicros:100,estimatedUsageUsdMicros:null}})});
      await finishCodexUsage('thread-usage','failed');
      let totals=(await curatorUsage()).totals;
      assert.equal(totals.totalTokens,10); assert.equal(totals.inputTokens,7);
      assert.equal(totals.cachedInputTokens,2); assert.equal(totals.outputTokens,3);
      assert.equal(totals.reasoningOutputTokens,1); assert.equal(totals.measuredRuns,1);
      assert.equal(totals.creditsMicros,100); assert.equal(totals.usdMicros,null);
      await recordCodexCost('thread-usage',{request:async()=>({threadUsage:{threadId:'thread-usage',estimatedUsageCreditsMicros:100,estimatedUsageUsdMicros:1}})});
      assert.equal((await curatorUsage()).totals.usdRuns,1);
      await beginCodexUsage('thread-unknown','usage',null,'low');
      totals=(await curatorUsage()).totals;
      assert.equal(totals.measuredRuns,1); assert.equal(totals.runs,2);
      await db.execute("DELETE FROM publications WHERE id='usage'");
      assert.equal((await curatorUsage()).totals.totalTokens,10);
      assert.equal((await db.one("SELECT publication_id FROM codex_usage WHERE thread_id='thread-usage'")).publication_id,null);
      assert.equal((await db.one("SELECT status FROM codex_usage WHERE thread_id='thread-usage'")).status,'failed');
      await pool.end();
    `, databaseUrl);
    expect(result.status, result.stderr).toBe(0);
  });
});

test("Codex preferences roll back together when either setting update fails", async () => {
  await withPostgresDatabase(async (databaseUrl) => {
    const result = runPostgresScript(`
      import assert from 'node:assert/strict';
      import {db,pool,migrateAppDatabase} from './src/lib/db.ts';
      import {codexPreferences,saveCodexPreferences} from './src/lib/codex/preferences.ts';
      await migrateAppDatabase();
      await saveCodexPreferences({model:'model-a',effort:'low'});
      await db.execute("CREATE FUNCTION reject_effort() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key='analysis.codex_effort' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$");
      await db.execute("CREATE TRIGGER reject_effort BEFORE INSERT OR UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION reject_effort()");
      await assert.rejects(saveCodexPreferences({model:'model-b',effort:'medium'}));
      assert.deepEqual(await codexPreferences(),{model:'model-a',effort:'low'});
      await pool.end();
    `, databaseUrl);
    expect(result.status, result.stderr).toBe(0);
  });
});

test("Codex analysis uses selected settings, records failed attempts, and releases listeners", async () => {
  await withPostgresDatabase(async (databaseUrl) => {
    const result = runPostgresScript(`
      import assert from 'node:assert/strict';
      import {db,pool,migrateAppDatabase} from './src/lib/db.ts';
      import {saveCodexPreferences} from './src/lib/codex/preferences.ts';
      import {runCodexAnalysis} from './src/worker/codex-analysis.ts';
      await migrateAppDatabase();
      await db.execute("INSERT INTO publications(id,source_url) VALUES ($1,$2)",['worker','https://www.instagram.com/reel/worker/']);
      let id=0;
      async function exercise(preferences,failure){
        await saveCodexPreferences(preferences);
        const threadId='worker-'+(++id),calls=[],listeners=new Set();
        let complete;
        const completion=new Promise(resolve=>{complete=resolve});
        let signal;
        const server={
          request:async(method,params)=>{
            calls.push([method,params]);
            if(method==='thread/start') return {thread:{id:threadId},model:'actually-resolved'};
            if(method==='account/usage/read') return {threadUsage:{threadId,estimatedUsageCreditsMicros:100,estimatedUsageUsdMicros:null}};
            if(failure==='start') throw new Error('turn could not start');
            const emit=(method,params)=>{for(const listener of listeners)listener({method,params})};
            emit('thread/tokenUsage/updated',{threadId:'other',turnId:'other',tokenUsage:{total:{inputTokens:999,cachedInputTokens:0,outputTokens:0,reasoningOutputTokens:0,totalTokens:999}}});
            const token={threadId,turnId:'turn',tokenUsage:{total:{inputTokens:8,cachedInputTokens:3,outputTokens:2,reasoningOutputTokens:1,totalTokens:10}}};
            emit('thread/tokenUsage/updated',token); emit('thread/tokenUsage/updated',token);
            emit('item/completed',{threadId,item:{type:'agentMessage',text:'{"ok":true}'}});
            complete({threadId,turn:{status:failure==='completion'?'failed':'completed',error:{message:'fixture failure'}}});
            return {turn:{id:'turn'}};
          },
          onNotification:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},
          waitFor:(method,predicate,timeout,s)=>{signal=s;return completion},
        };
        if(failure) await assert.rejects(runCodexAnalysis('worker',[],{},server));
        else assert.equal(await runCodexAnalysis('worker',[],{},server),'{"ok":true}');
        assert.equal(listeners.size,0); assert.equal(signal.aborted,true);
        assert.equal(calls[0][1].model,preferences.model??undefined);
        assert.equal(calls.find(c=>c[0]==='turn/start')[1].effort,preferences.effort);
        const row=await db.one('SELECT * FROM codex_usage WHERE thread_id=$1',[threadId]);
        assert.equal(row.model,'actually-resolved');
        assert.equal(row.status,failure==='start'||failure==='completion'?'failed':'completed');
        assert.ok(row.completed_at);
        assert.equal(row.total_tokens,failure==='start'||failure==='tokens'?null:10);
        assert.equal(row.estimated_usd_micros,null);
      }
      await exercise({model:null,effort:'medium'},null);
      await exercise({model:'selected-model',effort:'low'},null);
      await exercise({model:'selected-model',effort:'low'},'start');
      await exercise({model:null,effort:'medium'},'completion');
      await db.execute("CREATE FUNCTION reject_token_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic usage-write failure'; END $$; CREATE TRIGGER reject_token_snapshot BEFORE UPDATE OF total_tokens ON codex_usage FOR EACH ROW EXECUTE FUNCTION reject_token_snapshot();");
      await exercise({model:null,effort:'medium'},'tokens');
      await pool.end();
    `, databaseUrl);
    expect(result.status, result.stderr).toBe(0);
  });
});
