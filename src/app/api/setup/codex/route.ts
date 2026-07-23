import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { codexAccountStatus, startDeviceLogin } from "@/lib/codex/account";

async function admin() {
  const session = await auth.api.getSession({ headers: await headers() });
  return Boolean(session && session.user.role === "admin");
}

export async function GET() {
  if (!await admin()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await codexAccountStatus());
  } catch (error) {
    return NextResponse.json({
      connected: false,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function POST() {
  if (!await admin()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await startDeviceLogin());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
