import { auth } from "@/lib/auth";
import { createShareToken, getSetting, hasSetting, setSetting } from "@/lib/settings";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

const SetupSchema = z.object({
  uiLocale: z.enum(["es", "en"]),
  analysisLocale: z.enum(["es", "en"]),
  transcriptionModel: z.string().trim().min(1).max(100),
  openaiApiKey: z.string().trim().min(8).optional(),
});

async function adminSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") return null;
  return session;
}

export async function GET() {
  if (!await adminSession()) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({
    uiLocale: getSetting("ui.locale", "es"),
    analysisLocale: getSetting("analysis.locale", "es"),
    transcriptionModel: getSetting("transcription.model", "whisper-1"),
    openaiConfigured: hasSetting("transcription.openai_api_key"),
    shareTokenConfigured: hasSetting("api.share_token"),
  });
}

export async function POST(request: Request) {
  if (!await adminSession()) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = SetupSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_setup", issues: parsed.error.issues }, { status: 400 });
  }

  setSetting("ui.locale", parsed.data.uiLocale);
  setSetting("analysis.locale", parsed.data.analysisLocale);
  setSetting("transcription.provider", "openai");
  setSetting("transcription.model", parsed.data.transcriptionModel);
  if (parsed.data.openaiApiKey) {
    setSetting("transcription.openai_api_key", parsed.data.openaiApiKey, true);
  }
  let shareToken: string | undefined;
  if (!hasSetting("api.share_token")) shareToken = createShareToken();
  setSetting("setup.complete", true);

  return NextResponse.json({ ok: true, shareToken });
}
