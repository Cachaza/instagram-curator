import { auth } from "@/lib/auth";
import { discoverBrowserProfiles } from "@/lib/instagram-setup";
import { getSetting, setSetting } from "@/lib/settings";
import { runCommand } from "@/worker/process";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

const Schema = z.object({
  username: z.string().trim().max(100),
  cookiesFromBrowser: z.string().trim().max(2_000),
  instaloaderSessionFile: z.string().trim().max(2_000),
  testUrl: z.string().url().optional(),
  action: z.enum(["save", "validate"]).default("save"),
});

async function isAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  return Boolean(session && session.user.role === "admin");
}

export async function GET() {
  if (!await isAdmin()) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({
    username: getSetting("instagram.username", ""),
    cookiesFromBrowser: getSetting("instagram.cookies_from_browser", ""),
    instaloaderSessionFile: getSetting("instagram.instaloader_session_file", ""),
    profiles: discoverBrowserProfiles(),
  });
}

export async function POST(request: Request) {
  if (!await isAdmin()) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_instagram_setup" }, { status: 400 });

  setSetting("instagram.username", parsed.data.username);
  setSetting("instagram.cookies_from_browser", parsed.data.cookiesFromBrowser);
  setSetting("instagram.instaloader_session_file", parsed.data.instaloaderSessionFile, true);

  if (parsed.data.action === "validate") {
    if (!parsed.data.testUrl) {
      return NextResponse.json({ error: "test_url_required" }, { status: 400 });
    }
    const command = ["yt-dlp", "--simulate", "--no-playlist", "--no-warnings"];
    if (parsed.data.cookiesFromBrowser) {
      command.push("--cookies-from-browser", parsed.data.cookiesFromBrowser);
    }
    command.push(parsed.data.testUrl);
    try {
      await runCommand(command);
    } catch (error) {
      return NextResponse.json({
        error: "instagram_validation_failed",
        detail: error instanceof Error ? error.message.slice(0, 1_000) : String(error),
      }, { status: 422 });
    }
  }
  return NextResponse.json({ ok: true });
}
