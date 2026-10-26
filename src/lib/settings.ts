import { randomBytes, timingSafeEqual } from "node:crypto";
import { db, type Database } from "./db";

type SettingRow = { value_json: string };

export async function getSetting<T>(key: string, fallback: T, store: Database = db): Promise<T> {
  const row = (await store.one("SELECT value_json FROM app_settings WHERE key=$1",[key])) as SettingRow | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: unknown, secret = false, store: Database = db): Promise<void> {
  (await store.execute(`
    INSERT INTO app_settings(key,value_json,is_secret,updated_at)
    VALUES ($1,$2,$3,CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value_json=excluded.value_json,
      is_secret=excluded.is_secret,
      updated_at=CURRENT_TIMESTAMP
  `,[key,JSON.stringify(value),secret ? 1 : 0]));
}

export async function hasSetting(key: string): Promise<boolean> {
  return Boolean((await db.one("SELECT 1 FROM app_settings WHERE key=$1",[key])));
}

export async function isSetupComplete(): Promise<boolean> {
  return getSetting("setup.complete", false);
}

export async function createShareToken(): Promise<string> {
  const token = `curator_${randomBytes(32).toString("base64url")}`;
  await setSetting("api.share_token", token, true);
  return token;
}

export async function verifyShareToken(candidate: string): Promise<boolean> {
  const stored = await getSetting<string>("api.share_token", "");
  if (!stored || stored.length !== candidate.length) return false;
  return timingSafeEqual(Buffer.from(stored), Buffer.from(candidate));
}
