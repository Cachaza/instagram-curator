import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("library and detail expose only media files that exist inside the data directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "curator-media-"));
  try {
    const script = `
      import assert from "node:assert/strict";
      import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
      import { join } from "node:path";
      import { db } from "./src/lib/db.ts";
      import { listContent, getContent } from "./src/lib/content.ts";
      import { dataDir } from "./src/lib/paths.ts";
      const insert = db.prepare("INSERT INTO publications(id,source_url,caption,processing_status,video_path,contact_sheet_path) VALUES (?,?,?,'ready_for_analysis',?,?)");
      insert.run("missing", "https://www.instagram.com/reel/missing/", "Archived text", "media/missing.mp4", "media/missing.jpg");
      assert.equal(getContent("missing").hasVideo, false);
      assert.equal(getContent("missing").hasImage, false);
      mkdirSync(join(dataDir,"media"));
      writeFileSync(join(dataDir,"media/video.mp4"),"fixture");
      writeFileSync(join(dataDir,"media/image.jpg"),"fixture");
      insert.run("available", "https://www.instagram.com/reel/available/", "Available files", "media/video.mp4", "media/image.jpg");
      const available = listContent().find(x => x.id === "available");
      assert.equal(available.hasVideo, true);
      assert.equal(available.hasImage, true);
      unlinkSync(join(dataDir,"media/video.mp4"));
      assert.equal(getContent("available").hasVideo, false);
      assert.equal(getContent("available").hasImage, true);
      db.prepare("UPDATE publications SET video_path=? WHERE id='available'").run(process.argv[1]);
      assert.equal(getContent("available").hasVideo, false);
      db.close();
    `;
    const result = spawnSync("node", ["--import", "tsx", "--input-type=module", "-e", script, import.meta.path], {
      cwd: process.cwd(), env: { ...process.env, CURATOR_DATA_DIR: directory }, encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
