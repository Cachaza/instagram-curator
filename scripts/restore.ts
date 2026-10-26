import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dataDir } from "../src/lib/paths";
import { migrateAppDatabase, pool } from "../src/lib/db";
import { importLibraryRows, libraryTables, restaurantMapTables } from "../src/lib/postgres-import";

const source = process.argv[2] ? resolve(process.argv[2]) : "";
if (!source || !process.argv.includes("--confirm")) throw new Error("Usage: bun run restore -- /private/backup --confirm. Stop Curator writers and configure a new empty PostgreSQL target first.");
const manifest = JSON.parse(readFileSync(join(source,"manifest.json"),"utf8"));
if (manifest.format !== 2) throw new Error("This is a legacy SQLite backup. Use migrate:postgres -- --sqlite <backup>/curator.sqlite --confirm, and restore its private media separately.");
const json = readFileSync(join(source,"library.json"),"utf8");
if (createHash("sha256").update(json).digest("hex") !== manifest.sha256) throw new Error("Backup checksum mismatch; use an intact backup.");
const archive = join(source,"private-files.tar.gz");
const listing = spawnSync("tar",["-tzf",archive],{encoding:"utf8"});
if (listing.status !== 0) throw new Error("Private-file archive is invalid; database has not been changed.");
const data = JSON.parse(json);
if (data.format !== 2) throw new Error("Unsupported library backup format");
// Migration 6 introduced map tables. Backups taken before that migration are
// valid without them; upgraded backups must include all map data explicitly.
const predatesRestaurantMap = Array.isArray(data.tables?.schema_migrations)
  && !data.tables.schema_migrations.some((row: { version: number }) => row.version >= 6);
for (const table of [...libraryTables,"schema_migrations"]) {
  if (predatesRestaurantMap && restaurantMapTables.includes(table as typeof restaurantMapTables[number]) && !(table in data.tables)) data.tables[table] = [];
  if (!Array.isArray(data.tables?.[table])) throw new Error(`Backup is missing table ${table}; restore refused.`);
}
try {
  await migrateAppDatabase();
  await importLibraryRows(data.tables);
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  const stamp = new Date().toISOString().replaceAll(":","-").replaceAll(".","-");
  for (const name of ["media","auth-secret","codex","secrets"]) {
    const path = join(dataDir,name);
    if (existsSync(path)) renameSync(path,`${path}.before-restore-${stamp}`);
  }
  const tar = spawnSync("tar",["-xzf",archive,"-C",dataDir],{encoding:"utf8"});
  if (tar.status !== 0) throw new Error(tar.stderr || "Database restored; private-file extraction failed. Retain the previous files and retry extraction from the backup.");
  console.log(`Restored ${source}; previous private files retained with suffix before-restore-${stamp}.`);
} finally { await pool.end(); }
