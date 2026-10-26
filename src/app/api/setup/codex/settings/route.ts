import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { codexPreferences, configuredCodexModel, listCodexModels, PreferencesSchema, saveCodexPreferences, validCodexPreferences } from "@/lib/codex/preferences";
import { accountTokenTotal, curatorUsage, subscriptionLimits } from "@/lib/codex/usage";

async function admin() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.role === "admin";
}

export async function GET() {
  if (!await admin()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [models, config, limits, accountTokens] = await Promise.allSettled([
    listCodexModels(), configuredCodexModel(), subscriptionLimits(), accountTokenTotal(),
  ]);
  const catalog = models.status === "fulfilled" ? models.value : [];
  return NextResponse.json({
    preferences: await codexPreferences(), models: catalog,
    defaultModel: config.status === "fulfilled" ? config.value ?? catalog.find((m) => m.isDefault)?.model ?? null : null,
    limits: limits.status === "fulfilled" ? limits.value : null,
    accountTokens: accountTokens.status === "fulfilled" ? accountTokens.value : null,
    usage: await curatorUsage(),
    errors: { models: models.status === "rejected", config: config.status === "rejected", limits: limits.status === "rejected", accountTokens: accountTokens.status === "rejected" },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  if (!await admin()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = PreferencesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_preferences" }, { status: 400 });
  try {
    const [models, configured] = await Promise.all([listCodexModels(), parsed.data.model === null ? configuredCodexModel() : Promise.resolve(null)]);
    const defaultModel = configured ?? models.find((m) => m.isDefault)?.model ?? null;
    if (!validCodexPreferences(parsed.data, models, defaultModel)) return NextResponse.json({ error: "unsupported_model_or_effort" }, { status: 400 });
    await saveCodexPreferences(parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "catalog_unavailable" }, { status: 503 });
  }
}
