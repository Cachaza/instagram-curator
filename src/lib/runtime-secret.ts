import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { dataDir } from "./paths";

export function authSecret(): string {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;

  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, "auth-secret");
  if (!existsSync(path)) {
    writeFileSync(path, randomBytes(48).toString("base64url"), { mode: 0o600 });
  }
  chmodSync(path, 0o600);
  return readFileSync(path, "utf8").trim();
}
