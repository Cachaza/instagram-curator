import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const row = db.prepare("SELECT processing_status,current_stage FROM publications WHERE id=?").get(id) as { processing_status: string; current_stage: string } | undefined;
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.processing_status !== "failed") return NextResponse.json({ error: "not_failed" }, { status: 409 });
  const next = row.current_stage === "analyzing" ? "ready_for_analysis" : "pending";
  db.transaction(() => {
    db.prepare("UPDATE publications SET processing_status=?,current_stage=?,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(next, next, id);
    db.prepare("INSERT INTO pipeline_events(publication_id,stage,event_type,message) VALUES (?,?,?,?)").run(id, next, "retry", "Manual retry requested");
  })();
  return NextResponse.json({ ok: true, status: next });
}
