import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveCompatibleVideo, resolveMediaPath } from "@/lib/media";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { mediaNotFound, previewResponse } from "@/lib/media-response";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "private, no-store" } });
  const { id } = await context.params;
  const row = await db.one<{ contact_sheet_path: string | null; video_path: string | null; audio_path: string | null }>("SELECT contact_sheet_path,video_path,audio_path FROM publications WHERE id=$1", [id]);
  const kind = new URL(request.url).searchParams.get("kind");
  const stored = kind === "video" ? row?.video_path : kind === "audio" ? row?.audio_path : row?.contact_sheet_path;
  const resolvedPath = resolveMediaPath(stored ?? null);
  if (!resolvedPath) return mediaNotFound();
  const path = kind === "video" ? await resolveCompatibleVideo(resolvedPath) : resolvedPath;
  const contentType = kind === "video" ? "video/mp4" : kind === "audio" ? "audio/wav" : "image/jpeg";
  if (kind === "video" || kind === "audio") {
    const size = (await stat(path)).size;
    const range = request.headers.get("range");
    let start = 0;
    let end = size - 1;
    let status = 200;
    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match) return new NextResponse(null, { status: 416 });
      start = match[1] ? Number(match[1]) : 0;
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start > end || start >= size) return new NextResponse(null, { status: 416 });
      status = 206;
    }
    const body = Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream;
    const responseHeaders: Record<string, string> = {
      "content-type": contentType,
      "content-length": String(end - start + 1),
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
    };
    if (status === 206) responseHeaders["content-range"] = `bytes ${start}-${end}/${size}`;
    return new NextResponse(body, { status, headers: responseHeaders });
  }
  return previewResponse(path, request.headers.get("if-none-match"));
}
