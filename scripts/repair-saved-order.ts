import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { transaction, pool, authPool } from "../src/lib/db";
import { dataDir } from "../src/lib/paths";
import { savedOrderPlan, savedSnapshotShortcodes, type SavedOrderRow } from "../src/lib/saved-order";

const args = process.argv.slice(2);
const snapshotIndex = args.indexOf("--snapshot");
if (snapshotIndex < 0 || !args[snapshotIndex + 1] || args[snapshotIndex + 1].startsWith("--")) {
  throw new Error("Usage: bun run scripts/repair-saved-order.ts --snapshot /private/saved-list.jsonl [--apply]");
}
const snapshotPath = resolve(args[snapshotIndex + 1]);
const snapshot = readFileSync(snapshotPath, "utf8");
const shortcodes = savedSnapshotShortcodes(snapshot);
const apply = args.includes("--apply");
try {
  const summary = await transaction(async (tx) => {
    const rows = await tx.all<SavedOrderRow>("SELECT id,shortcode,saved_order FROM publications ORDER BY id FOR UPDATE");
    const plan = savedOrderPlan(rows, shortcodes);
    const matched = plan.filter((entry) => entry.after !== null).length;
    if (!matched) throw new Error("Snapshot matches no library publications. No changes applied.");
    const changes = plan.filter((entry) => entry.before !== entry.after);
    let backupPath: string | null = null;
    if (apply && changes.length) {
      backupPath = join(dataDir, "backups", `saved-order-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.json`);
      mkdirSync(dirname(backupPath), { recursive: true, mode: 0o700 });
      // A backup failure aborts the transaction before the first update.
      writeFileSync(backupPath, JSON.stringify({ snapshotPath, snapshotSha256: createHash("sha256").update(snapshot).digest("hex"), changes }, null, 2), { mode: 0o600, flag: "wx" });
      for (const change of changes) await tx.execute("UPDATE publications SET saved_order=$1 WHERE id=$2", [change.after, change.id]);
    }
    return { applied: apply, snapshotEntries: shortcodes.length, matched, unknown: plan.length - matched, changed: changes.length, backupPath };
  });
  console.log(JSON.stringify(summary));
} finally { await pool.end(); await authPool.end(); }
