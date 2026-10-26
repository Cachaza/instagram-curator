import { expect, test } from "bun:test";
import { withPostgresDatabase, runPostgresScript } from "./postgres";

test("restaurant geocoding caches results, enforces shared capacity, persists failures and saves only confirmed candidates", async () => {
  await withPostgresDatabase(async (url) => {
    const result = runPostgresScript(`
      import assert from 'node:assert/strict';
      import {db,pool,authPool,migrateAppDatabase} from './src/lib/db.ts';
      import {lookupAddress,GeocodingError} from './src/lib/geocoding.ts';
      import {restaurantPlaces} from './src/lib/restaurant-places.ts';
      import {listRestaurantPlaces,saveRestaurantLocation} from './src/lib/restaurant-locations.ts';
      import {getContent} from './src/lib/content.ts';
      await migrateAppDatabase(); await migrateAppDatabase();
      await db.execute("INSERT INTO publications(id,source_url,processing_status) VALUES ('map-fixture','https://www.instagram.com/reel/mapfixture/','analyzed')");
      const entities={mentioned_places:[{name:'Synthetic Example',location_hint:'Madrid'},{name:'Synthetic Other',location_hint:'Sevilla'}]};
      await db.execute("INSERT INTO analyses(publication_id,category,title,summary,visual_description,confidence,entities_json) VALUES ('map-fixture','restaurant','Synthetic restaurant','','',1,$1)",[JSON.stringify(entities)]);
      const item=await getContent('map-fixture');
      const [place,other]=restaurantPlaces(item);
      let requests=0;
      globalThis.fetch=async (url,options)=>{
        requests++;
        assert.equal(new URL(url).searchParams.get('format'),'jsonv2');
        assert.match(options.headers['User-Agent'],/InstagramCuratorOSS/);
        return Response.json([{osm_type:'node',osm_id:1,display_name:'Synthetic address',lat:'40',lon:'-3'}]);
      };
      const lookup=await lookupAddress('Synthetic Example Madrid');
      assert.equal((await lookupAddress(' Synthetic Example   Madrid ')).cacheKey,lookup.cacheKey);
      assert.equal(requests,1);
      await assert.rejects(lookupAddress('Different query'),error=>error instanceof GeocodingError && error.status===429 && error.retryAfter===1);
      assert.equal(requests,1);
      await assert.rejects(saveRestaurantLocation({publicationId:item.id,placeKey:place.key,cacheKey:lookup.cacheKey,candidateId:'invented'},'synthetic-user'),/location_candidate_not_found/);
      await Promise.all(Array.from({length:pool.options.max},()=>saveRestaurantLocation({publicationId:item.id,placeKey:place.key,cacheKey:lookup.cacheKey,candidateId:'node/1'},'synthetic-user')));
      let places=await listRestaurantPlaces([item]);
      assert.equal(places[0].location.latitude,40);assert.equal(places[1].location,null);
      await saveRestaurantLocation({publicationId:item.id,placeKey:other.key,cacheKey:lookup.cacheKey,candidateId:'node\/1'},'synthetic-user');
      await saveRestaurantLocation({publicationId:item.id,placeKey:place.key},'synthetic-user');
      places=await listRestaurantPlaces([item]);assert.equal(places[0].location,null);assert.ok(places[1].location);
      await db.execute("UPDATE analyses SET entities_json=$1 WHERE publication_id=$2",[JSON.stringify({mentioned_places:[{name:'Synthetic Example',location_hint:'Barcelona'}]}),item.id]);
      await assert.rejects(saveRestaurantLocation({publicationId:item.id,placeKey:place.key,cacheKey:lookup.cacheKey,candidateId:'node\/1'},'synthetic-user'),/restaurant_place_not_found/);
      assert.equal((await listRestaurantPlaces([await getContent(item.id)]))[0].location,null);
      await db.execute("UPDATE geocoding_service_requests SET requested_at=clock_timestamp()-interval '1 second'");
      let releaseFetch; let markStarted;
      const started=new Promise(resolve=>markStarted=resolve);
      const blocked=new Promise(resolve=>releaseFetch=resolve);
      globalThis.fetch=async()=>{markStarted();await blocked;return Response.json([])};
      const inFlight=lookupAddress('Slow lookup');await started;
      // A different host must not enter the provider while the first call holds the lock.
      await assert.rejects(lookupAddress('Concurrent lookup'),error=>error.status===429);
      releaseFetch();await inFlight;
      await assert.rejects(lookupAddress('Immediately after completion'),error=>error.status===429);
      await db.execute("UPDATE geocoding_service_requests SET requested_at=clock_timestamp()-interval '1 second'");
      globalThis.fetch=async()=>{throw new Error('synthetic-network-failure')};
      await assert.rejects(lookupAddress('Failed query'),error=>error.code==='geocoding_failed');
      assert.equal((await db.one("SELECT last_error FROM restaurant_geocodes WHERE last_error IS NOT NULL")).last_error,'geocoding_lookup_failed');
      await db.execute("DELETE FROM publications WHERE id=$1",[item.id]);
      assert.equal((await db.one('SELECT count(*) count FROM restaurant_locations')).count,0);
      await pool.end();await authPool.end();
    `, url);
    expect(result.status, result.stderr).toBe(0);
  });
});
