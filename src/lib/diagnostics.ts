import { accessSync, constants, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { dataDir, databasePath } from "./paths";
import { getSetting } from "./settings";
import { codexAccountStatus } from "./codex/account";

export type Diagnostic = { id: string; label: string; ok: boolean; detail: string };

function binary(id: string, label: string, command: string, args = ["--version"]): Diagnostic {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 8_000 });
  const detail = (result.stdout || result.stderr || result.error?.message || "No disponible").trim().split("\n")[0]!;
  return { id, label, ok: result.status === 0, detail };
}

export async function systemDiagnostics(): Promise<Diagnostic[]> {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  let storage = true;
  try { accessSync(dataDir, constants.R_OK | constants.W_OK); } catch { storage = false; }
  const codexBinary = binary("codex_binary", "Codex CLI", process.env.CODEX_BIN ?? "codex");
  let codexAccount: Diagnostic = { id: "codex_account", label: "Cuenta de Codex", ok: false, detail: "No conectada" };
  if (codexBinary.ok) {
    try {
      const status = await codexAccountStatus();
      codexAccount = { ...codexAccount, ok: status.connected, detail: status.connected ? "Conectada" : "Pendiente de autorización" };
    } catch (error) {
      codexAccount.detail = error instanceof Error ? error.message : String(error);
    }
  }
  return [
    { id: "sqlite", label: "SQLite", ok: true, detail: databasePath },
    { id: "storage", label: "Almacenamiento", ok: storage, detail: storage ? join(dataDir, "media") : "Sin permisos de escritura" },
    binary("ffmpeg", "FFmpeg", getSetting("media.ffmpeg_bin", "ffmpeg"), ["-version"]),
    binary("ffprobe", "FFprobe", getSetting("media.ffprobe_bin", "ffprobe"), ["-version"]),
    binary("ytdlp", "yt-dlp", getSetting("instagram.ytdlp_bin", "yt-dlp")),
    binary("gallerydl", "gallery-dl", getSetting("instagram.gallery_dl_bin", "gallery-dl")),
    { id: "instagram", label: "Sesión de Instagram", ok: Boolean(getSetting("instagram.cookies_from_browser", "") || getSetting("instagram.cookie_file", "") || getSetting("instagram.instaloader_session_file", "")), detail: "Configúrala y valida un reel desde Instagram" },
    { id: "openai", label: "Transcripción OpenAI", ok: Boolean(getSetting("transcription.openai_api_key", "")), detail: getSetting("transcription.openai_api_key", "") ? `Modelo ${getSetting("transcription.model", "whisper-1")}` : "Falta la API key" },
    codexBinary,
    codexAccount,
  ];
}
