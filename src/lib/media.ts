import { resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { dataDir } from "./paths";

export function resolveMediaPath(storedPath: string | null): string | null {
  if (!storedPath) return null;
  const root = resolve(dataDir);
  const path = resolve(root, storedPath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) return null;
  return existsSync(path) ? path : null;
}
