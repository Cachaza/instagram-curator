import Sqlite from "better-sqlite3";
import { chmodSync, cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { migrateAppDatabase, pool } from "../src/lib/db";
import { importSqliteLibrary } from "../src/lib/postgres-import";
import { dataDir } from "../src/lib/paths";

const sourceIndex = process.argv.indexOf("--sqlite");
const sourcePath = sourceIndex >= 0 && process.argv[sourceIndex + 1] ? resolve(process.argv[sourceIndex + 1]) : null;
if (!sourcePath || !process.argv.includes("--confirm")) {
  throw new Error("Usage: bun run migrate:postgres -- --sqlite /private/curator.sqlite --confirm. Stop all writers first. DATABASE_URL must name a new empty PostgreSQL database.");
}
const stamp = new Date().toISOString().replaceAll(":","-").replaceAll(".","-");
const backup = join(dataDir,"backups",`before-postgresql-${stamp}`);
mkdirSync(backup,{recursive:true,mode:0o700});
chmodSync(backup,0o700);
const live = new Sqlite(sourcePath,{readonly:true,fileMustExist:true});
try {
  await live.backup(join(backup,"curator.sqlite"));
  for (const name of ["auth-secret","codex","secrets"]) {
    const path = join(dirname(sourcePath),name);
    if (existsSync(path)) cpSync(path,join(backup,name),{recursive:true,preserveTimestamps:true});
  }
} finally { live.close(); }
const snapshot = new Sqlite(join(backup,"curator.sqlite"),{readonly:true,fileMustExist:true});
try {
  await migrateAppDatabase();
  const report = await importSqliteLibrary(snapshot);
  writeFileSync(join(backup,"migration-report.json"),JSON.stringify({createdAt:new Date().toISOString(),...report},null,2),{mode:0o600});
  console.log(JSON.stringify({backup,...report},null,2));
} finally {
  snapshot.close();
  await pool.end();
}
