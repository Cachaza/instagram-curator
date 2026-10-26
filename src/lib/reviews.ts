import { transaction } from "./db";
import { getContent, listContent } from "./content";

export type ReviewInput = {
  reviewStatus: "approved" | "corrected" | "discarded" | "unreviewed";
  actionStatus: "inbox" | "action" | "someday" | "reference" | "done";
  correctedCategory?: string | null;
  correctedAnalysis?: Record<string, unknown> | null;
  notes?: string | null;
  discardedReason?: string | null;
  userId: string;
};

export async function reviewQueue(filter = "unreviewed") {
  if (filter === "all") return listContent();
  if (filter === "needs_review") return (await listContent()).filter((item) => item.reviewStatus === "unreviewed" && item.needsReview);
  if (filter === "low_confidence") return (await listContent()).filter((item) => item.reviewStatus === "unreviewed" && item.confidence < .7);
  return listContent({ review: filter });
}

export async function saveReview(id: string, input: ReviewInput): Promise<void> {
  if (!await getContent(id)) throw new Error("analysis_not_found");
  const now = new Date().toISOString();
  await transaction(async (tx) => {
    if (!await tx.one("SELECT id FROM publications WHERE id=$1 FOR UPDATE",[id])) throw new Error("analysis_not_found");
    (await tx.execute(`
      INSERT INTO publication_reviews(
        publication_id,review_status,action_status,corrected_category,
        corrected_analysis_json,notes,discarded_reason,reviewed_by_user_id,
        reviewed_at,updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(publication_id) DO UPDATE SET
        review_status=excluded.review_status,action_status=excluded.action_status,
        corrected_category=excluded.corrected_category,
        corrected_analysis_json=excluded.corrected_analysis_json,
        notes=excluded.notes,discarded_reason=excluded.discarded_reason,
        reviewed_by_user_id=excluded.reviewed_by_user_id,
        reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at
    `,[id,input.reviewStatus,input.actionStatus,input.correctedCategory ?? null,input.correctedAnalysis ? JSON.stringify(input.correctedAnalysis) : null,input.notes ?? null,input.discardedReason ?? null,input.userId,now,now]));
    (await tx.execute("UPDATE publications SET review_status=$1,action_status=$2,updated_at=$3 WHERE id=$4",[input.reviewStatus,input.actionStatus,now,id]));
  });
}
