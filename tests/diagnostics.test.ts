import { test, expect } from "bun:test";
import { withPostgresDatabase, runPostgresScript } from "./postgres";

test("transcription diagnostics follow selected provider and web-only mode", async () => {
  await withPostgresDatabase(async (databaseUrl) => {
    const result = runPostgresScript(`
      import assert from 'node:assert/strict';
      import {setSetting} from './src/lib/settings.ts';
      import {transcriptionDiagnostic} from './src/lib/diagnostics.ts';
      import {pool,migrateAppDatabase} from './src/lib/db.ts';
      await migrateAppDatabase();
      await setSetting('transcription.provider','local');
      assert.equal((await transcriptionDiagnostic(false)).ok,false);
      assert.match((await transcriptionDiagnostic(false)).detail,/local_command/);
      await setSetting('transcription.local_command',[process.execPath,'local-model.mjs']);
      assert.equal((await transcriptionDiagnostic(false)).ok,true);
      assert.equal((await transcriptionDiagnostic(false)).label,'Transcripción local');
      assert.equal((await transcriptionDiagnostic(true)).external,true);
      assert.equal((await transcriptionDiagnostic(true)).ok,false);
      await setSetting('transcription.provider','openai');
      assert.equal((await transcriptionDiagnostic(false)).ok,false);
      assert.match((await transcriptionDiagnostic(false)).detail,/API key/);
      assert.equal((await transcriptionDiagnostic(true)).external,true);
      await setSetting('ui.locale','en');
      await setSetting('transcription.provider','local');
      assert.equal((await transcriptionDiagnostic(true)).label,'Local transcription');
      assert.equal((await transcriptionDiagnostic(true)).detail,'Not checked in web-only mode.');
      await pool.end();
    `, databaseUrl);
    expect(result.status, result.stderr).toBe(0);
  });
});
