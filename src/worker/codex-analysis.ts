import { codexAppServer } from "@/lib/codex/app-server";
import { codexPreferences } from "@/lib/codex/preferences";
import { beginCodexUsage, finishCodexUsage, recordCodexCost, recordCodexTokens } from "@/lib/codex/usage";
import { dataDir } from "@/lib/paths";

type AnalysisServer = Pick<typeof codexAppServer, "request" | "onNotification" | "waitFor">;

export async function runCodexAnalysis(publicationId: string, input: Array<Record<string, unknown>>, outputSchema: unknown, server: AnalysisServer = codexAppServer): Promise<string> {
  const preferences = await codexPreferences();
  const started = await server.request<{ thread: { id: string }; model?: string }>("thread/start", {
    ...(preferences.model ? { model: preferences.model } : {}),
    cwd: dataDir,
    runtimeWorkspaceRoots: [dataDir],
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    baseInstructions: "You are a careful content curator. Do not run commands, edit files, browse the web, or use external facts. Analyze only the user-provided source material.",
  });
  const threadId = started.thread.id;
  await beginCodexUsage(threadId, publicationId, started.model ?? null, preferences.effort);
  let finalText = "";
  let succeeded = false;
  let usageWrites = Promise.resolve();
  const stop = server.onNotification((message) => {
    if (message.params?.threadId !== threadId) return;
    if (message.method === "thread/tokenUsage/updated") usageWrites = usageWrites.then(() => recordCodexTokens(message.params));
    // A rejected usage write is awaited and surfaced after notification cleanup.
    void usageWrites.catch(() => {});
    if (message.method === "item/completed") {
      const item = message.params.item as { type?: string; text?: string } | undefined;
      if (item?.type === "agentMessage") finalText = item.text ?? finalText;
    }
  });
  const controller = new AbortController();
  // Retain the existing worker's turn-completion timeout.
  const completion = server.waitFor("turn/completed", (params) => params.threadId === threadId, 900_000, controller.signal);
  // turn/start may fail before we await completion; keep that cancellation handled.
  void completion.catch(() => {});
  try {
    await server.request("turn/start", { threadId, input, outputSchema, effort: preferences.effort });
    const completed = await completion;
    const turn = completed.turn as { status?: string; error?: { message?: string } };
    if (turn.status !== "completed") throw new Error(turn.error?.message ?? `Codex turn ${turn.status ?? "failed"}`);
    succeeded = true;
    return finalText;
  } finally {
    controller.abort();
    stop();
    await usageWrites;
    await finishCodexUsage(threadId, succeeded ? "completed" : "failed");
    // The selected account may not support estimates; no inference is requested.
    await recordCodexCost(threadId, server);
  }
}
