import { resolve } from "node:path";
import { dataDir } from "../lib/paths";
import { getSetting } from "../lib/settings";

export function getWorkerConfig() {
  return {
    mediaRoot: resolve(dataDir, "media"),
    ffmpegBin: getSetting<string>("media.ffmpeg_bin", "ffmpeg"),
    ffprobeBin: getSetting<string>("media.ffprobe_bin", "ffprobe"),
    ytdlpBin: getSetting<string>("instagram.ytdlp_bin", "yt-dlp"),
    galleryDlBin: getSetting<string>("instagram.gallery_dl_bin", "gallery-dl"),
    ytdlpCookiesFromBrowser: getSetting<string>("instagram.cookies_from_browser", ""),
    ytdlpCookieFile: getSetting<string>("instagram.cookie_file", ""),
    transcriptionProvider: getSetting<string>("transcription.provider", "openai"),
    transcriptionModel: getSetting<string>("transcription.model", "whisper-1"),
    openaiApiKey: getSetting<string>("transcription.openai_api_key", ""),
    frameIntervalSeconds: getSetting<number>("media.frame_interval_seconds", 5),
    maxContactSheetFrames: getSetting<number>("media.max_contact_sheet_frames", 9),
  };
}
