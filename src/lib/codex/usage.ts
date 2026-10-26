import { z } from "zod";
import { db } from "@/lib/db";
import { codexAppServer } from "./app-server";

const counter = z.number().int().nonnegative().safe();
const TokenEvent = z.object({
  threadId: z.string(), turnId: z.string(),
  tokenUsage: z.object({ total: z.object({
    inputTokens: counter, cachedInputTokens: counter, outputTokens: counter,
    reasoningOutputTokens: counter, totalTokens: counter,
  }) }),
});

export async function beginCodexUsage(threadId: string, publicationId: string, model: string | null, effort: string): Promise<void> {
  (await db.execute("INSERT INTO codex_usage(thread_id,publication_id,model,reasoning_effort,started_at) VALUES ($1,$2,$3,$4,$5)",[threadId,publicationId,model,effort,new Date().toISOString()]));
}

export async function recordCodexTokens(params: unknown): Promise<void> {
  const parsed = TokenEvent.safeParse(params);
  if (!parsed.success) return;
  const { threadId, turnId, tokenUsage: { total } } = parsed.data;
  // Each Curator analysis owns a fresh, single-turn thread. These are cumulative
  // thread snapshots, not deltas: repeated notifications must never be added.
  (await db.execute(`UPDATE codex_usage SET turn_id=$1,input_tokens=$2,cached_input_tokens=$3,output_tokens=$4,reasoning_output_tokens=$5,total_tokens=$6
    WHERE thread_id=$7 AND (total_tokens IS NULL OR total_tokens<=$8)`,[turnId,total.inputTokens,total.cachedInputTokens,total.outputTokens,total.reasoningOutputTokens,total.totalTokens,threadId,total.totalTokens]));
}

export async function finishCodexUsage(threadId: string, status: "completed" | "failed"): Promise<void> {
  (await db.execute("UPDATE codex_usage SET status=$1,completed_at=$2 WHERE thread_id=$3",[status,new Date().toISOString(),threadId]));
}

export async function recordCodexCost(threadId: string, server: Pick<typeof codexAppServer, "request"> = codexAppServer): Promise<void> {
  // Optional in newer Codex versions. These are service estimates, not API prices
  // or an invoice; unsupported/missing values remain NULL, never a fabricated zero.
  try {
    const response = await server.request<{ threadUsage?: unknown }>("account/usage/read", { threadId });
    const parsed = z.object({ threadId: z.literal(threadId), estimatedUsageCreditsMicros: counter, estimatedUsageUsdMicros: counter.nullable() }).safeParse(response.threadUsage);
    if (parsed.success) (await db.execute("UPDATE codex_usage SET estimated_credits_micros=$1,estimated_usd_micros=$2 WHERE thread_id=$3",[parsed.data.estimatedUsageCreditsMicros,parsed.data.estimatedUsageUsdMicros,threadId]));
  } catch { /* Usage estimates are optional and must not fail a completed analysis. */ }
}

export type UsageGroup = {
  model: string | null; runs: number; measuredRuns: number; inputTokens: number | null;
  cachedInputTokens: number | null; outputTokens: number | null; reasoningOutputTokens: number | null;
  totalTokens: number | null; creditRuns: number; usdRuns: number; creditsMicros: number | null; usdMicros: number | null;
};

export async function curatorUsage() {
  const columns = `COUNT(*)::int runs,COUNT(total_tokens)::int "measuredRuns",SUM(input_tokens)::bigint "inputTokens",
    SUM(cached_input_tokens)::bigint "cachedInputTokens",SUM(output_tokens)::bigint "outputTokens",
    SUM(reasoning_output_tokens)::bigint "reasoningOutputTokens",SUM(total_tokens)::bigint "totalTokens",
    COUNT(estimated_credits_micros)::int "creditRuns",COUNT(estimated_usd_micros)::int "usdRuns",
    SUM(estimated_credits_micros)::bigint "creditsMicros",SUM(estimated_usd_micros)::bigint "usdMicros"`;
  const totals = (await db.one(`SELECT ${columns} FROM codex_usage`,[])) as Omit<UsageGroup, "model">;
  const byModel = (await db.all(`SELECT model,${columns} FROM codex_usage GROUP BY model ORDER BY "totalTokens" DESC`,[])) as UsageGroup[];
  const tracking = (await db.one("SELECT applied_at FROM schema_migrations WHERE version=5",[])) as { applied_at: string };
  return { totals, byModel, trackingSince: tracking!.applied_at };
}

export type RateWindow = { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null };
export type RateBucket = { limitId?: string | null; limitName?: string | null; primary?: RateWindow | null; secondary?: RateWindow | null; credits?: { balance: string | null; unlimited: boolean } | null };

export async function subscriptionLimits(): Promise<RateBucket[]> {
  const response = await codexAppServer.request<{ rateLimits: RateBucket; rateLimitsByLimitId?: Record<string, RateBucket> | null }>("account/rateLimits/read");
  const buckets = response.rateLimitsByLimitId ? Object.values(response.rateLimitsByLimitId) : [response.rateLimits];
  // Explicit projection keeps account identifiers and unrelated billing metadata private.
  return buckets.map(({ limitId, limitName, primary, secondary, credits }) => ({ limitId, limitName, primary, secondary, credits: credits ? { balance: credits.balance, unlimited: credits.unlimited } : null }));
}

export async function accountTokenTotal(): Promise<number | null> {
  const response = await codexAppServer.request<{ summary?: { lifetimeTokens?: number | null } }>("account/usage/read");
  return counter.nullable().parse(response.summary?.lifetimeTokens ?? null);
}
