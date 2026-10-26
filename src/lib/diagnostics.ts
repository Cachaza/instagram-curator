import { accessSync, constants, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { dataDir } from "./paths";
import { db } from "./db";
import { getSetting } from "./settings";
import { codexAccountStatus } from "./codex/account";
import { dictionary } from "./i18n";

export type Diagnostic = { id: string; label: string; ok: boolean; detail: string; external?: boolean };

function binary(id: string, label: string, command: string, args = ["--version"]): Diagnostic {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 8_000 });
  const detail = (result.stdout || result.stderr || result.error?.message || "No disponible").trim().split("\n")[0]!;
  return { id, label, ok: result.status === 0, detail };
}

export async function systemDiagnostics(): Promise<Diagnostic[]> {
  const t = await dictionary();
  const webOnly = process.env.CURATOR_WEB_ONLY === "1";
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  let storage = true;
  try { accessSync(dataDir, constants.R_OK | constants.W_OK); } catch { storage = false; }
  const codexBinary = binary("codex_binary", "Codex CLI", process.env.CODEX_BIN ?? "codex");
  let codexAccount: Diagnostic = { id: "codex_account", label: t.diagnostics.codex, ok: false, detail: t.diagnostics.disconnected };
  if (codexBinary.ok) {
    try {
      const status = await codexAccountStatus();
      codexAccount = { ...codexAccount, ok: status.connected, detail: status.connected ? t.diagnostics.connected : t.diagnostics.disconnected };
    } catch (error) {
      codexAccount.detail = error instanceof Error ? error.message : String(error);
    }
  }
  let database = false;
  try { database = Boolean(await db.one("SELECT 1 AS connected")); } catch { /* Never expose a connection URL or password in diagnostics. */ }
  return [
    { id: "postgresql", label: "PostgreSQL", ok: database, detail: database ? "Connected" : "Check DATABASE_URL and private network access" },
    { id: "storage", label: t.diagnostics.storage, ok: storage, detail: storage ? join(dataDir, "media") : t.diagnostics.noWrite },
    binary("ffmpeg", "FFmpeg", await getSetting("media.ffmpeg_bin", "ffmpeg"), ["-version"]),
    binary("ffprobe", "FFprobe", await getSetting("media.ffprobe_bin", "ffprobe"), ["-version"]),
    ...webOnly ? [] : [
      binary("ytdlp", "yt-dlp", await getSetting("instagram.ytdlp_bin", "yt-dlp")),
      binary("gallerydl", "gallery-dl", await getSetting("instagram.gallery_dl_bin", "gallery-dl")),
    ],
    { id: "instagram", label: t.diagnostics.instagram, ok: !webOnly && Boolean(await getSetting("instagram.cookies_from_browser", "") || await getSetting("instagram.cookie_file", "") || await getSetting("instagram.instaloader_session_file", "")), detail: webOnly ? t.runtime.externalCheck : t.diagnostics.instagramHelp, external: webOnly },
    await transcriptionDiagnostic(webOnly),
    codexBinary,
    codexAccount,
  ];
}

export async function transcriptionDiagnostic(webOnly = process.env.CURATOR_WEB_ONLY === "1"): Promise<Diagnostic> {
  const t = await dictionary();
  const provider = await getSetting<string>("transcription.provider", "openai");
  const label = provider === "local" ? t.diagnostics.local : t.diagnostics.openai;
  if (webOnly) return { id: "transcription", label, ok: false, external: true, detail: t.runtime.externalCheck };
  if (provider === "local") {
    const command = await getSetting<unknown>("transcription.local_command", []);
    if (!Array.isArray(command) || !command.length || !command.every((arg) => typeof arg === "string") || !command[0]) {
      return { id: "transcription", label, ok: false, detail: t.diagnostics.noLocalCommand };
    }
    return binary("transcription", label, command[0]);
  }
  if (provider !== "openai") return { id: "transcription", label, ok: false, detail: `${t.diagnostics.unsupportedProvider}: ${provider}` };
  const configured = Boolean(await getSetting("transcription.openai_api_key", ""));
  return { id: "transcription", label, ok: configured, detail: configured ? `${t.diagnostics.model} ${await getSetting("transcription.model", "whisper-1")}` : t.diagnostics.noApiKey };
}
