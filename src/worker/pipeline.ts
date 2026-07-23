import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { db } from "../lib/db";
import { dataDir } from "../lib/paths";
import { getWorkerConfig } from "./config";
import { runCommand, runCommandCapture } from "./process";
import { transcribe } from "./transcribe";

type Publication = {
  id: string;
  source_url: string;
  media_type: string | null;
  instagram_json: string | null;
};

type DownloadMetadata = {
  title?: string;
  description?: string;
  uploader?: string;
  timestamp?: number;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string }>;
  entries?: DownloadMetadata[];
  vcodec?: string;
  ext?: string;
};

function portable(path: string): string {
  return relative(dataDir, resolve(path));
}

function event(id: string, stage: string, type: string, message?: string): void {
  db.prepare(`
    INSERT INTO pipeline_events(publication_id,stage,event_type,message)
    VALUES (?,?,?,?)
  `).run(id, stage, type, message ?? null);
}

function transition(id: string, status: string, fields: Record<string, string | number | null> = {}): void {
  const allowed = new Set([
    "video_path", "audio_path", "transcript_path", "transcript_text",
    "contact_sheet_path", "frames_json", "last_error", "attempts",
  ]);
  const entries = Object.entries(fields).filter(([key]) => allowed.has(key));
  const assignments = ["processing_status=?", "current_stage=?", ...entries.map(([key]) => `${key}=?`)];
  db.prepare(`UPDATE publications SET ${assignments.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(status, status, ...entries.map(([, value]) => value), id);
  event(id, status, "transition");
}

function claimNext(): Publication | null {
  const transaction = db.transaction(() => {
    const publication = db.prepare(`
      SELECT id,source_url,media_type,instagram_json FROM publications
      WHERE processing_status='pending'
      ORDER BY created_at LIMIT 1
    `).get() as Publication | undefined;
    if (!publication) return null;
    transition(publication.id, "downloading");
    return publication;
  });
  return transaction();
}

export async function processNextPublication(): Promise<boolean> {
  const publication = claimNext();
  if (!publication) return false;
  const workerConfig = getWorkerConfig();

  const directory = join(workerConfig.mediaRoot, publication.id);
  mkdirSync(directory, { recursive: true });
  try {
    let metadata: DownloadMetadata | null = publication.instagram_json
      ? JSON.parse(publication.instagram_json) as DownloadMetadata
      : null;
    if (!metadata) {
      const inspect = [workerConfig.ytdlpBin, "--dump-single-json", "--skip-download", "--ignore-no-formats-error", "--no-playlist", publication.source_url];
      if (workerConfig.ytdlpCookiesFromBrowser) inspect.splice(1, 0, "--cookies-from-browser", workerConfig.ytdlpCookiesFromBrowser);
      else if (workerConfig.ytdlpCookieFile) inspect.splice(1, 0, "--cookies", workerConfig.ytdlpCookieFile);
      metadata = JSON.parse(await runCommandCapture(inspect)) as DownloadMetadata;
      const entries = metadata.entries?.filter(Boolean) ?? [];
      const mediaType = entries.length > 1 ? "carousel" : metadata.vcodec === "none" || metadata.ext === "jpg" ? "image" : "video";
      db.prepare(`
        UPDATE publications SET instagram_json=?,media_type=?,author=COALESCE(author,?),
          caption=COALESCE(caption,?),published_at=COALESCE(published_at,?),updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(
        JSON.stringify(metadata), mediaType, metadata.uploader ?? null,
        metadata.description ?? metadata.title ?? null,
        metadata.timestamp ? new Date(metadata.timestamp * 1_000).toISOString() : null,
        publication.id,
      );
      publication.media_type = mediaType;
    }

    if (publication.media_type === "image" || publication.media_type === "carousel") {
      const candidates = (metadata.entries?.length ? metadata.entries : [metadata])
        .map((entry) => entry.thumbnail ?? entry.thumbnails?.at(-1)?.url)
        .filter((url): url is string => Boolean(url))
        .slice(0, workerConfig.maxContactSheetFrames);
      const framesDirectory = join(directory, "frames");
      mkdirSync(framesDirectory, { recursive: true });
      const frames: string[] = [];
      if (candidates.length) {
        for (const [index, url] of candidates.entries()) {
          const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
          if (!response.ok) throw new Error(`Instagram image returned HTTP ${response.status}`);
          const imagePath = join(framesDirectory, `image-${String(index + 1).padStart(3, "0")}.jpg`);
          writeFileSync(imagePath, Buffer.from(await response.arrayBuffer()));
          frames.push(imagePath);
        }
      } else {
        const gallery = [
          workerConfig.galleryDlBin, "-D", framesDirectory,
          "-f", "{num:03}.{extension}", publication.source_url,
        ];
        if (workerConfig.ytdlpCookiesFromBrowser) {
          gallery.splice(1, 0, "--cookies-from-browser", workerConfig.ytdlpCookiesFromBrowser);
        } else if (workerConfig.ytdlpCookieFile) {
          gallery.splice(1, 0, "--cookies", workerConfig.ytdlpCookieFile);
        }
        await runCommand(gallery);
        frames.push(...readdirSync(framesDirectory)
          .filter((file) => /\.(?:jpe?g|png|webp)$/i.test(file))
          .slice(0, workerConfig.maxContactSheetFrames)
          .map((file) => join(framesDirectory, file)));
      }
      if (!frames.length) throw new Error("gallery-dl did not produce any Instagram images");
      const normalizedFrames: string[] = [];
      for (const [index, frame] of frames.entries()) {
        if (/\.jpe?g$/i.test(frame)) {
          normalizedFrames.push(frame);
          continue;
        }
        const normalized = join(framesDirectory, `image-${String(index + 1).padStart(3, "0")}.jpg`);
        await runCommand([workerConfig.ffmpegBin, "-y", "-i", frame, "-frames:v", "1", normalized]);
        normalizedFrames.push(normalized);
      }
      const contactSheetPath = join(directory, "contact-sheet.jpg");
      await runCommand([
        workerConfig.ffmpegBin, "-y", "-pattern_type", "glob", "-i", join(framesDirectory, "*.jpg"),
        "-vf", normalizedFrames.length === 1 ? "scale=1080:-2" : "scale=720:-2,tile=3x3:padding=8:margin=8",
        "-frames:v", "1", contactSheetPath,
      ]);
      transition(publication.id, "ready_for_analysis", {
        contact_sheet_path: portable(contactSheetPath),
        frames_json: JSON.stringify(normalizedFrames.map(portable)),
        transcript_text: "",
        last_error: null,
      });
      return true;
    }

    let videoPath = join(directory, "video.mp4");
    if (!existsSync(videoPath)) {
      const command = [
        workerConfig.ytdlpBin,
        "--no-playlist",
        "--write-info-json",
        "--write-thumbnail",
        "--convert-thumbnails", "jpg",
        "--merge-output-format", "mp4",
        "-o", join(directory, "video.%(ext)s"),
        publication.source_url,
      ];
      if (workerConfig.ytdlpCookiesFromBrowser) {
        command.splice(2, 0, "--cookies-from-browser", workerConfig.ytdlpCookiesFromBrowser);
      } else if (workerConfig.ytdlpCookieFile) {
        command.splice(2, 0, "--cookies", workerConfig.ytdlpCookieFile);
      }
      await runCommand(command);
      const actual = readdirSync(directory).find((file) => /^video\.(mp4|mkv|webm|mov)$/.test(file));
      if (!actual) throw new Error("yt-dlp did not produce a supported video");
      videoPath = join(directory, actual);
    }

    transition(publication.id, "extracting_media", { video_path: portable(videoPath) });
    const audioPath = join(directory, "audio.wav");
    const audioStream = (await runCommandCapture([
      workerConfig.ffprobeBin, "-v", "error", "-select_streams", "a:0",
      "-show_entries", "stream=index", "-of", "csv=p=0", videoPath,
    ])).trim();
    if (audioStream) {
      await runCommand([
        workerConfig.ffmpegBin, "-y", "-i", videoPath,
        "-vn", "-ac", "1", "-ar", "16000", audioPath,
      ]);
    }

    const framesDirectory = join(directory, "frames");
    mkdirSync(framesDirectory, { recursive: true });
    await runCommand([
      workerConfig.ffmpegBin, "-y", "-i", videoPath,
      "-vf", `fps=1/${workerConfig.frameIntervalSeconds},scale=720:-2`,
      join(framesDirectory, "frame-%03d.jpg"),
    ]);
    const frames = readdirSync(framesDirectory)
      .filter((file) => file.endsWith(".jpg"))
      .slice(0, workerConfig.maxContactSheetFrames);
    const contactSheetPath = join(directory, "contact-sheet.jpg");
    if (frames.length > 0) {
      await runCommand([
        workerConfig.ffmpegBin, "-y", "-pattern_type", "glob",
        "-i", join(framesDirectory, "*.jpg"),
        "-vf", "tile=3x3:padding=8:margin=8", "-frames:v", "1", contactSheetPath,
      ]);
    }

    transition(publication.id, "transcribing", {
      audio_path: audioStream ? portable(audioPath) : null,
      contact_sheet_path: existsSync(contactSheetPath) ? portable(contactSheetPath) : null,
      frames_json: JSON.stringify(frames.map((file) => portable(join(framesDirectory, file)))),
    });
    const transcriptPath = join(directory, "transcript.txt");
    const transcriptText = audioStream ? await transcribe(audioPath, transcriptPath) : "";
    if (!audioStream) writeFileSync(transcriptPath, "");
    transition(publication.id, "ready_for_analysis", {
      transcript_path: portable(transcriptPath),
      transcript_text: transcriptText,
      last_error: null,
    });
    return true;
  } catch (error) {
    const row = db.prepare("SELECT attempts FROM publications WHERE id=?")
      .get(publication.id) as { attempts: number };
    const message = error instanceof Error ? error.message : String(error);
    transition(publication.id, "failed", {
      attempts: row.attempts + 1,
      last_error: message.slice(0, 4_000),
    });
    event(publication.id, "failed", "error", message.slice(0, 4_000));
    return true;
  }
}

export async function runWorker(loop: boolean, limit: number): Promise<number> {
  let completed = 0;
  do {
    const worked = await processNextPublication();
    if (!worked) break;
    completed++;
  } while (loop && completed < limit);
  return completed;
}
