import { transaction } from "./db";

export async function retryPublication(id: string) {
  return transaction(async (tx) => {
    const row = await tx.one<{ processing_status: string; current_stage: string }>("SELECT processing_status,current_stage FROM publications WHERE id=$1 FOR UPDATE",[id]);
    if (!row) return {error:"not_found",status:404} as const;
    if (row.processing_status !== "failed") return {error:"not_failed",status:409} as const;
    const next = row.current_stage === "analyzing" ? "ready_for_analysis" : "pending";
    await tx.execute("UPDATE publications SET processing_status=$1,current_stage=$2,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$3",[next,next,id]);
    await tx.execute("INSERT INTO pipeline_events(publication_id,stage,event_type,message) VALUES ($1,$2,$3,$4)",[id,next,"retry","Manual retry requested"]);
    return {next};
  });
}
