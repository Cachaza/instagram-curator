import { dirname, join, resolve, sep } from "node:path";
import { existsSync, renameSync, statSync } from "node:fs";
import { dataDir } from "./paths";
import { getSetting } from "./settings";
import { runCommand, runCommandCapture } from "../worker/process";

export function resolveMediaPath(storedPath: string | null): string | null {
  if (!storedPath) return null;
  const root = resolve(dataDir);
  const path = resolve(root, storedPath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) return null;
  try {
    const file = statSync(path);
    return file.isFile() && file.size > 0 ? path : null;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(String(error.code))) return null;
    throw error;
  }
}

const compatibleVideos = new Map<string, Promise<string>>();

export async function resolveCompatibleVideo(path: string): Promise<string> {
  const existing = compatibleVideos.get(path);
  if (existing) return existing;
  const conversion = createCompatibleVideo(path).catch((error) => {
    compatibleVideos.delete(path);
    throw error;
  });
  compatibleVideos.set(path, conversion);
  return conversion;
}

async function createCompatibleVideo(path: string): Promise<string> {
  const output = join(dirname(path), "video.compat.mp4");
  if (existsSync(output)) return output;

  const codec = (await runCommandCapture([
    await getSetting<string>("media.ffprobe_bin", "ffprobe"),
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", path,
  ])).trim();
  if (codec === "h264") return path;

  const temporary = join(dirname(path), "video.compat.part.mp4");
  await runCommand([
    await getSetting<string>("media.ffmpeg_bin", "ffmpeg"), "-y", "-i", path,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart", temporary,
  ]);
  renameSync(temporary, output);
  return output;
}
