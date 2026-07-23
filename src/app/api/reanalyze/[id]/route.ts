import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  db.prepare(`
    UPDATE publications SET processing_status='ready_for_analysis',
      current_stage='ready_for_analysis',review_status='unreviewed',
      lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(id);
  return NextResponse.json({ ok: true });
}
