import { auth } from "@/lib/auth";
import { enqueueInstagramUrl } from "@/lib/imports";
import { verifyShareToken } from "@/lib/settings";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

const ImportSchema = z.object({
  url: z.string().trim().min(1).max(2_000),
});

async function requester(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) return { allowed: true, userId: session.user.id };

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return { allowed: verifyShareToken(token), userId: null };
}

export async function POST(request: Request) {
  const actor = await requester(request);
  if (!actor.allowed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = ImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  try {
    const result = enqueueInstagramUrl(parsed.data.url, actor.userId);
    return NextResponse.json({
      publication_id: result.publicationId,
      status: result.status,
      created: result.created,
      status_url: `/api/v1/publications/${result.publicationId}`,
    }, { status: 202 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_url";
    return NextResponse.json({ error: code }, { status: 422 });
  }
}
