import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { withPostgresDatabase } from "./postgres";

test("local transcription accepts completed output and never falls back to the API on failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curator-local-test-"));
  try {
    const media = join(directory, "media");
    mkdirSync(media);
    const fixture = join(directory, "fixture.mjs");
    writeFileSync(fixture, `
      import {writeFileSync} from 'node:fs';
      import {join} from 'node:path';
      writeFileSync(join(process.argv[3],'transcript.raw.json'),JSON.stringify({text:' Texto local '}));
      if(process.env.REJECT_LOCAL) { console.error('local generation rejected'); process.exit(1); }
    `);
    const runner = join(directory, "runner.mts");
    writeFileSync(runner, `
      import assert from 'node:assert/strict';
      import {readFileSync,readdirSync} from 'node:fs';
      import {join} from 'node:path';
      import {setSetting} from ${JSON.stringify(pathToFileURL(resolve("src/lib/settings.ts")).href)};
      import {migrateAppDatabase,pool} from ${JSON.stringify(pathToFileURL(resolve("src/lib/db.ts")).href)};
      import {transcribe} from ${JSON.stringify(pathToFileURL(resolve("src/worker/transcribe.ts")).href)};
      const media=${JSON.stringify(media)};
      globalThis.fetch=async()=>{throw new Error('API must not be called');};
      await migrateAppDatabase();
      await setSetting('transcription.provider','local');
      await assert.rejects(transcribe('audio.wav',join(media,'transcript.txt')),/requires transcription.local_command/);
      await setSetting('transcription.local_command',[process.execPath,${JSON.stringify(fixture)}]);
      assert.equal(await transcribe('audio.wav',join(media,'transcript.txt')),'Texto local');
      assert.equal(readFileSync(join(media,'transcript.txt'),'utf8'),'Texto local');
      process.env.REJECT_LOCAL='true';
      await assert.rejects(transcribe('audio.wav',join(media,'transcript.txt')),/local generation rejected/);
      assert.equal(readdirSync(media).filter(n=>n.startsWith('local-transcription-')).length,2);
      assert.equal(readFileSync(join(media,'transcript.txt'),'utf8'),'Texto local');
      await pool.end();
    `);
    await withPostgresDatabase(async (databaseUrl) => {
      const result = spawnSync("node", ["--import", "tsx", runner], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl, CURATOR_DATA_DIR: join(directory, "data") },
        encoding: "utf8",
      });
      expect({ status: result.status, stderr: result.stderr }).toEqual({
        status: 0,
        stderr: "local generation rejected\n",
      });
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
