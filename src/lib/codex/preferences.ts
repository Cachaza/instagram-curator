import { z } from "zod";
import { db } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { codexAppServer } from "./app-server";

export type CodexModel = {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
};

export const PreferencesSchema = z.object({
  model: z.string().trim().min(1).nullable(),
  effort: z.string().trim().min(1),
}).strict();
export type CodexPreferences = z.infer<typeof PreferencesSchema>;

export function codexPreferences(): CodexPreferences {
  // Preserve the existing worker's medium effort until the user chooses another.
  return { model: getSetting<string | null>("analysis.codex_model", null), effort: getSetting("analysis.codex_effort", "medium") };
}

export async function listCodexModels(): Promise<CodexModel[]> {
  const models: CodexModel[] = [];
  let cursor: string | null = null;
  do {
    const page: { data: CodexModel[]; nextCursor: string | null } = await codexAppServer.request("model/list", { includeHidden: false, cursor });
    models.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor);
  return models;
}

export async function configuredCodexModel(): Promise<string | null> {
  const response = await codexAppServer.request<{ config: { model?: string | null } }>("config/read", { includeLayers: false });
  // Never return the complete config: it may contain credentials or instructions.
  return response.config.model ?? null;
}

export function validCodexPreferences(preferences: CodexPreferences, models: CodexModel[], effectiveDefault: string | null): boolean {
  const model = models.find((candidate) => candidate.model === (preferences.model ?? effectiveDefault));
  return Boolean(model?.supportedReasoningEfforts.some((option) => option.reasoningEffort === preferences.effort));
}

export function saveCodexPreferences(preferences: CodexPreferences): void {
  db.transaction(() => {
    setSetting("analysis.codex_model", preferences.model);
    setSetting("analysis.codex_effort", preferences.effort);
  })();
}
