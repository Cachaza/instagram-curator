import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("transcription diagnostics follow the selected provider and web-only execution mode", () => {
  const directory = mkdtempSync(join(tmpdir(), "curator-diagnostics-"));
  try {
    const script = `
      import assert from "node:assert/strict";
      import { setSetting } from "./src/lib/settings.ts";
      import { transcriptionDiagnostic } from "./src/lib/diagnostics.ts";
      import { db } from "./src/lib/db.ts";
      setSetting("transcription.provider", "local");
      assert.equal(transcriptionDiagnostic(false).ok, false);
      assert.match(transcriptionDiagnostic(false).detail, /local_command/);
      setSetting("transcription.local_command", [process.execPath, "local-model.mjs"]);
      assert.equal(transcriptionDiagnostic(false).ok, true);
      assert.equal(transcriptionDiagnostic(false).label, "Transcripción local");
      assert.equal(transcriptionDiagnostic(true).external, true);
      assert.equal(transcriptionDiagnostic(true).ok, false);
      setSetting("transcription.provider", "openai");
      assert.equal(transcriptionDiagnostic(false).ok, false);
      assert.match(transcriptionDiagnostic(false).detail, /API key/);
      assert.equal(transcriptionDiagnostic(true).external, true);
      setSetting("ui.locale", "en");
      setSetting("transcription.provider", "local");
      assert.equal(transcriptionDiagnostic(true).label, "Local transcription");
      assert.equal(transcriptionDiagnostic(true).detail, "Not checked in web-only mode.");
      db.close();
    `;
    const result = spawnSync("node", ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: process.cwd(), env: { ...process.env, CURATOR_DATA_DIR: directory }, encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
