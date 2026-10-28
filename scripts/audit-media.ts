import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { auditMediaFiles } from "../src/lib/media-audit";
import { dataDir } from "../src/lib/paths";
import { pool, authPool } from "../src/lib/db";

try {
  const report = await auditMediaFiles();
  const directory = join(dataDir, "diagnostics");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `media-audit-${randomUUID()}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ publications: report.publications, available: report.available, unavailable: report.unavailable.length, report: path }));
} finally { await pool.end(); await authPool.end(); }
