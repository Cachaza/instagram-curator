import Database from "better-sqlite3";
import { existsSync, mkdirSync, renameSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { dataDir, databasePath } from "../src/lib/paths";

const source = process.argv[2] ? resolve(process.argv[2]) : "";
if (!source || !process.argv.includes("--confirm")) {
  throw new Error("Usage: bun run restore -- /path/to/backup --confirm (stop Curator first)");
}
const sourceDb = join(source, "curator.sqlite");
const mediaArchive = join(source, "media.tar.gz");
if (!existsSync(sourceDb) || !existsSync(mediaArchive)) throw new Error("Invalid backup directory");
const probe = new Database(sourceDb, { readonly: true });
const integrity = probe.pragma("integrity_check", { simple: true });
probe.close();
if (integrity !== "ok") throw new Error(`Backup database integrity check failed: ${integrity}`);

mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
if (existsSync(databasePath)) renameSync(databasePath, `${databasePath}.before-restore-${stamp}`);
copyFileSync(sourceDb, databasePath);
const currentMedia = join(dataDir, "media");
if (existsSync(currentMedia)) renameSync(currentMedia, join(dataDir, `media.before-restore-${stamp}`));
const tar = spawnSync("tar", ["-xzf", mediaArchive, "-C", dataDir], { encoding: "utf8" });
if (tar.status !== 0) throw new Error(tar.stderr || "Could not restore media archive");
console.log(`Restored ${source}. Previous data remains beside it with suffix before-restore-${stamp}.`);
