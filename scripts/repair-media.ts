import { authPool, pool } from "../src/lib/db";
import { repairMissingPreviews } from "../src/worker/media-repair";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const idIndex = args.indexOf("--id");
const id = idIndex < 0 ? undefined : args[idIndex + 1];
if (args.some((arg) => arg !== "--apply" && arg !== "--id" && arg !== id) || (idIndex >= 0 && (!id || id.startsWith("--")))) {
  throw new Error("Usage: bun run repair:media [--apply] [--id PUBLICATION_ID]");
}
if (apply && process.env.CURATOR_WORKER_DISABLED === "1") {
  throw new Error("Media writes are disabled on this host (CURATOR_WORKER_DISABLED=1). Run repair:media on the server that owns the media storage.");
}
let owner;
try {
  if (apply) {
    owner = await pool.connect();
    const lock = await owner.query("SELECT pg_try_advisory_lock(hashtextextended('curator-worker',0)) AS acquired");
    if (!lock.rows[0].acquired) throw new Error("Media repair capacity is 1 processing host; requested another. Stop the worker, then retry.");
    owner.on("error", () => { console.error("Media repair lost worker ownership; restore PostgreSQL connectivity before retrying."); process.exit(1); });
  }
  const result = await repairMissingPreviews({ apply, id });
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result }, null, 2));
  if (result.failed) process.exitCode = 1;
} finally {
  if (owner) {
    try { await owner.query("SELECT pg_advisory_unlock(hashtextextended('curator-worker',0))"); } finally { owner.release(); }
  }
  await Promise.all([pool.end(), authPool.end()]);
}
