import { runWorker } from "./pipeline";
import { processNextAnalysis } from "./analyze";
import { codexAppServer } from "../lib/codex/app-server";
import { db } from "../lib/db";

function recoverInterruptedWork(): void {
  db.transaction(() => {
    const interrupted = db.prepare(`
      SELECT id,processing_status FROM publications
      WHERE processing_status IN ('downloading','extracting_media','transcribing','analyzing')
    `).all() as Array<{ id: string; processing_status: string }>;
    for (const item of interrupted) {
      const next = item.processing_status === "analyzing" ? "ready_for_analysis" : "pending";
      db.prepare("UPDATE publications SET processing_status=?,current_stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(next, next, item.id);
      db.prepare("INSERT INTO pipeline_events(publication_id,stage,event_type,message) VALUES (?,?,?,?)")
        .run(item.id, next, "recovered", `Recovered interrupted ${item.processing_status} job`);
    }
  })();
}

recoverInterruptedWork();

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
}
