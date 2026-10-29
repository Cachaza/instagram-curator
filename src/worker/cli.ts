import { runWorker } from "./pipeline";
import { processNextAnalysis } from "./analyze";
import { codexAppServer } from "../lib/codex/app-server";
import { pool, transaction } from "../lib/db";

if (process.env.CURATOR_WORKER_DISABLED === "1") {
  throw new Error("Processing is disabled on this host (CURATOR_WORKER_DISABLED=1). Run the worker on the server that owns the media storage; this host may run the transcription bridge only.");
}

async function recoverInterruptedWork(): Promise<void> {
  await transaction(async (tx) => {
    const interrupted = (await tx.all(`
      SELECT id,processing_status FROM publications
      WHERE processing_status IN ('downloading','extracting_media','transcribing','analyzing')
    `,[])) as Array<{ id: string; processing_status: string }>;
    for (const item of interrupted) {
      const next = item.processing_status === "analyzing" ? "ready_for_analysis" : "pending";
      (await tx.execute("UPDATE publications SET processing_status=$1,current_stage=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3",[next,next,item.id]));
      (await tx.execute("INSERT INTO pipeline_events(publication_id,stage,event_type,message) VALUES ($1,$2,$3,$4)",[item.id,next,"recovered",`Recovered interrupted ${item.processing_status} job`]));
    }
  });
}

// One processing host owns local media and the local transcription model.
// Hold a session lock before recovering jobs; another worker must not reset
// work still running on the Mac.
const ownership = await pool.connect();
const lock = await ownership.query("SELECT pg_try_advisory_lock(hashtextextended('curator-worker',0)) AS acquired");
if (!lock.rows[0].acquired) {
  ownership.release();
  await pool.end();
  throw new Error("Worker capacity is 1 active processing host; requested a second worker. Stop the existing worker before starting another.");
}
ownership.on("error", () => {
  console.error("Worker database ownership connection was lost. Restart the worker after restoring PostgreSQL connectivity; interrupted stages will be recovered.");
  process.exit(1);
});
await recoverInterruptedWork();

const args = process.argv.slice(2);
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Number.POSITIVE_INFINITY;
if (limitIndex >= 0 && (!Number.isInteger(limit) || limit < 1)) {
  throw new Error("--limit must be a positive integer");
}
const loop = args.includes("--loop") || Number.isFinite(limit);
if (args.includes("--watch")) {
  for (;;) {
    const mediaWorked = (await runWorker(false, 1)) > 0;
    const analysisWorked = await processNextAnalysis();
    if (!mediaWorked && !analysisWorked) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
} else {
  await runWorker(loop, loop ? limit : 1);
  if (!loop) await processNextAnalysis();
  codexAppServer.stop();
  await ownership.query("SELECT pg_advisory_unlock(hashtextextended('curator-worker',0))");
  ownership.release();
  await pool.end();
}
