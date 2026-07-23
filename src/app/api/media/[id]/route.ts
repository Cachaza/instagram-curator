import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveMediaPath } from "@/lib/media";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const row = db.prepare("SELECT contact_sheet_path,video_path,audio_path FROM publications WHERE id=?")
    .get(id) as { contact_sheet_path: string | null; video_path: string | null; audio_path: string | null } | undefined;
  const kind = new URL(request.url).searchParams.get("kind");
  const stored = kind === "video" ? row?.video_path : kind === "audio" ? row?.audio_path : row?.contact_sheet_path;
  const path = resolveMediaPath(stored ?? null);
  if (!path) return new NextResponse("Not found", { status: 404 });
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
  return new NextResponse(new Uint8Array(await readFile(path)), {
    headers: { "content-type": contentType, "cache-control": "private, max-age=3600" },
  });
}
