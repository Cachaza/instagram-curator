import { expect, test } from "bun:test";
import { automaticRestaurantMatch } from "../src/lib/restaurant-geocoding";
import { restaurantPlaces, type PlaceCandidate } from "../src/lib/restaurant-places";
import { runPostgresScript, withPostgresDatabase } from "./postgres";

const venue: PlaceCandidate = { id: "node/fixture", label: "Café Example, Calle Test, Madrid, España", latitude: 0, longitude: 0, category: "amenity", kind: "restaurant" };

test("automatic matches require one exact venue name and all source hint words", () => {
  expect(automaticRestaurantMatch({ name: "Cafe Example", hint: "Madrid España" }, [venue])).toEqual(venue);
  expect(automaticRestaurantMatch({ name: "Cafe Example", hint: "Sevilla" }, [venue])).toBeNull();
  expect(automaticRestaurantMatch({ name: "Different Cafe", hint: "Madrid" }, [venue])).toBeNull();
  expect(automaticRestaurantMatch({ name: "Cafe Example", hint: "" }, [venue])).toBeNull();
  expect(automaticRestaurantMatch({ name: "Cafe Example", hint: "Madrid" }, [venue, { ...venue, id: "node/other-branch" }])).toBeNull();
  expect(automaticRestaurantMatch({ name: "Cafe Example", hint: "Madrid" }, [{ ...venue, category: "place", kind: "city" }])).toBeNull();
  expect(automaticRestaurantMatch({ name: "Cafe Example", hint: "Madrid" }, [{ ...venue, category: undefined, kind: undefined }])).toBeNull();
});

test("legacy nested venues and explicit locality/address fields retain source evidence", () => {
  const base = { id: "fixture", category: "restaurant", reviewStatus: "unreviewed" };
  expect(restaurantPlaces({ ...base, entities: { restaurant: { name: "Example", mentioned_places: ["Test Street", "Madrid"] } } })[0]).toMatchObject({ name: "Example", hint: "Test Street, Madrid" });
  expect(restaurantPlaces({ ...base, entities: { mentioned_places: [{ name: "Example", address: "Test Street", city: "Madrid" }] } })[0].hint).toBe("Test Street, Madrid");
});

test("batch persists safe pins, review outcomes and provider failures without overwriting saved locations", async () => {
  await withPostgresDatabase(async (url) => {
    const result = runPostgresScript(`
      import assert from 'node:assert/strict';
      import {db,pool,authPool,migrateAppDatabase} from './src/lib/db.ts';
      import {geocodeRestaurantLibrary} from './src/lib/restaurant-geocoding.ts';
      import {geocodingCacheKey} from './src/lib/geocoding.ts';
      import {listRestaurantPlaces,saveRestaurantLocation} from './src/lib/restaurant-locations.ts';
      import {listContent} from './src/lib/content.ts';
      await migrateAppDatabase();
      for(const [id,name,hint] of [['a','Example','Madrid'],['b','Ambiguous','Madrid'],['c','Missing','Madrid'],['d','Unnamed','']]){
        await db.execute("INSERT INTO publications(id,source_url,processing_status) VALUES ($1,$2,'analyzed')",[id,'https://www.instagram.com/reel/'+id+'/']);
        await db.execute("INSERT INTO analyses(publication_id,category,title,summary,visual_description,confidence,entities_json) VALUES ($1,'restaurant',$2,'','',1,$3)",[id,name,JSON.stringify({mentioned_places:[{name,location_hint:hint}]})]);
        const query=[name,hint].filter(Boolean).join(', ');
        const base={id:'node/'+id,label:name+', Madrid',latitude:0,longitude:0,category:'amenity',kind:'restaurant'};
        const candidates=id==='c'?[]:id==='b'?[base,{...base,id:'node/another-branch'}]:[base];
        await db.execute("INSERT INTO restaurant_geocodes(cache_key,candidates_json) VALUES ($1,$2)",[geocodingCacheKey(new URL('https://nominatim.openstreetmap.org/search'),query),JSON.stringify(candidates)]);
      }
      globalThis.fetch=async()=>{throw new Error('Cached batch must not call provider')};
      const summary=await geocodeRestaurantLibrary({runId:'synthetic-run'});
      assert.deepEqual({saved:summary.saved,review:summary.review,notFound:summary.notFound},{saved:1,review:2,notFound:1});
      assert.equal((await db.one('SELECT COUNT(*) count FROM restaurant_locations')).count,1);
      assert.equal((await db.one("SELECT COUNT(*) count FROM pipeline_events WHERE stage='geocoding' AND event_type='batch_completed'")).count,1);
      const places=await listRestaurantPlaces(await listContent({category:'restaurant'}));
      const saved=places.find(p=>p.location);
      const existing=JSON.stringify(saved.location);
      const candidateKey=geocodingCacheKey(new URL('https://nominatim.openstreetmap.org/search'),'Example, Madrid');
      assert.equal(await saveRestaurantLocation({publicationId:saved.publicationId,placeKey:saved.key,cacheKey:candidateKey,candidateId:'node/a'},'another-job',{onlyIfUnmapped:true}),false);
      assert.equal((await db.one('SELECT location_json FROM restaurant_locations')).location_json,existing);
      await db.execute('DELETE FROM restaurant_geocodes');
      globalThis.fetch=async()=>{throw new Error('synthetic-provider-failure')};
      await assert.rejects(geocodeRestaurantLibrary({runId:'failed-run'}),/stopped at stage geocoding/);
      assert.ok((await db.one("SELECT COUNT(*) count FROM pipeline_events WHERE event_type='failed' AND message::jsonb->>'runId'='failed-run'")).count>0);
      await pool.end();await authPool.end();
    `, url);
    expect(result.status, result.stderr).toBe(0);
  });
});
