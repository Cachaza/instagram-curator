import { auth } from "@/lib/auth";
import { saveReview } from "@/lib/reviews";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

const Schema = z.object({
  reviewStatus: z.enum(["approved", "corrected", "discarded", "unreviewed"]),
  actionStatus: z.enum(["inbox", "action", "someday", "reference", "done"]),
  correctedCategory: z.string().nullable().optional(),
  correctedAnalysis: z.record(z.string(), z.unknown()).nullable().optional(),
  notes: z.string().nullable().optional(),
  discardedReason: z.string().nullable().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_review" }, { status: 400 });
  const { id } = await context.params;
  try {
    saveReview(id, { ...parsed.data, userId: session.user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "review_failed" }, { status: 400 });
  }
}
