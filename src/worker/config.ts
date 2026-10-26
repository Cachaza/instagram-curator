import { resolve } from "node:path";
import { dataDir } from "../lib/paths";
import { getSetting } from "../lib/settings";

export async function getWorkerConfig() {
  return {
    mediaRoot: resolve(dataDir, "media"),
    ffmpegBin: await getSetting<string>("media.ffmpeg_bin", "ffmpeg"),
    ffprobeBin: await getSetting<string>("media.ffprobe_bin", "ffprobe"),
    ytdlpBin: await getSetting<string>("instagram.ytdlp_bin", "yt-dlp"),
    galleryDlBin: await getSetting<string>("instagram.gallery_dl_bin", "gallery-dl"),
    ytdlpCookiesFromBrowser: await getSetting<string>("instagram.cookies_from_browser", ""),
    ytdlpCookieFile: await getSetting<string>("instagram.cookie_file", ""),
    transcriptionProvider: await getSetting<string>("transcription.provider", "openai"),
    transcriptionModel: await getSetting<string>("transcription.model", "whisper-1"),
    localTranscriptionCommand: await getSetting<string[]>("transcription.local_command", []),
    openaiApiKey: await getSetting<string>("transcription.openai_api_key", ""),
    frameIntervalSeconds: await getSetting<number>("media.frame_interval_seconds", 5),
    maxContactSheetFrames: await getSetting<number>("media.max_contact_sheet_frames", 9),
  };
}
