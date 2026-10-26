import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { retryPublication } from "@/lib/retry";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const result = await retryPublication(id);
  if ("error" in result) return NextResponse.json({error:result.error},{status:result.status});
  return NextResponse.json({ok:true,status:result.next});
}
