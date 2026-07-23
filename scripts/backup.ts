import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { db } from "../src/lib/db";
import { dataDir } from "../src/lib/paths";

const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const target = resolve(process.argv[2] ?? join(dataDir, "backups", stamp));
mkdirSync(target, { recursive: true, mode: 0o700 });
await db.backup(join(target, "curator.sqlite"));
const tar = spawnSync("tar", ["-czf", join(target, "media.tar.gz"), "-C", dataDir, "media"], { encoding: "utf8" });
if (tar.status !== 0) throw new Error(tar.stderr || "Could not archive media");
writeFileSync(join(target, "manifest.json"), JSON.stringify({
  format: 1,
  createdAt: new Date().toISOString(),
  database: "curator.sqlite",
  media: "media.tar.gz",
}, null, 2), { mode: 0o600 });
console.log(target);
