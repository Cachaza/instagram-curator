import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { verifyShareToken } from "@/lib/settings";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!session && !verifyShareToken(token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const publication = db.prepare(`
    SELECT id,source_url,processing_status,current_stage,attempts,last_error,created_at,updated_at
    FROM publications WHERE id=?
  `).get(id);
  if (!publication) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(publication);
}
