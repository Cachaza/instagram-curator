import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { db, transaction, type Database } from "@/lib/db";
import { dataDir } from "@/lib/paths";
import { getSetting } from "@/lib/settings";
import { codexAccountStatus } from "@/lib/codex/account";
import { normalizeFacets } from "@/lib/facets";
import { runCodexAnalysis } from "./codex-analysis";
import { getContent } from "@/lib/content";
import { reconfirmChangedRestaurantLocations } from "@/lib/restaurant-locations";

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

async function addEvent(id: string, stage: string, eventType: string, message?: string, store: Database = db): Promise<void> {
  (await store.execute("INSERT INTO pipeline_events(publication_id,stage,event_type,message) VALUES ($1,$2,$3,$4)",[id,stage,eventType,message ?? null]));
}

async function claim(): Promise<Publication | null> {
  return transaction(async (tx) => {
    const item = (await tx.one(`
      SELECT id,source_url,author,caption,transcript_text,contact_sheet_path
      FROM publications WHERE processing_status='ready_for_analysis'
      ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED
    `,[])) as Publication | undefined;
    if (!item) return null;
    (await tx.execute("UPDATE publications SET processing_status='analyzing',current_stage='analyzing',updated_at=CURRENT_TIMESTAMP WHERE id=$1",[item.id]));
    await addEvent(item.id, "analyzing", "transition", undefined, tx);
    return item;
  });
}

function prompt(item: Publication, locale: string): string {
  return `Analyze this saved Instagram publication for a private knowledge library.
Return only the structured result requested by the output schema, in ${locale === "en" ? "English" : "Spanish"}. entities_json and facets_json must each contain one valid JSON object encoded as a string.
Use only the supplied caption, transcript and image. Never invent ratings, exact prices, addresses, ingredients, quantities or claims not supported by the source.
For restaurants capture entities.mentioned_places as an array of {"name":"restaurant name","location_hint":"address, city or area explicitly stated, or null"}. Include every named restaurant; never infer a city or coordinates. Capture restaurant facets only when evidenced. Use this exact facet shape:
{"restaurant":{"cuisine":[],"budget":null,"occasion":[],"features":[]}}
For recipes capture dish_name, ingredients and steps. Use this exact entities shape:
{"dish_name":"dish name or null","ingredients":[{"name":"ingredient as stated","quantity":null,"unit":null,"optional":false}],"steps":[{"position":1,"instruction":"one preparation step"}]}
Include every ingredient, quantity and preparation step explicitly supported by the caption, transcript or image. Read written recipe lists in the caption and image as well as the spoken audio. Keep quantities and units as stated; use null when absent. Never fill gaps with a plausible recipe or infer missing cooking times. Do not return ingredients or steps as plain strings or nested section/item groups. If the source is incomplete, retain the evidenced ingredients/steps and explain the specific missing information in review_reason.
Use this exact facet shape:
{"recipe":{"nutritionGoals":[],"foodStyles":[],"mealType":null,"dietaryTags":[],"estimatedTimeMinutes":null}}
Allowed nutritionGoals values: bulking, cutting, maintenance, high-protein.
Allowed foodStyles values: gym, gourmet, meal-prep, everyday, comfort-food. Classify meal-prep only when preparing portions ahead is a defining purpose, not merely because the recipe can be stored.
For fitness use this exact facet shape:
{"fitness":{"goals":[],"muscleGroups":[],"equipment":[],"difficulty":null,"trainingStyles":[]}}
Use [] or null for facets that are not evidenced. For every other category return {}.
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
  const item = await claim();
  if (!item) return false;
  try {
    const inputs: Array<Record<string, unknown>> = [
      { type: "text", text: prompt(item, await getSetting("analysis.locale", "es")), text_elements: [] },
    ];
    if (item.contact_sheet_path) {
      const imagePath = resolve(dataDir, item.contact_sheet_path);
      if (existsSync(imagePath)) inputs.push({ type: "localImage", path: imagePath, detail: "high" });
      else {
        await addEvent(item.id, "analyzing", "input_warning", "Contact sheet unavailable on this worker; analysis uses the saved caption and transcript only.");
        inputs.push({ type: "text", text: "The source contact sheet is unavailable. Analyze only the supplied caption and transcript; do not infer visual details.", text_elements: [] });
      }
    }
    const finalText = await runCodexAnalysis(item.id, inputs, outputSchema);
    const wire = JSON.parse(finalText) as WireAnalysis;
    const rawFacets = JSON.parse(wire.facets_json) as Record<string, unknown>;
    const analysis: Analysis = {
      ...wire,
      entities: JSON.parse(wire.entities_json) as Record<string, unknown>,
      facets: normalizeFacets(wire.category, rawFacets),
    };
    const locale = await getSetting("analysis.locale", "es");
    await transaction(async (tx) => {
      if (!await tx.one("SELECT id FROM publications WHERE id=$1 FOR UPDATE",[item.id])) throw new Error("Publication was removed during analysis");
      const previous = await getContent(item.id, tx);
      (await tx.execute("INSERT INTO analysis_versions(publication_id,analysis_json,source) VALUES ($1,$2,$3)",[item.id,JSON.stringify(analysis),"codex"]));
      (await tx.execute(`
        INSERT INTO analyses(
          publication_id,category,subcategory,title,summary,visual_description,
          why_interesting,next_action,ai_action_status,tags_json,entities_json,
          facets_json,confidence,needs_review,review_reason,codex_notes,prompt_version,output_locale
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
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
      `,[item.id,analysis.category,analysis.subcategory,analysis.title,analysis.summary,analysis.visual_description,analysis.why_interesting,analysis.next_action,analysis.action_status,JSON.stringify(analysis.tags),JSON.stringify(analysis.entities),JSON.stringify(analysis.facets),analysis.confidence,analysis.needs_review ? 1 : 0,analysis.review_reason,analysis.codex_notes,"v5",locale]));
      (await tx.execute(`
        UPDATE publications SET processing_status='analyzed',current_stage='analyzed',
          action_status=$1,review_status='unreviewed',last_error=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE id=$2
      `,[analysis.action_status,item.id]));
      await addEvent(item.id, "analyzed", "transition", "Codex analysis completed", tx);
      const current = await getContent(item.id, tx);
      if (current) await reconfirmChangedRestaurantLocations(previous, current, tx);
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (await db.execute(`
      UPDATE publications SET processing_status=CASE WHEN EXISTS (SELECT 1 FROM analyses WHERE publication_id=$2) THEN 'analyzed' ELSE 'failed' END,current_stage='analyzing',
        attempts=attempts+1,last_error=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2
    `,[message.slice(0, 4_000),item.id]));
    await addEvent(item.id, "analyzing", "error", message.slice(0, 4_000));
    return true;
  }
}
