import { accessSync, constants, lstatSync, mkdirSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { QueryResultRow } from "pg";
import { publishMediaFile } from "../lib/atomic-media";
import { db } from "../lib/db";
import { parseInstagramUrl } from "../lib/instagram-url";
import { dataDir } from "../lib/paths";
import { getWorkerConfig } from "./config";
import { runCommand, runCommandCapture } from "./process";

export type RepairPublication = QueryResultRow & {
  id: string;
  source_url: string;
  media_type: string | null;
  contact_sheet_path: string | null;
  video_path: string | null;
  frames_json: string | null;
};
export type RepairConfig = Awaited<ReturnType<typeof getWorkerConfig>>;
type RepairStore = Pick<typeof db, "all" | "execute">;
export type RepairDeps = { db: RepairStore; root: string; config: RepairConfig; run: typeof runCommand; capture: typeof runCommandCapture };

/** Reject traversal and symlinks, including existing ancestors of new paths. */
function mediaPath(root: string, stored: string): string {
  const base = resolve(root, "media");
  const path = resolve(root, stored);
  if (!path.startsWith(`${base}${sep}`)) throw new Error(`Unsafe media path: ${stored}`);
  for (let current = path; current !== resolve(root); current = dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Unsafe media symlink: ${stored}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return path;
}

function available(path: string): boolean {
  try {
    const file = statSync(path);
    if (!file.isFile() || file.size === 0) return false;
    accessSync(path, constants.R_OK);
    return true;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  }
}

function addCookies(args: string[], config: RepairConfig): string[] {
  const authentication = config.ytdlpCookiesFromBrowser
    ? ["--cookies-from-browser", config.ytdlpCookiesFromBrowser]
    : config.ytdlpCookieFile ? ["--cookies", config.ytdlpCookieFile] : [];
  return [args[0]!, ...authentication, ...args.slice(1)];
}

function images(directory: string): string[] {
  return readdirSync(directory).sort().filter((file) => /\.(?:jpe?g|png|webp)$/i.test(file)).map((file) => join(directory, file));
}

export async function repairMissingPreviews(options: { apply: boolean; id?: string; deps?: Partial<RepairDeps> }) {
  const d: RepairDeps = {
    db, root: dataDir, config: options.deps?.config ?? await getWorkerConfig(), run: runCommand, capture: runCommandCapture, ...options.deps,
  };
  const rows = await d.db.all<RepairPublication>(
    `SELECT id,source_url,media_type,contact_sheet_path,video_path,frames_json FROM publications${options.id ? " WHERE id=$1" : ""} ORDER BY created_at`,
    options.id ? [options.id] : [],
  );
  if (options.id && rows.length === 0) throw new Error(`Publication not found: ${options.id}`);
  let repaired = 0, failed = 0, planned = 0;
  for (const row of rows) {
    let attempt: string | undefined;
    try {
      if (!row.id || row.id !== basename(row.id) || [".", ".."].includes(row.id)) throw new Error("Invalid publication media directory");
      const directory = mediaPath(d.root, join("media", row.id));
      const decoded = new Map<string, boolean>();
      const decodable = async (path: string, kind: "image" | "frame" | "video" = "image"): Promise<boolean> => {
        if (!available(path)) return false;
        const key = `${kind}:${path}`;
        if (decoded.has(key)) return decoded.get(key)!;
        try {
          const metadata = JSON.parse(await d.capture([d.config.ffprobeBin, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,codec_type:format=format_name", "-of", "json", path]));
          const visual = metadata.streams?.some((stream: { codec_type?: string }) => stream.codec_type === "video");
          // Contact sheets are JPEGs; an audio or movie file with a .jpg suffix
          // is not a usable browser preview, even when FFmpeg can decode it.
          const validFormat = kind === "video"
            ? metadata.format?.format_name?.split(",").some((format: string) => ["mov", "mp4", "matroska", "webm"].includes(format))
            : (kind === "image" ? ["mjpeg"] : ["mjpeg", "png", "webp"]).includes(metadata.streams?.[0]?.codec_name)
              && ["image2", "jpeg_pipe", "png_pipe", "webp_pipe"].includes(metadata.format?.format_name);
          if (!visual || !validFormat) { decoded.set(key, false); return false; }
          await d.run([d.config.ffmpegBin, "-v", "error", "-xerror", "-i", path, "-map", "0:v:0", "-frames:v", "1", "-f", "null", "-"]);
          decoded.set(key, true);
          return true;
        } catch { decoded.set(key, false); return false; }
      };
      const previousPreview = row.contact_sheet_path ? mediaPath(d.root, row.contact_sheet_path) : undefined;
      if (previousPreview && await decodable(previousPreview)) continue;
      const preview = join(directory, "contact-sheet.jpg");
      // A valid canonical preview can be relinked without touching its bytes.
      const canonicalExists = await decodable(mediaPath(d.root, relative(d.root, preview)));
      planned++;
      const parsed = parseInstagramUrl(row.source_url);
      if (parsed.normalizedUrl !== row.source_url) throw new Error("Publication URL is not normalized; refusing media repair");
      const storedFrames: unknown = JSON.parse(row.frames_json || "[]");
      if (!Array.isArray(storedFrames) || storedFrames.some((frame) => typeof frame !== "string")) throw new Error("Invalid stored frame paths");
      let frames = storedFrames.map((frame: string) => mediaPath(d.root, frame));
      for (const frame of frames) {
        if (!await decodable(frame, "frame")) { frames = []; break; }
      }
      let video = row.video_path ? mediaPath(d.root, row.video_path) : undefined;
      if (!options.apply) continue;
      mkdirSync(directory, { recursive: true });
      if (!canonicalExists) {
        // Preserve every failed attempt on the server; never overwrite good inputs.
        attempt = mkdtempSync(join(directory, "media-repair-"));
        const attemptDirectory = attempt;
        const frameDirectory = join(attempt, "frames");
        mkdirSync(frameDirectory);
        if (!frames.length) {
          if (row.media_type === "image" || row.media_type === "carousel") {
            await d.run(addCookies([d.config.galleryDlBin, "-D", frameDirectory, "-f", "{num:03}.{extension}", parsed.normalizedUrl], d.config));
            frames = images(frameDirectory);
          } else {
            const downloadVideo = async () => {
              await d.run(addCookies([d.config.ytdlpBin, "--no-playlist", "--merge-output-format", "mp4", "-o", join(attemptDirectory, "video.%(ext)s"), parsed.normalizedUrl], d.config));
              const filename = readdirSync(attemptDirectory).find((file) => /^video\.(?:mp4|mkv|webm|mov)$/i.test(file));
              if (!filename) throw new Error("yt-dlp did not produce a supported video");
              video = mediaPath(d.root, relative(d.root, join(attemptDirectory, filename)));
              if (!available(video)) throw new Error("Downloaded video is empty or unavailable");
              return video;
            };
            const extract = async (source: string, destination: string) => {
              await d.run([d.config.ffmpegBin, "-y", "-xerror", "-i", source, "-vf", `fps=1/${d.config.frameIntervalSeconds}:round=up,scale=720:-2,format=yuvj420p`, "-frames:v", String(d.config.maxContactSheetFrames), join(destination, "frame-%03d.jpg")]);
              let extracted = images(destination);
              if (!extracted.length) {
                await d.run([d.config.ffmpegBin, "-y", "-xerror", "-i", source, "-frames:v", "1", join(destination, "frame-000.jpg")]);
                extracted = images(destination);
              }
              return extracted;
            };
            const reusedVideo = Boolean(video && await decodable(video, "video"));
            if (!reusedVideo) video = await downloadVideo();
            try { frames = await extract(video!, frameDirectory); }
            catch (error) {
              if (!reusedVideo) throw error;
              await d.db.execute("INSERT INTO pipeline_events(publication_id,stage,event_type,message) VALUES ($1,'media_repair','input_invalid',$2)", [row.id, "Saved video could not be decoded; original retained, attempting fresh download"]);
              video = await downloadVideo();
              const freshFrames = join(attempt, "downloaded-frames");
              mkdirSync(freshFrames);
              frames = await extract(video, freshFrames);
            }
          }
        }
        frames = frames.slice(0, d.config.maxContactSheetFrames);
        if (!frames.length) throw new Error("No usable media frames were produced");
        const normalizedDirectory = join(attempt, "preview-frames");
        mkdirSync(normalizedDirectory);
        const normalized: string[] = [];
        for (const [index, source] of frames.entries()) {
          const frame = mediaPath(d.root, relative(d.root, source));
          if (!available(frame)) throw new Error("Preview source frame is empty or unavailable");
          const output = join(normalizedDirectory, `frame-${String(index).padStart(3, "0")}.jpg`);
          // Use the ingestion pipeline's 720px scale as a common square
          // canvas, preserving the whole frame with padding rather than crop.
          await d.run([d.config.ffmpegBin, "-y", "-xerror", "-i", frame, "-vf", "scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuvj420p", "-frames:v", "1", output]);
          if (!available(output)) throw new Error("Normalized preview frame is empty or unavailable");
          normalized.push(output);
        }
        frames = normalized;
        const columns = Math.ceil(Math.sqrt(frames.length));
        const rows = Math.ceil(frames.length / columns);
        // Single-image scale and tile spacing match the existing ingestion pipeline.
        const filter = frames.length === 1 ? "scale=1080:-2" : `tile=${columns}x${rows}:padding=8:margin=8`;
        await publishMediaFile(preview, (temporary) => d.run([d.config.ffmpegBin, "-y", "-xerror", "-pattern_type", "glob", "-i", join(normalizedDirectory, "*.jpg"), "-vf", filter, "-frames:v", "1", temporary]));
      }
      const videoPath = video && available(video) ? relative(d.root, video) : row.video_path;
      await d.db.execute("UPDATE publications SET contact_sheet_path=$1,video_path=$2,frames_json=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$4", [relative(d.root, preview), videoPath, JSON.stringify(frames.map((frame) => relative(d.root, frame))), row.id]);
      await d.db.execute("INSERT INTO pipeline_events(publication_id,stage,event_type,message) VALUES ($1,'media_repair','completed',$2)", [row.id, "Preview repaired; analysis and organization retained"]);
      repaired++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      if (options.apply) await d.db.execute("INSERT INTO pipeline_events(publication_id,stage,event_type,message) VALUES ($1,'media_repair','error',$2)", [row.id, `${message}${attempt ? `; attempt retained at ${relative(d.root, attempt)}` : ""}`]);
    }
  }
  return { repaired, failed, planned };
}
