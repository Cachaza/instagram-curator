import { expect, test } from "bun:test";
import { withPostgresDatabase, runPostgresScript } from "./postgres";
import { buildTunnelArgs, buildTunnelEnv } from "../scripts/mcp-tunnel";

test("Curator tunnel requires its own identity and keeps secrets out of argv", () => {
  expect(() => buildTunnelArgs("run", { CONTROL_PLANE_TUNNEL_ID: "tunnel_other" })).toThrow("CURATOR_TUNNEL_ID");
  expect(() => buildTunnelArgs("run", { CURATOR_TUNNEL_ID: "tunnel_fixture" })).toThrow("CONTROL_PLANE_API_KEY");
  const env = { CURATOR_TUNNEL_ID: "tunnel_fixture", CONTROL_PLANE_API_KEY: "synthetic-key", DATABASE_URL: "synthetic-db", CONTROL_PLANE_CONFIG: "other-profile", MCP_SERVER_URL: "other-target", WALLAPOP_TOKEN: "other-secret" };
  const args = buildTunnelArgs("doctor", env, "/synthetic path/curator", "/node");
  expect(args.join(" ")).not.toContain("synthetic-key");
  expect(args).toContain("--control-plane.api-key=env:CONTROL_PLANE_API_KEY");
  expect(args).toContain("--health.listen-addr=127.0.0.1:0");
  expect(args.join(" ")).toContain("/synthetic path/curator/src/mcp/cli.ts");
  expect(buildTunnelEnv(env)).toEqual({ CURATOR_TUNNEL_ID: "tunnel_fixture", CONTROL_PLANE_API_KEY: "synthetic-key", DATABASE_URL: "synthetic-db" });
});

test("MCP discovery, browsing, full reads and atomic organization use synthetic PostgreSQL", async () => {
  await withPostgresDatabase(async (databaseUrl) => {
    const script = `
      import assert from 'node:assert/strict';
      import {Client} from '@modelcontextprotocol/sdk/client/index.js';
      import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
      import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
      import {createCuratorMcpServer} from './src/mcp/server.ts';
      import {db,pool,authPool,migrateAppDatabase} from './src/lib/db.ts';
      import {patchReview} from './src/lib/reviews.ts';
      import {auth} from './src/lib/auth.ts';
      await migrateAppDatabase();
      const owner = await auth.api.signUpEmail({body:{email:'mcp@example.invalid',name:'Synthetic owner',password:'synthetic-fixture-password'}});
      for (const [id,order] of [['newer',0],['older',1]]) {
        await db.execute("INSERT INTO publications(id,source_url,caption,transcript_text,processing_status,saved_order) VALUES ($1,$2,'original caption','business automation transcript','analyzed',$3)",[id,'https://www.instagram.com/reel/'+id+'/',order]);
        await db.execute("INSERT INTO analyses(publication_id,category,title,summary,visual_description,confidence) VALUES ($1,'business',$2,'AI business workflows','synthetic visual description',0.9)",[id,id+' workflow']);
      }
      async function connect(env) {
        const server=createCuratorMcpServer(env);
        const client=new Client({name:'fixture',version:'1'});
        const [a,b]=InMemoryTransport.createLinkedPair();
        await server.connect(a);await client.connect(b);return {client,server};
      }
      const read=await connect({});
      assert.equal((await read.client.listTools()).tools.length,3);
      assert.equal((await read.client.callTool({name:'curator_organize_publication',arguments:{id:'newer',notes:'denied'}})).isError,true);
      const search=async(client,args={})=>(await client.callTool({name:'curator_search_library',arguments:args})).structuredContent;
      const first=await search(read.client,{query:'business',limit:1,sort:'newest'});
      assert.equal(first.total,2);assert.equal(first.items[0].id,'newer');assert.equal(first.nextOffset,1);
      assert.equal(first.items[0].transcript,undefined);
      assert.equal((await search(read.client,{sort:'oldest'})).items[0].id,'older');
      assert.equal((await search(read.client,{limit:1,offset:first.nextOffset})).items[0].id,'older');
      assert.equal((await read.client.callTool({name:'curator_search_library',arguments:{limit:61}})).isError,true);
      const detail=(await read.client.callTool({name:'curator_get_publication',arguments:{id:'newer'}})).structuredContent;
      assert.equal(detail.transcript,'business automation transcript');assert.equal(detail.caption,'original caption');
      assert.equal((await read.client.callTool({name:'curator_get_publication',arguments:{id:'absent'}})).isError,true);
      assert.throws(()=>createCuratorMcpServer({CURATOR_MCP_ALLOW_WRITES:'1'}),/CURATOR_MCP_USER_ID/);
      const write=await connect({CURATOR_MCP_ALLOW_WRITES:'1',CURATOR_MCP_USER_ID:owner.user.id});
      const organize=async(args)=>write.client.callTool({name:'curator_organize_publication',arguments:{id:'newer',...args}});
      await db.execute("INSERT INTO publication_reviews(publication_id,review_status,action_status,corrected_category,corrected_analysis_json,notes) VALUES ('newer','corrected','reference','old',$1,'keep notes')",[JSON.stringify({category:'stale',title:'Corrected title'})]);
      assert.equal((await search(read.client,{category:'stale'})).total,1);
      assert.equal((await organize({category:'ai',reviewStatus:'discarded',discardedReason:'not needed'})).isError,undefined);
      let updated=(await read.client.callTool({name:'curator_get_publication',arguments:{id:'newer'}})).structuredContent;
      assert.equal(updated.category,'ai');assert.equal(updated.title,'Corrected title');assert.equal(updated.notes,'keep notes');assert.equal(updated.actionStatus,'reference');
      assert.equal((await search(read.client,{category:'ai',reviewStatus:'discarded'})).total,1);
      const cats=(await read.client.callTool({name:'curator_list_categories',arguments:{}})).structuredContent;
      assert(cats.categories.some(c=>c.category==='ai'&&c.count===1));
      await organize({category:null,reviewStatus:'unreviewed'});
      updated=(await read.client.callTool({name:'curator_get_publication',arguments:{id:'newer'}})).structuredContent;
      assert.equal(updated.category,'business');
      await Promise.all([patchReview('older',{notes:'parallel note'},owner.user.id),patchReview('older',{actionStatus:'done'},owner.user.id)]);
      const prior=await db.one("SELECT notes,action_status FROM publication_reviews WHERE publication_id='older'");
      assert.equal(prior.notes,'parallel note');assert.equal(prior.action_status,'done');
      await db.execute('UPDATE "user" SET banned=true WHERE id=$1',[owner.user.id]);
      assert.equal((await organize({notes:'denied'})).isError,true);
      await db.execute('UPDATE "user" SET banned=false,role=$1 WHERE id=$2',['user',owner.user.id]);
      assert.equal((await organize({notes:'denied'})).isError,true);
      await read.client.close();await write.client.close();
      // Real Node stdio transport initializes and discovers tools without stdout noise.
      const stdio=new Client({name:'stdio-fixture',version:'1'});
      await stdio.connect(new StdioClientTransport({command:process.execPath,args:['--import','tsx','src/mcp/cli.ts'],env:{...process.env,CURATOR_MCP_ALLOW_WRITES:'0'},stderr:'pipe'}));
      assert.equal((await stdio.listTools()).tools.length,3);
      assert.equal((await search(stdio,{query:'automation'})).total,2);
      await stdio.close();
      await db.execute("INSERT INTO publications(id,source_url,caption,processing_status,created_at,published_at) VALUES ('manual-new','https://www.instagram.com/reel/manualnew/','manual','analyzed','2026-10-02','2020-01-01'),('manual-old','https://www.instagram.com/reel/manualold/','manual','analyzed','2026-10-01','2025-01-01')");
      const ordered=await connect({});
      assert.deepEqual((await search(ordered.client,{sort:'newest'})).items.map(x=>x.id),['manual-new','manual-old','newer','older']);
      assert.deepEqual((await search(ordered.client,{sort:'oldest'})).items.map(x=>x.id),['older','newer','manual-old','manual-new']);
      await ordered.client.close();await pool.end();await authPool.end();
    `;
    const result = runPostgresScript(script, databaseUrl);
    expect(result.status, result.stderr).toBe(0);
  });
});
