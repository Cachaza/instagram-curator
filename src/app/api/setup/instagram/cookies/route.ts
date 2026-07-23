import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { dataDir } from "@/lib/paths";
import { setSetting } from "@/lib/settings";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await request.formData();
  const file = form.get("cookies");
  if (!(file instanceof File) || file.size < 10 || file.size > 5_000_000) {
    return NextResponse.json({ error: "invalid_cookie_file" }, { status: 400 });
  }
  const text = await file.text();
  if (!text.includes("Netscape HTTP Cookie File") && !text.includes(".instagram.com")) {
    return NextResponse.json({ error: "unsupported_cookie_format" }, { status: 400 });
  }
  const secretsDir = join(dataDir, "secrets");
  mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  const destination = join(secretsDir, "instagram-cookies.txt");
  writeFileSync(destination, text, { mode: 0o600 });
  chmodSync(destination, 0o600);
  setSetting("instagram.cookie_file", destination, true);
  setSetting("instagram.cookies_from_browser", "");
  return NextResponse.json({ ok: true });
}
