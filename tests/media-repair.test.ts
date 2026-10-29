import { afterEach, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { QueryResultRow } from "pg";
import { repairMissingPreviews, type RepairConfig, type RepairDeps, type RepairPublication } from "../src/worker/media-repair";
import { runCommandCapture } from "../src/worker/process";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const config = { ffmpegBin: "ffmpeg", ffprobeBin: "ffprobe", ytdlpBin: "synthetic-download", galleryDlBin: "synthetic-gallery", ytdlpCookiesFromBrowser: "", ytdlpCookieFile: "", frameIntervalSeconds: 5, maxContactSheetFrames: 9 } as RepairConfig;

async function fixture(fields: Partial<RepairPublication> = {}) {
  const root = await mkdtemp(join(tmpdir(), "curator-media-repair-"));
  roots.push(root);
  const row: RepairPublication = { id: "publication_fixture", source_url: "https://www.instagram.com/reel/Fixture/", media_type: "video", contact_sheet_path: null, video_path: null, frames_json: "[]", ...fields };
  const directory = join(root, "media", row.id);
  await mkdir(directory, { recursive: true });
  const statements: { sql: string; params: unknown[] }[] = [];
  const commands: string[][] = [];
  const deps: RepairDeps = {
    root, config, capture: runCommandCapture,
    db: { async all<T extends QueryResultRow>() { return [row] as unknown as T[]; }, async execute(sql, params = []) { statements.push({ sql, params }); } },
    run: async (command) => { commands.push(command); await runCommandCapture(command); },
  };
  return { root, row, directory, statements, commands, deps };
}

// Real FFmpeg verifies the repair's downloaded-video selection, extraction, and
// final preview decoding. The synthetic one-second clip contains no personal data.
test("redownloads missing video into a separate attempt, publishes a decodable preview, and changes only media fields", async () => {
  const f = await fixture({ video_path: "media/publication_fixture/missing.mp4" });
  const source = join(f.root, "synthetic.mp4");
  await runCommandCapture(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=blue:size=16x16:duration=1", "-c:v", "mpeg4", source]);
  f.deps.run = async (args) => {
    f.commands.push(args);
    if (args[0] === "synthetic-download") await copyFile(source, args[args.indexOf("-o") + 1]!.replace("%(ext)s", "mp4"));
    else await runCommandCapture(args);
  };
  const result = await repairMissingPreviews({ apply: true, deps: f.deps });
  if (result.failed) throw new Error(String(f.statements.at(-1)?.params[1]));
  expect(result).toEqual({ repaired: 1, failed: 0, planned: 1 });
  const update = f.statements.find((entry) => entry.sql.startsWith("UPDATE"))!;
  expect(update.sql).not.toMatch(/processing_status|transcript|analysis|categor|review|action/);
  const video = resolve(f.root, String(update.params[1]));
  expect(video).not.toBe(join(f.directory, "missing.mp4"));
  expect(await readFile(video)).toEqual(await readFile(source));
  const decoded = await runCommandCapture(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", join(f.directory, "contact-sheet.jpg")]);
  expect(decoded.trim()).toBe("mjpeg");
  expect(f.statements.at(-1)?.sql).toContain("'media_repair','completed'");
});

test("dry run creates no attempt, events, updates, or downloads", async () => {
  const f = await fixture();
  expect(await repairMissingPreviews({ apply: false, deps: f.deps })).toEqual({ repaired: 0, failed: 0, planned: 1 });
  expect(f.commands).toEqual([]); expect(f.statements).toEqual([]); expect(await readdir(f.directory)).toEqual([]);
});

test("download failure is persisted and preserves existing analysis and good inputs", async () => {
  const f = await fixture();
  await writeFile(join(f.directory, "transcript.txt"), "original transcript");
  f.deps.run = async () => { throw new Error("synthetic unavailable Instagram source"); };
  expect(await repairMissingPreviews({ apply: true, deps: f.deps })).toEqual({ repaired: 0, failed: 1, planned: 1 });
  expect(f.statements).toHaveLength(1);
  expect(f.statements[0]!.sql).toContain("'media_repair','error'");
  expect(String(f.statements[0]!.params[1])).toContain("attempt retained at media/");
  expect(await readFile(join(f.directory, "transcript.txt"), "utf8")).toBe("original transcript");
});

test("rejects traversal and symlink escapes before downloads or media writes", async () => {
  const f = await fixture({ contact_sheet_path: "../outside.jpg" });
  expect((await repairMissingPreviews({ apply: true, deps: f.deps })).failed).toBe(1);
  f.row.contact_sheet_path = null;
  const outside = await mkdtemp(join(tmpdir(), "curator-outside-")); roots.push(outside);
  await symlink(outside, join(f.directory, "linked"));
  f.row.video_path = "media/publication_fixture/linked/video.mp4";
  expect((await repairMissingPreviews({ apply: true, deps: f.deps })).failed).toBe(1);
  expect(f.commands).toEqual([]); expect(await readdir(outside)).toEqual([]);
});

test("relinks an already valid canonical preview and skips healthy stored previews", async () => {
  const f = await fixture({ contact_sheet_path: "media/publication_fixture/absent.jpg" });
  await runCommandCapture(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=green:size=16x16", "-frames:v", "1", join(f.directory, "contact-sheet.jpg")]);
  const original = await readFile(join(f.directory, "contact-sheet.jpg"));
  expect((await repairMissingPreviews({ apply: true, deps: f.deps })).repaired).toBe(1);
  expect(f.commands.every((args) => args.includes("null"))).toBe(true);
  expect(f.statements[0]!.params[0]).toBe("media/publication_fixture/contact-sheet.jpg");
  f.row.contact_sheet_path = String(f.statements[0]!.params[0]);
  expect(await repairMissingPreviews({ apply: true, deps: f.deps })).toEqual({ repaired: 0, failed: 0, planned: 0 });
  expect(await readFile(join(f.directory, "contact-sheet.jpg"))).toEqual(original);
});

test("nonempty corrupt preview is regenerated instead of being relinked as healthy", async () => {
  const f = await fixture({ contact_sheet_path: "media/publication_fixture/contact-sheet.jpg", media_type: "image" });
  await writeFile(join(f.directory, "contact-sheet.jpg"), "invalid image bytes");
  const source = join(f.root, "source.jpg");
  await runCommandCapture(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=blue:size=16x16", "-frames:v", "1", source]);
  f.deps.run = async (args) => {
    if (args[0] === "synthetic-gallery") await copyFile(source, join(args[args.indexOf("-D") + 1]!, "001.jpg"));
    else await runCommandCapture(args);
  };
  expect((await repairMissingPreviews({ apply: true, deps: f.deps })).repaired).toBe(1);
  const decoded = await runCommandCapture(["ffmpeg", "-v", "error", "-xerror", "-i", join(f.directory, "contact-sheet.jpg"), "-frames:v", "1", "-f", "null", "-"]);
  expect(decoded).toBe("");
});

test("mixed valid and corrupt downloaded JPEGs fail rather than publish a partial sheet", async () => {
  const f = await fixture({ media_type: "carousel" });
  const source = join(f.root, "source.jpg");
  await runCommandCapture(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=blue:size=16x16", "-frames:v", "1", source]);
  f.deps.run = async (args) => {
    if (args[0] === "synthetic-gallery") {
      const destination = args[args.indexOf("-D") + 1]!;
      await copyFile(source, join(destination, "001.jpg"));
      await writeFile(join(destination, "002.jpg"), "corrupt second image");
    } else await runCommandCapture(args);
  };
  expect((await repairMissingPreviews({ apply: true, deps: f.deps })).failed).toBe(1);
  expect(f.statements.some((entry) => entry.sql.startsWith("UPDATE"))).toBe(false);
  expect(f.statements.at(-1)?.sql).toContain("'media_repair','error'");
  await expect(readFile(join(f.directory, "contact-sheet.jpg"))).rejects.toThrow();
});

test("corrupt reused frames trigger fresh recovery while keeping the original files", async () => {
  const f = await fixture({ media_type: "image", frames_json: '["media/publication_fixture/old.jpg","media/publication_fixture/bad.jpg"]' });
  const original = join(f.directory, "old.jpg");
  await runCommandCapture(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=blue:size=16x16", "-frames:v", "1", original]);
  await writeFile(join(f.directory, "bad.jpg"), "original corrupt frame");
  let downloads = 0;
  f.deps.run = async (args) => {
    if (args[0] === "synthetic-gallery") {
      downloads++;
      await copyFile(original, join(args[args.indexOf("-D") + 1]!, "001.jpg"));
    } else await runCommandCapture(args);
  };
  expect((await repairMissingPreviews({ apply: true, deps: f.deps })).repaired).toBe(1);
  expect(downloads).toBe(1);
  expect(await readFile(join(f.directory, "bad.jpg"), "utf8")).toBe("original corrupt frame");
});

test("valid audio disguised as a preview is not accepted as a healthy image", async () => {
  const f = await fixture({ contact_sheet_path: "media/publication_fixture/contact-sheet.jpg" });
  await runCommandCapture(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc", "-t", "1", "-f", "wav", join(f.directory, "contact-sheet.jpg")]);
  expect(await repairMissingPreviews({ apply: false, deps: f.deps })).toEqual({ repaired: 0, failed: 0, planned: 1 });
  expect(f.statements).toEqual([]);
});

test("carousel images with different dimensions are normalized before a complete tile is published", async () => {
  const f = await fixture({ media_type: "carousel" });
  const first = join(f.directory, "first.jpg"), second = join(f.directory, "second.jpg");
  await runCommandCapture(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=blue:size=16x16", "-frames:v", "1", first]);
  await runCommandCapture(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=green:size=32x32", "-frames:v", "1", second]);
  f.row.frames_json = JSON.stringify(["media/publication_fixture/first.jpg", "media/publication_fixture/second.jpg"]);
  expect((await repairMissingPreviews({ apply: true, deps: f.deps })).repaired).toBe(1);
  const update = f.statements.find((entry) => entry.sql.startsWith("UPDATE"))!;
  const normalized = JSON.parse(String(update.params[2])) as string[];
  expect(normalized).toHaveLength(2);
  for (const frame of normalized) {
    const metadata = JSON.parse(await runCommandCapture(["ffprobe", "-v", "error", "-show_entries", "stream=width,height,codec_name", "-of", "json", resolve(f.root, frame)]));
    expect(metadata.streams[0]).toEqual({ codec_name: "mjpeg", width: 720, height: 720 });
  }
  expect(f.commands.some((args) => args[args.indexOf("-vf") + 1] === "tile=2x1:padding=8:margin=8")).toBe(true);
  await runCommandCapture(["ffmpeg", "-v", "error", "-xerror", "-i", join(f.directory, "contact-sheet.jpg"), "-frames:v", "1", "-f", "null", "-"]);
});
