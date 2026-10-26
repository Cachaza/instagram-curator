import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtureDir = mkdtempSync(join(tmpdir(), "curator-codex-usage-"));
afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

function run(script: string) {
  const caseDir = mkdtempSync(join(fixtureDir, "case-"));
  const result = spawnSync("node", ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: process.cwd(), env: { ...process.env, CURATOR_DATA_DIR: caseDir }, encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
}

describe("Codex model settings and usage", () => {
  test("serializes the additive migration when web and worker start together", () => run(`
    import assert from 'node:assert/strict';
    import {spawn} from 'node:child_process';
    import {db} from './src/lib/db.ts';
    db.prepare("INSERT INTO publications(id,source_url) VALUES ('preserved','https://www.instagram.com/reel/preserved/')").run();
    db.exec('DROP TABLE codex_usage; DELETE FROM schema_migrations WHERE version=4; BEGIN IMMEDIATE');
    const children=[0,1].map(()=>{
      const child=spawn('node',['--import','tsx','--input-type=module','-e',"console.log('ready'); await import('./src/lib/db.ts');"],{cwd:process.cwd(),env:process.env});
      let output='',error='';
      const ready=new Promise(resolve=>child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('ready'))resolve()}));
      child.stderr.on('data',chunk=>{error+=chunk});
      const done=new Promise(resolve=>child.on('exit',code=>resolve({code,error})));
      return {ready,done};
    });
    await Promise.all(children.map(c=>c.ready));
    db.exec('COMMIT');
    for(const result of await Promise.all(children.map(c=>c.done)))assert.equal(result.code,0,result.error);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM codex_usage').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE version=4').get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM publications WHERE id='preserved'").get().n,1);
    db.close();
  `));

  test("discovers paginated models, validates supported efforts, and saves preferences atomically", () => run(`
    import assert from 'node:assert/strict';
    import { db } from './src/lib/db.ts';
    import { codexAppServer } from './src/lib/codex/app-server.ts';
    import { codexPreferences,listCodexModels,configuredCodexModel,validCodexPreferences,saveCodexPreferences,PreferencesSchema } from './src/lib/codex/preferences.ts';
    const models=[{id:'a',model:'model-a',displayName:'A',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]},{id:'b',model:'model-b',displayName:'B',isDefault:false,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}];
    const calls=[];
    codexAppServer.request=async(method,params)=>{
      calls.push([method,params]);
      if(method==='config/read') return {config:{model:'model-b',api_key:'fixture-secret'}};
      return params.cursor ? {data:[models[1]],nextCursor:null}:{data:[models[0]],nextCursor:'next'};
    };
    assert.deepEqual(codexPreferences(),{model:null,effort:'medium'});
    assert.deepEqual(await listCodexModels(),models);
    assert.equal(calls[1][1].cursor,'next');
    assert.equal(await configuredCodexModel(),'model-b');
    assert.equal(validCodexPreferences({model:null,effort:'medium'},models,'model-b'),true);
    assert.equal(validCodexPreferences({model:'model-a',effort:'medium'},models,'model-b'),false);
    assert.equal(validCodexPreferences({model:'unknown',effort:'low'},models,'model-b'),false);
    assert.equal(PreferencesSchema.safeParse({model:'model-a',effort:'low',apiKey:'no'}).success,false);
    saveCodexPreferences({model:'model-a',effort:'low'});
    db.exec("CREATE TRIGGER reject_effort BEFORE UPDATE ON app_settings WHEN NEW.key='analysis.codex_effort' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    assert.throws(()=>saveCodexPreferences({model:'model-b',effort:'medium'}));
    assert.deepEqual(codexPreferences(),{model:'model-a',effort:'low'});
    db.exec('DROP TRIGGER reject_effort');
    saveCodexPreferences({model:null,effort:'medium'});
    db.close();
  `));

  test("keeps cumulative tokens idempotent, unknown costs nullable, and the migration repeatable", () => run(`
    import assert from 'node:assert/strict';
    import { db,migrateAppDatabase } from './src/lib/db.ts';
    import { beginCodexUsage,recordCodexTokens,finishCodexUsage,recordCodexCost,curatorUsage } from './src/lib/codex/usage.ts';
    db.prepare("INSERT INTO publications(id,source_url) VALUES ('usage','https://www.instagram.com/reel/usage/')").run();
    beginCodexUsage('thread-usage','usage','resolved-model','medium');
    const event=(n)=>({threadId:'thread-usage',turnId:'turn-usage',tokenUsage:{total:{inputTokens:n-3,cachedInputTokens:2,outputTokens:3,reasoningOutputTokens:1,totalTokens:n}}});
    recordCodexTokens(event(10)); recordCodexTokens(event(10)); recordCodexTokens(event(8));
    recordCodexTokens({...event(50),threadId:'unrelated'});
    recordCodexTokens({...event(50),tokenUsage:{total:{totalTokens:-1}}});
    await recordCodexCost('thread-usage',{request:async()=>({threadUsage:{threadId:'someone-else',estimatedUsageCreditsMicros:100,estimatedUsageUsdMicros:200}})});
    assert.equal(curatorUsage().totals.usdMicros,null);
    await recordCodexCost('thread-usage',{request:async()=>{throw new Error('unsupported method')}});
    assert.equal(curatorUsage().totals.creditRuns,0);
    await recordCodexCost('thread-usage',{request:async()=>({threadUsage:{threadId:'thread-usage',estimatedUsageCreditsMicros:100,estimatedUsageUsdMicros:null}})});
    finishCodexUsage('thread-usage','failed');
    const totals=curatorUsage().totals;
    assert.equal(totals.totalTokens,10); assert.equal(totals.inputTokens,7);
    assert.equal(totals.cachedInputTokens,2); assert.equal(totals.outputTokens,3);
    assert.equal(totals.reasoningOutputTokens,1); assert.equal(totals.measuredRuns,1);
    assert.equal(totals.creditsMicros,100); assert.equal(totals.usdMicros,null);
    await recordCodexCost('thread-usage',{request:async()=>({threadUsage:{threadId:'thread-usage',estimatedUsageCreditsMicros:100,estimatedUsageUsdMicros:1}})});
    assert.equal(curatorUsage().totals.usdMicros,1);
    assert.equal(curatorUsage().totals.usdRuns,1);
    assert.equal(db.prepare("SELECT status FROM codex_usage WHERE thread_id='thread-usage'").get().status,'failed');
    beginCodexUsage('thread-unknown','usage',null,'low');
    assert.equal(curatorUsage().totals.measuredRuns,1);
    assert.equal(curatorUsage().totals.runs,2);
    migrateAppDatabase();
    assert.equal(curatorUsage().totals.runs,2);
    db.prepare("DELETE FROM publications WHERE id='usage'").run();
    assert.equal(curatorUsage().totals.totalTokens,10);
    assert.equal(db.prepare("SELECT publication_id FROM codex_usage WHERE thread_id='thread-usage'").get().publication_id,null);
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
    db.close();
  `));

  test("passes chosen settings to analysis, captures failed attempts, and releases listeners", () => run(`
    import assert from 'node:assert/strict';
    import { db } from './src/lib/db.ts';
    import { saveCodexPreferences } from './src/lib/codex/preferences.ts';
    import { runCodexAnalysis } from './src/worker/codex-analysis.ts';
    db.prepare("INSERT INTO publications(id,source_url) VALUES ('worker','https://www.instagram.com/reel/worker/')").run();
    let id=0;
    async function exercise(preferences,failure){
      saveCodexPreferences(preferences);
      const threadId='worker-'+(++id),calls=[],listeners=new Set();
      let complete;
      const completion=new Promise(resolve=>{complete=resolve});
      let signal;
      const server={
        request:async(method,params)=>{
          calls.push([method,params]);
          if(method==='thread/start') return {thread:{id:threadId},model:'actually-resolved'};
          if(method==='account/usage/read') return {};
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
      const row=db.prepare('SELECT * FROM codex_usage WHERE thread_id=?').get(threadId);
      assert.equal(row.model,'actually-resolved');
      assert.equal(row.status,failure?'failed':'completed');
      assert.equal(row.total_tokens,failure==='start'?null:10);
      assert.equal(row.estimated_usd_micros,null);
    }
    await exercise({model:null,effort:'medium'},null);
    await exercise({model:'selected-model',effort:'low'},null);
    await exercise({model:'selected-model',effort:'low'},'start');
    await exercise({model:null,effort:'medium'},'completion');
    db.close();
  `));
});
