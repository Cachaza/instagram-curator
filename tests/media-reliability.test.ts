import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishMediaFile } from "../src/lib/atomic-media";
import { previewResponse } from "../src/lib/media-response";
import { inspectMediaFiles } from "../src/lib/media-audit";

test("preview publication keeps old bytes readable until generation succeeds and preserves them on failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "curator-preview-"));
  const destination = join(root, "contact-sheet.jpg");
  try {
    await writeFile(destination, "original");
    await expect(publishMediaFile(destination, async (temporary) => {
      await writeFile(temporary, "partial");
      expect(await readFile(destination, "utf8")).toBe("original");
      throw new Error("synthetic ffmpeg failure");
    })).rejects.toThrow("synthetic ffmpeg failure");
    expect(await readFile(destination, "utf8")).toBe("original");
    await expect(publishMediaFile(destination, async (temporary) => { await writeFile(temporary, ""); })).rejects.toThrow("no file content");
    expect(await readFile(destination, "utf8")).toBe("original");
    await publishMediaFile(destination, async (temporary) => {
      await writeFile(temporary, "complete replacement");
      expect(await readFile(destination, "utf8")).toBe("original");
    });
    expect(await readFile(destination, "utf8")).toBe("complete replacement");
    expect(await readdir(root)).toEqual(["contact-sheet.jpg"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("preview responses revalidate completed replacements and never cache missing or empty files", async () => {
  const root = await mkdtemp(join(tmpdir(), "curator-response-"));
  const path = join(root, "preview.jpg");
  try {
    let response = await previewResponse(path, null);
    expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toContain("no-store");
    await writeFile(path, "");response = await previewResponse(path, null);expect(response.status).toBe(404);
    await writeFile(path, "old preview");response = await previewResponse(path, null);
    const etag = response.headers.get("etag")!;
    expect(await response.text()).toBe("old preview");expect(response.headers.get("cache-control")).toContain("must-revalidate");
    response = await previewResponse(path, etag);expect(response.status).toBe(304);expect(await response.text()).toBe("");
    expect((await previewResponse(path, `W/${etag}`)).status).toBe(304);
    await publishMediaFile(path, async (temporary) => { await writeFile(temporary, "new preview"); });
    response = await previewResponse(path, etag);
    expect(response.status).toBe(200); expect(response.headers.get("etag")).not.toBe(etag); expect(await response.text()).toBe("new preview");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("media audit distinguishes missing, empty and unsafe paths without modifying files", async () => {
  const root = await mkdtemp(join(tmpdir(), "curator-audit-"));
  try {
    await writeFile(join(root, "good.jpg"), "preview");await writeFile(join(root, "empty.mp4"), "");await mkdir(join(root,"directory"));
    const report = inspectMediaFiles([
      { id: "one", contact_sheet_path: "good.jpg", video_path: "empty.mp4", audio_path: null },
      { id: "two", contact_sheet_path: "missing.jpg", video_path: "../outside.mp4", audio_path: "directory" },
    ], root);
    expect(report.publications).toBe(2);expect(report.available).toBe(1);
    expect(report.unavailable.map(x=>x.state)).toEqual(["empty","missing","outside_storage","not_file"]);
    expect(await readFile(join(root, "good.jpg"),"utf8")).toBe("preview");
  } finally { await rm(root, { recursive: true, force: true }); }
});
