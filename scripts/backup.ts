import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pool, transaction } from "../src/lib/db";
import { libraryTables } from "../src/lib/postgres-import";
import { dataDir } from "../src/lib/paths";

const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const target = resolve(process.argv[2] ?? join(dataDir, "backups", stamp));
mkdirSync(target, { recursive: true, mode: 0o700 });
try {
  const tables = await transaction(async (tx) => {
    await tx.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const rows: Record<string, unknown[]> = {};
    for (const table of [...libraryTables,"schema_migrations"]) rows[table] = await tx.all(`SELECT * FROM "${table}"`);
    return rows;
  });
  const json = JSON.stringify({format:2,tables});
  writeFileSync(join(target,"library.json"),json,{mode:0o600});
  const files = ["media","auth-secret","codex","secrets"].filter((name) => existsSync(join(dataDir,name)));
  if (!files.includes("media")) mkdirSync(join(dataDir,"media"),{recursive:true});
  if (!files.includes("media")) files.push("media");
  const tar = spawnSync("tar",["-czf",join(target,"private-files.tar.gz"),"-C",dataDir,...files],{encoding:"utf8"});
  if (tar.status !== 0) throw new Error(tar.stderr || "Could not archive private files");
  writeFileSync(join(target,"manifest.json"),JSON.stringify({format:2,createdAt:new Date().toISOString(),database:"library.json",sha256:createHash("sha256").update(json).digest("hex"),files:"private-files.tar.gz"},null,2),{mode:0o600});
  console.log(target);
} finally { await pool.end(); }
