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

export function beginCodexUsage(threadId: string, publicationId: string, model: string | null, effort: string): void {
  db.prepare("INSERT INTO codex_usage(thread_id,publication_id,model,reasoning_effort,started_at) VALUES (?,?,?,?,?)")
    .run(threadId, publicationId, model, effort, new Date().toISOString());
}

export function recordCodexTokens(params: unknown): void {
  const parsed = TokenEvent.safeParse(params);
  if (!parsed.success) return;
  const { threadId, turnId, tokenUsage: { total } } = parsed.data;
  // Each Curator analysis owns a fresh, single-turn thread. These are cumulative
  // thread snapshots, not deltas: repeated notifications must never be added.
  db.prepare(`UPDATE codex_usage SET turn_id=?,input_tokens=?,cached_input_tokens=?,output_tokens=?,reasoning_output_tokens=?,total_tokens=?
    WHERE thread_id=? AND (total_tokens IS NULL OR total_tokens<=?)`)
    .run(turnId, total.inputTokens, total.cachedInputTokens, total.outputTokens, total.reasoningOutputTokens, total.totalTokens, threadId, total.totalTokens);
}

export function finishCodexUsage(threadId: string, status: "completed" | "failed"): void {
  db.prepare("UPDATE codex_usage SET status=?,completed_at=? WHERE thread_id=?")
    .run(status, new Date().toISOString(), threadId);
}

export async function recordCodexCost(threadId: string, server: Pick<typeof codexAppServer, "request"> = codexAppServer): Promise<void> {
  // Optional in newer Codex versions. These are service estimates, not API prices
  // or an invoice; unsupported/missing values remain NULL, never a fabricated zero.
  try {
    const response = await server.request<{ threadUsage?: unknown }>("account/usage/read", { threadId });
    const parsed = z.object({ threadId: z.literal(threadId), estimatedUsageCreditsMicros: counter, estimatedUsageUsdMicros: counter.nullable() }).safeParse(response.threadUsage);
    if (parsed.success) db.prepare("UPDATE codex_usage SET estimated_credits_micros=?,estimated_usd_micros=? WHERE thread_id=?")
      .run(parsed.data.estimatedUsageCreditsMicros, parsed.data.estimatedUsageUsdMicros, threadId);
  } catch { /* Usage estimates are optional and must not fail a completed analysis. */ }
}

export type UsageGroup = {
  model: string | null; runs: number; measuredRuns: number; inputTokens: number | null;
  cachedInputTokens: number | null; outputTokens: number | null; reasoningOutputTokens: number | null;
  totalTokens: number | null; creditRuns: number; usdRuns: number; creditsMicros: number | null; usdMicros: number | null;
};

export function curatorUsage() {
  const columns = `COUNT(*) runs,COUNT(total_tokens) measuredRuns,SUM(input_tokens) inputTokens,
    SUM(cached_input_tokens) cachedInputTokens,SUM(output_tokens) outputTokens,
    SUM(reasoning_output_tokens) reasoningOutputTokens,SUM(total_tokens) totalTokens,
    COUNT(estimated_credits_micros) creditRuns,COUNT(estimated_usd_micros) usdRuns,
    SUM(estimated_credits_micros) creditsMicros,SUM(estimated_usd_micros) usdMicros`;
  const totals = db.prepare(`SELECT ${columns} FROM codex_usage`).get() as Omit<UsageGroup, "model">;
  const byModel = db.prepare(`SELECT model,${columns} FROM codex_usage GROUP BY model ORDER BY totalTokens DESC`).all() as UsageGroup[];
  const tracking = db.prepare("SELECT applied_at FROM schema_migrations WHERE version=4").get() as { applied_at: string };
  return { totals, byModel, trackingSince: tracking.applied_at };
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
