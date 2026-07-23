import { unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dataDir } from "@/lib/paths";

type PublicationFiles = {
  video_path: string | null;
  audio_path: string | null;
  transcript_path: string | null;
  contact_sheet_path: string | null;
  frames_json: string;
};

function safeMediaPath(stored: string): string | null {
  const candidate = resolve(dataDir, stored);
  const fromData = relative(dataDir, candidate);
  if (fromData.startsWith("..") || isAbsolute(fromData)) return null;
  return candidate;
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const publication = db.prepare(`
    SELECT video_path,audio_path,transcript_path,contact_sheet_path,frames_json
    FROM publications WHERE id=?
  `).get(id) as PublicationFiles | undefined;
  if (!publication) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let frames: unknown = [];
  try { frames = JSON.parse(publication.frames_json); } catch { frames = []; }
  const storedPaths = [
    publication.video_path,
    publication.audio_path,
    publication.transcript_path,
    publication.contact_sheet_path,
    ...(Array.isArray(frames) ? frames.filter((path): path is string => typeof path === "string") : []),
  ].filter((path): path is string => Boolean(path));

  db.prepare("DELETE FROM publications WHERE id=?").run(id);

  const cleanup = await Promise.allSettled(
    [...new Set(storedPaths)].map((stored) => {
      const path = safeMediaPath(stored);
      return path ? unlink(path) : Promise.resolve();
    }),
  );
  const cleanupWarnings = cleanup.filter((result) =>
    result.status === "rejected" && (result.reason as NodeJS.ErrnoException)?.code !== "ENOENT").length;

  return NextResponse.json({ ok: true, cleanupWarnings });
}
