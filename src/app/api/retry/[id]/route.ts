import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, transaction } from "@/lib/db";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const row = await db.one<{ processing_status: string; current_stage: string }>("SELECT processing_status,current_stage FROM publications WHERE id=$1", [id]);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.processing_status !== "failed") return NextResponse.json({ error: "not_failed" }, { status: 409 });
  const next = row.current_stage === "analyzing" ? "ready_for_analysis" : "pending";
  await transaction(async (tx) => {
    await tx.execute("UPDATE publications SET processing_status=$1,current_stage=$2,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$3", [next, next, id]);
    await tx.execute("INSERT INTO pipeline_events(publication_id,stage,event_type,message) VALUES ($1,$2,$3,$4)", [id, next, "retry", "Manual retry requested"]);
  });
  return NextResponse.json({ ok: true, status: next });
}
