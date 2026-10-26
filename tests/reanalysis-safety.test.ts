import { expect, test } from "bun:test";
import { runPostgresScript, withPostgresDatabase } from "./postgres";

test("missing images are audited and failed reanalysis retains the previous usable analysis", async () => {
  await withPostgresDatabase(async (url) => {
    const result = runPostgresScript(`
      import assert from 'node:assert/strict';
      import {db,pool,authPool,migrateAppDatabase} from './src/lib/db.ts';
      import {getContent} from './src/lib/content.ts';
      import {codexAppServer} from './src/lib/codex/app-server.ts';
      import {processNextAnalysis} from './src/worker/analyze.ts';
      await migrateAppDatabase();
      const wire={category:'recipe',subcategory:null,title:'Source recipe',summary:'Source summary',visual_description:'No image supplied',why_interesting:null,next_action:null,action_status:'reference',tags:[],entities_json:JSON.stringify({ingredients:['Source ingredient'],steps:['Source step']}),facets_json:'{}',confidence:0.9,needs_review:false,review_reason:null,codex_notes:null};
      let failure=false,thread=0,turnInput,complete;
      const listeners=new Set();
      codexAppServer.onNotification=listener=>{listeners.add(listener);return()=>listeners.delete(listener)};
      codexAppServer.waitFor=()=>new Promise(resolve=>complete=resolve);
      codexAppServer.request=async(method,params)=>{
        if(method==='account/read')return {account:{},requiresOpenaiAuth:false};
        if(method==='thread/start')return {thread:{id:'fixture-'+(++thread)},model:'fixture'};
        if(method==='account/usage/read')return {};
        if(method==='turn/start'){
          turnInput=params.input;
          if(failure)throw Error('synthetic inference failure');
          const threadId='fixture-'+thread;
          for(const listener of listeners)listener({method:'item/completed',params:{threadId,item:{type:'agentMessage',text:JSON.stringify(wire)}}});
          complete({threadId,turn:{status:'completed'}});return {turn:{id:'fixture'}};
        }
        throw Error('Unexpected RPC: '+method);
      };
      async function publication(id,image=null){
        await db.execute("INSERT INTO publications(id,source_url,processing_status,caption,transcript_text,contact_sheet_path) VALUES ($1,$2,'ready_for_analysis','Source caption','Source transcript',$3)",[id,'https://www.instagram.com/reel/'+id+'/',image]);
      }
      await publication('missing-image','media/nonexistent-fixture.jpg');
      assert.equal(await processNextAnalysis(),true);
      assert.ok(turnInput.some(i=>i.type==='text'&&i.text.includes('Source transcript')));
      assert.equal(turnInput.some(i=>i.type==='localImage'),false);
      assert.equal((await db.one("SELECT count(*)::int count FROM pipeline_events WHERE publication_id='missing-image' AND stage='analyzing' AND event_type='input_warning'")).count,1);
      assert.equal((await db.one("SELECT processing_status FROM publications WHERE id='missing-image'")).processing_status,'analyzed');
      await publication('existing');
      await db.execute("INSERT INTO analyses(publication_id,category,title,summary,visual_description,confidence) VALUES ('existing','recipe','Preserved title','Preserved summary','',0.9)");
      failure=true;await processNextAnalysis();
      assert.equal((await db.one("SELECT processing_status,last_error FROM publications WHERE id='existing'")).processing_status,'analyzed');
      assert.equal((await getContent('existing')).title,'Preserved title');
      assert.equal((await db.one("SELECT count(*)::int count FROM pipeline_events WHERE publication_id='existing' AND event_type='error' AND stage='analyzing'")).count,1);
      await publication('first-attempt');await processNextAnalysis();
      assert.equal((await db.one("SELECT processing_status FROM publications WHERE id='first-attempt'")).processing_status,'failed');
      assert.equal(listeners.size,0);
      await pool.end();await authPool.end();
    `, url);
    expect(result.status, result.stderr).toBe(0);
  });
});

test("changed location evidence requires reconfirmation while preserving the previous pin", async () => {
  await withPostgresDatabase(async (url) => {
    const result = runPostgresScript(`
      import assert from 'node:assert/strict';
      import {db,pool,authPool,migrateAppDatabase,transaction} from './src/lib/db.ts';
      import {getContent} from './src/lib/content.ts';
      import {archiveRestaurantLocation,listRestaurantPlaces,listRestaurantLocationsNeedingConfirmation,reconfirmChangedRestaurantLocations,saveRestaurantLocation} from './src/lib/restaurant-locations.ts';
      await migrateAppDatabase();
      await db.execute("INSERT INTO publications(id,source_url,processing_status) VALUES ('venue','https://www.instagram.com/reel/venue/','analyzed')");
      const entities=city=>JSON.stringify({restaurant_name:'Example',address_as_stated:'Calle Test',city});
      await db.execute("INSERT INTO analyses(publication_id,category,title,summary,visual_description,confidence,entities_json) VALUES ('venue','restaurant','Example','','',0.9,$1)",[entities('Madrid')]);
      const key=JSON.stringify(['Example','Calle Test']);
      const oldPin={id:'node/madrid',label:'Example, Calle Test, Madrid',latitude:40,longitude:-3};
      await db.execute("INSERT INTO restaurant_locations(publication_id,place_key,location_json,confirmed_by_user_id) VALUES ('venue',$1,$2,'manual-user')",[key,JSON.stringify(oldPin)]);
      await db.execute("UPDATE publications SET processing_status='ready_for_analysis' WHERE id='venue'");
      assert.ok(await getContent('venue'));
      await db.execute("UPDATE publications SET processing_status='analyzing' WHERE id='venue'");
      assert.ok(await getContent('venue'));
      await transaction(async tx=>{
        await tx.one("SELECT id FROM publications WHERE id='venue' FOR UPDATE");
        const before=await getContent('venue',tx);
        await tx.execute("UPDATE analyses SET entities_json=$1 WHERE publication_id='venue'",[entities('Sevilla')]);
        const after=await getContent('venue',tx);
        await reconfirmChangedRestaurantLocations(before,after,tx);
      });
      assert.equal((await listRestaurantPlaces([await getContent('venue')]))[0].location,null);
      const changes=await listRestaurantLocationsNeedingConfirmation();
      assert.equal(changes.length,1);assert.equal(changes[0].location.label,oldPin.label);
      const newPin={...oldPin,id:'node/sevilla',label:'Example, Calle Test, Sevilla'};
      await db.execute("INSERT INTO restaurant_geocodes(cache_key,candidates_json) VALUES ('synthetic-cache',$1)",[JSON.stringify([newPin])]);
      await saveRestaurantLocation({publicationId:'venue',placeKey:key,cacheKey:'synthetic-cache',candidateId:newPin.id},'manual-user');
      assert.equal((await listRestaurantLocationsNeedingConfirmation()).length,0);
      assert.equal((await listRestaurantPlaces([await getContent('venue')]))[0].location.label,newPin.label);
      const beforeRename=await getContent('venue');
      await db.execute("UPDATE analyses SET entities_json=$1 WHERE publication_id='venue'",[JSON.stringify({restaurant_name:'New Example',address_as_stated:'Calle Test',city:'Sevilla'})]);
      await transaction(async tx=>{await tx.one("SELECT id FROM publications WHERE id='venue' FOR UPDATE");await reconfirmChangedRestaurantLocations(beforeRename,await getContent('venue',tx),tx)});
      const replacementKey=JSON.stringify(['New Example','Calle Test']);
      await saveRestaurantLocation({publicationId:'venue',placeKey:replacementKey,cacheKey:'synthetic-cache',candidateId:newPin.id},'manual-user');
      assert.equal((await listRestaurantLocationsNeedingConfirmation()).length,1);
      await assert.rejects(archiveRestaurantLocation('venue',replacementKey,'manual-user'),/location_not_pending_confirmation/);
      await archiveRestaurantLocation('venue',key,'manual-user');
      await archiveRestaurantLocation('venue',key,'manual-user');
      assert.equal((await listRestaurantLocationsNeedingConfirmation()).length,0);
      const archived=JSON.parse((await db.one("SELECT location_json FROM restaurant_locations WHERE publication_id='venue' AND place_key=$1",[key])).location_json);
      assert.equal(archived.archived,true);assert.equal(archived.label,newPin.label);assert.equal(archived.archivedBy,'manual-user');
      assert.equal((await listRestaurantPlaces([await getContent('venue')]))[0].location.label,newPin.label);
      await pool.end();await authPool.end();
    `, url);
    expect(result.status, result.stderr).toBe(0);
  });
});
