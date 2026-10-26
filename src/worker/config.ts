import { resolve } from "node:path";
import { dataDir } from "../lib/paths";
import { getSetting } from "../lib/settings";
import { readLocalWorkerSettings } from "./local-settings";

export async function getWorkerConfig() {
  const local = readLocalWorkerSettings();
  const setting = async <T extends string | string[]>(key: keyof typeof local, fallback: T): Promise<T> =>
    (local[key] as T | undefined) ?? await getSetting<T>(key, fallback);
  return {
    mediaRoot: resolve(dataDir, "media"),
    ffmpegBin: await setting<string>("media.ffmpeg_bin", "ffmpeg"),
    ffprobeBin: await setting<string>("media.ffprobe_bin", "ffprobe"),
    ytdlpBin: await setting<string>("instagram.ytdlp_bin", "yt-dlp"),
    galleryDlBin: await setting<string>("instagram.gallery_dl_bin", "gallery-dl"),
    ytdlpCookiesFromBrowser: await setting<string>("instagram.cookies_from_browser", ""),
    ytdlpCookieFile: await setting<string>("instagram.cookie_file", ""),
    transcriptionProvider: await setting<string>("transcription.provider", "openai"),
    transcriptionModel: await setting<string>("transcription.model", "whisper-1"),
    localTranscriptionCommand: await setting<string[]>("transcription.local_command", []),
    openaiApiKey: await getSetting<string>("transcription.openai_api_key", ""),
    frameIntervalSeconds: await getSetting<number>("media.frame_interval_seconds", 5),
    maxContactSheetFrames: await getSetting<number>("media.max_contact_sheet_frames", 9),
  };
}
