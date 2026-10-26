import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withPostgresDatabase, runPostgresScript } from "./postgres";

test("library and detail expose only existing media files inside the data directory", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curator-media-"));
  try {
    await withPostgresDatabase(async (databaseUrl) => {
      const script = `
        import assert from 'node:assert/strict';
        import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
        import {join} from 'node:path';
        import {db,pool,migrateAppDatabase} from './src/lib/db.ts';
        import {listContent,getContent} from './src/lib/content.ts';
        import {dataDir} from './src/lib/paths.ts';
        await migrateAppDatabase();
        const insert=async(id,caption,video,image)=>db.execute("INSERT INTO publications(id,source_url,caption,processing_status,video_path,contact_sheet_path) VALUES ($1,$2,$3,'ready_for_analysis',$4,$5)",[id,'https://www.instagram.com/reel/'+id+'/',caption,video,image]);
        await insert('missing','Archived text','media/missing.mp4','media/missing.jpg');
        assert.equal((await getContent('missing')).hasVideo,false);
        assert.equal((await getContent('missing')).hasImage,false);
        mkdirSync(join(dataDir,'media'),{recursive:true});
        writeFileSync(join(dataDir,'media/video.mp4'),'fixture'); writeFileSync(join(dataDir,'media/image.jpg'),'fixture');
        await insert('available','Available files','media/video.mp4','media/image.jpg');
        let available=(await listContent()).find(x=>x.id==='available');
        assert.equal(available.hasVideo,true); assert.equal(available.hasImage,true);
        unlinkSync(join(dataDir,'media/video.mp4'));
        assert.equal((await getContent('available')).hasVideo,false); assert.equal((await getContent('available')).hasImage,true);
        await db.execute("UPDATE publications SET video_path=$1 WHERE id='available'",[process.argv[1]]);
        assert.equal((await getContent('available')).hasVideo,false);
        await pool.end();
      `;
      const result = runPostgresScript(script, databaseUrl, { CURATOR_DATA_DIR: directory });
      expect(result.status, result.stderr).toBe(0);
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
