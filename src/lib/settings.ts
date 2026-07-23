import { randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "./db";

type SettingRow = { value_json: string };

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare("SELECT value_json FROM app_settings WHERE key=?")
    .get(key) as SettingRow | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown, secret = false): void {
  db.prepare(`
    INSERT INTO app_settings(key,value_json,is_secret,updated_at)
    VALUES (?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value_json=excluded.value_json,
      is_secret=excluded.is_secret,
      updated_at=CURRENT_TIMESTAMP
  `).run(key, JSON.stringify(value), secret ? 1 : 0);
}

export function hasSetting(key: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM app_settings WHERE key=?").get(key));
}

export function isSetupComplete(): boolean {
  return getSetting("setup.complete", false);
}

export function createShareToken(): string {
  const token = `curator_${randomBytes(32).toString("base64url")}`;
  setSetting("api.share_token", token, true);
  return token;
}

export function verifyShareToken(candidate: string): boolean {
  const stored = getSetting<string>("api.share_token", "");
  if (!stored || stored.length !== candidate.length) return false;
  return timingSafeEqual(Buffer.from(stored), Buffer.from(candidate));
}
