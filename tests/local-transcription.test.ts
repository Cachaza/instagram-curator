import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { withPostgresDatabase } from "./postgres";
import { readLocalWorkerSettings } from "../src/worker/local-settings";

test("private worker settings fail visibly when the file or a machine value is invalid", () => {
  const directory = mkdtempSync(join(tmpdir(), "curator-worker-settings-test-"));
  try {
    const missing = join(directory, "missing.json");
    expect(() => readLocalWorkerSettings(missing)).toThrow(/Unable to read CURATOR_WORKER_CONFIG_FILE/);
    const file = join(directory, "settings.json");
    writeFileSync(file, JSON.stringify({ "transcription.local_command": [] }));
    expect(() => readLocalWorkerSettings(file)).toThrow(/invalid transcription\.local_command/);
    for (const key of ["constructor","__proto__","toString","SYNTHETIC_PRIVATE_CONTENT"]) {
      writeFileSync(file,JSON.stringify(Object.fromEntries([[key,"synthetic value"]])));
      try { readLocalWorkerSettings(file); throw new Error("Malformed settings were accepted"); }
      catch(error) {
        expect((error as Error).message).toContain("unknown setting");
        expect((error as Error).message).not.toContain(key);
      }
    }
    writeFileSync(file, '{"SYNTHETIC_PRIVATE_CONTENT":');
    try { readLocalWorkerSettings(file); throw new Error("Malformed JSON was accepted"); }
    catch(error) { expect((error as Error).message).not.toContain("SYNTHETIC_PRIVATE_CONTENT"); }
    writeFileSync(file, "[");
    expect(() => readLocalWorkerSettings(file)).toThrow(/Unable to read CURATOR_WORKER_CONFIG_FILE/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

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
    const workerConfig = join(directory, "worker-settings.json");
    writeFileSync(workerConfig, JSON.stringify({
      "transcription.provider": "local",
      "transcription.local_command": [process.execPath, fixture],
    }));
    const runner = join(directory, "runner.mts");
    writeFileSync(runner, `
      import assert from 'node:assert/strict';
      import {readFileSync,readdirSync} from 'node:fs';
      import {join} from 'node:path';
      import {migrateAppDatabase,pool} from ${JSON.stringify(pathToFileURL(resolve("src/lib/db.ts")).href)};
      import {transcribe} from ${JSON.stringify(pathToFileURL(resolve("src/worker/transcribe.ts")).href)};
      const media=${JSON.stringify(media)};
      globalThis.fetch=async()=>{throw new Error('API must not be called');};
      await migrateAppDatabase();
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
        env: { ...process.env, DATABASE_URL: databaseUrl, CURATOR_DATA_DIR: join(directory, "data"), CURATOR_WORKER_CONFIG_FILE: workerConfig },
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
