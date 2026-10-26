import { readFileSync } from "node:fs";

const machineSettingTypes = {
  "media.ffmpeg_bin": "string",
  "media.ffprobe_bin": "string",
  "instagram.ytdlp_bin": "string",
  "instagram.gallery_dl_bin": "string",
  "instagram.cookies_from_browser": "string",
  "instagram.cookie_file": "string",
  "transcription.local_command": "argv",
  "transcription.provider": "string",
  "transcription.model": "string",
} as const;

export type LocalWorkerSettings = Partial<Record<keyof typeof machineSettingTypes, string | string[]>>;

export function readLocalWorkerSettings(file = process.env.CURATOR_WORKER_CONFIG_FILE): LocalWorkerSettings {
  if (!file) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof SyntaxError ? "invalid JSON" :
      error && typeof error === "object" && "code" in error ? String(error.code) : "read failed";
    throw new Error(`Unable to read CURATOR_WORKER_CONFIG_FILE (${file}): ${reason}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`CURATOR_WORKER_CONFIG_FILE (${file}) must contain a JSON object`);
  }

  const values = parsed as Record<string, unknown>;
  for (const key of Object.keys(values)) {
    if (!Object.hasOwn(machineSettingTypes,key)) throw new Error(`CURATOR_WORKER_CONFIG_FILE (${file}) has an unknown setting; use only documented machine-specific setting names.`);
  }
  const local: LocalWorkerSettings = {};
  for (const [key, type] of Object.entries(machineSettingTypes) as [keyof typeof machineSettingTypes, typeof machineSettingTypes[keyof typeof machineSettingTypes]][]) {
    if (!Object.hasOwn(values,key)) continue;
    const value = values[key];
    const valid = type === "argv"
      ? Array.isArray(value) && value.length > 0 && value.every((arg) => typeof arg === "string" && arg.length > 0)
      : typeof value === "string";
    if (!valid) {
      throw new Error(`CURATOR_WORKER_CONFIG_FILE (${file}) has invalid ${key}; expected ${type === "argv" ? "a non-empty array of non-empty strings" : "a string"}`);
    }
    (local as Record<string, string | string[]>)[key] = value as string | string[];
  }
  return local;
}
