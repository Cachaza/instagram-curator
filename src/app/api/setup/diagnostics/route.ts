import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { systemDiagnostics } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ checks: await systemDiagnostics() });
}
