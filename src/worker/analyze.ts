import { resolve } from "node:path";
import { db } from "@/lib/db";
import { dataDir } from "@/lib/paths";
import { getSetting } from "@/lib/settings";
import { codexAppServer } from "@/lib/codex/app-server";
import { codexAccountStatus } from "@/lib/codex/account";

type Publication = {
  id: string;
  source_url: string;
  author: string | null;
  caption: string | null;
  transcript_text: string | null;
  contact_sheet_path: string | null;
};

type Analysis = {
  category: string;
  subcategory: string | null;
  title: string;
  summary: string;
  visual_description: string;
  why_interesting: string | null;
  next_action: string | null;
  action_status: "inbox" | "action" | "someday" | "reference" | "done";
  tags: string[];
  entities: Record<string, unknown>;
  facets: Record<string, unknown>;
  confidence: number;
  needs_review: boolean;
  review_reason: string | null;
  codex_notes: string | null;
};
type WireAnalysis = Omit<Analysis, "entities" | "facets"> & {
  entities_json: string;
  facets_json: string;
};

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["category","subcategory","title","summary","visual_description","why_interesting","next_action","action_status","tags","entities_json","facets_json","confidence","needs_review","review_reason","codex_notes"],
  properties: {
    category: { type: "string", enum: ["restaurant","recipe","travel","technology","startup_idea","startup_advice","clothing","mountain_gear","fitness","home","entertainment","reference","unknown"] },
    subcategory: { type: ["string","null"] },
    title: { type: "string" },
    summary: { type: "string" },
    visual_description: { type: "string" },
    why_interesting: { type: ["string","null"] },
    next_action: { type: ["string","null"] },
    action_status: { type: "string", enum: ["inbox","action","someday","reference","done"] },
    tags: { type: "array", items: { type: "string" } },
    entities_json: { type: "string", description: "A JSON object encoded as a string. Use {} when no typed entities are evidenced." },
    facets_json: { type: "string", description: "A JSON object encoded as a string. Use {} when no filter facets are evidenced." },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    needs_review: { type: "boolean" },
    review_reason: { type: ["string","null"] },
    codex_notes: { type: ["string","null"] },
  },
};

function addEvent(id: string, stage: string, eventType: string, message?: string): void {
  db.prepare("INSERT INTO pipeline_events(publication_id,stage,event_type,message) VALUES (?,?,?,?)")
    .run(id, stage, eventType, message ?? null);
}

function claim(): Publication | null {
  return db.transaction(() => {
    const item = db.prepare(`
      SELECT id,source_url,author,caption,transcript_text,contact_sheet_path
      FROM publications WHERE processing_status='ready_for_analysis'
      ORDER BY updated_at LIMIT 1
    `).get() as Publication | undefined;
    if (!item) return null;
    db.prepare("UPDATE publications SET processing_status='analyzing',current_stage='analyzing',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(item.id);
    addEvent(item.id, "analyzing", "transition");
    return item;
  })();
}

function prompt(item: Publication, locale: string): string {
  return `Analyze this saved Instagram publication for a private knowledge library.
Return only the structured result requested by the output schema, in ${locale === "en" ? "English" : "Spanish"}. entities_json and facets_json must each contain one valid JSON object encoded as a string.
Use only the supplied caption, transcript and image. Never invent ratings, exact prices, addresses, ingredients, quantities or claims not supported by the source.
For restaurants capture mentioned_places and cuisine/budget facets only when evidenced.
For recipes capture dish_name, ingredients and steps, plus nutritionGoals (bulking, cutting, maintenance), foodStyles (gym, everyday, gourmet) only when evidenced.
For fitness capture goals, muscleGroups and trainingType only when evidenced.
Set needs_review when the source is ambiguous or incomplete.

Source URL: ${item.source_url}
Author: ${item.author ?? "unknown"}
Caption:
${item.caption ?? "(none)"}

Transcript:
${item.transcript_text ?? "(none)"}`;
}

export async function processNextAnalysis(): Promise<boolean> {
  const status = await codexAccountStatus().catch(() => ({ connected: false }));
  if (!status.connected) return false;
  const item = claim();
  if (!item) return false;
  try {
    const started = await codexAppServer.request<{ thread: { id: string } }>("thread/start", {
      cwd: dataDir,
      runtimeWorkspaceRoots: [dataDir],
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      baseInstructions: "You are a careful content curator. Do not run commands, edit files, browse the web, or use external facts. Analyze only the user-provided source material.",
    });
    const inputs: Array<Record<string, unknown>> = [
      { type: "text", text: prompt(item, getSetting("analysis.locale", "es")), text_elements: [] },
    ];
    if (item.contact_sheet_path) {
      inputs.push({ type: "localImage", path: resolve(dataDir, item.contact_sheet_path), detail: "high" });
    }
    let finalText = "";
    const stop = codexAppServer.onNotification((message) => {
      if (message.method !== "item/completed") return;
      const params = message.params as { threadId?: string; item?: { type?: string; text?: string } } | undefined;
      if (params?.threadId === started.thread.id && params.item?.type === "agentMessage") finalText = params.item.text ?? finalText;
    });
    const activeTurn: { id?: string } = {};
    const completion = codexAppServer.waitFor(
      "turn/completed",
      (params) => params.threadId === started.thread.id
        && (!activeTurn.id || (params.turn as { id?: string } | undefined)?.id === activeTurn.id),
      900_000,
    );
    const turn = await codexAppServer.request<{ turn: { id: string } }>("turn/start", {
      threadId: started.thread.id,
      input: inputs,
      outputSchema,
      effort: "medium",
    });
    activeTurn.id = turn.turn.id;
    const completed = await completion;
    stop();
    const turnState = completed.turn as { status?: string; error?: { message?: string } };
    if (turnState.status !== "completed") throw new Error(turnState.error?.message ?? `Codex turn ${turnState.status ?? "failed"}`);
    const wire = JSON.parse(finalText) as WireAnalysis;
    const analysis: Analysis = {
      ...wire,
      entities: JSON.parse(wire.entities_json) as Record<string, unknown>,
      facets: JSON.parse(wire.facets_json) as Record<string, unknown>,
    };
    const locale = getSetting("analysis.locale", "es");
    db.transaction(() => {
      db.prepare("INSERT INTO analysis_versions(publication_id,analysis_json,source) VALUES (?,?,?)")
        .run(item.id, JSON.stringify(analysis), "codex");
      db.prepare(`
        INSERT INTO analyses(
          publication_id,category,subcategory,title,summary,visual_description,
          why_interesting,next_action,ai_action_status,tags_json,entities_json,
          facets_json,confidence,needs_review,review_reason,codex_notes,prompt_version,output_locale
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(publication_id) DO UPDATE SET
          category=excluded.category,subcategory=excluded.subcategory,title=excluded.title,
          summary=excluded.summary,visual_description=excluded.visual_description,
          why_interesting=excluded.why_interesting,next_action=excluded.next_action,
          ai_action_status=excluded.ai_action_status,tags_json=excluded.tags_json,
          entities_json=excluded.entities_json,facets_json=excluded.facets_json,
          confidence=excluded.confidence,needs_review=excluded.needs_review,
          review_reason=excluded.review_reason,codex_notes=excluded.codex_notes,
          prompt_version=excluded.prompt_version,output_locale=excluded.output_locale,
          analyzed_at=CURRENT_TIMESTAMP
      `).run(
        item.id, analysis.category, analysis.subcategory, analysis.title, analysis.summary,
        analysis.visual_description, analysis.why_interesting, analysis.next_action,
        analysis.action_status, JSON.stringify(analysis.tags), JSON.stringify(analysis.entities),
        JSON.stringify(analysis.facets), analysis.confidence, analysis.needs_review ? 1 : 0,
        analysis.review_reason, analysis.codex_notes, "v3", locale,
      );
      db.prepare(`
        UPDATE publications SET processing_status='analyzed',current_stage='analyzed',
          action_status=?,review_status='unreviewed',last_error=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(analysis.action_status, item.id);
      addEvent(item.id, "analyzed", "transition", "Codex analysis completed");
    })();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(`
      UPDATE publications SET processing_status='failed',current_stage='analyzing',
        attempts=attempts+1,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(message.slice(0, 4_000), item.id);
    addEvent(item.id, "analyzing", "error", message.slice(0, 4_000));
    return true;
  }
}
