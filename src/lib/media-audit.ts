import { accessSync, constants, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { db } from "./db";
import { dataDir } from "./paths";

const mediaColumns = { preview: "contact_sheet_path", video: "video_path", audio: "audio_path" } as const;
export type MediaFileState = "available" | "missing" | "empty" | "not_file" | "outside_storage" | "unreadable";
export type MediaFileCheck = { id: string; kind: keyof typeof mediaColumns; path: string; state: MediaFileState };
export type MediaAuditRow = { id: string; contact_sheet_path: string | null; video_path: string | null; audio_path: string | null };

export function inspectMediaFiles(rows: MediaAuditRow[], root = dataDir) {
  const checks: MediaFileCheck[] = [];
  const resolvedRoot = resolve(root);
  for (const row of rows) for (const [kind, column] of Object.entries(mediaColumns) as [keyof typeof mediaColumns, typeof mediaColumns[keyof typeof mediaColumns]][]) {
    const stored = row[column];
    if (!stored) continue;
    const path = resolve(resolvedRoot, stored);
    let state: MediaFileState = "available";
    if (path !== resolvedRoot && !path.startsWith(`${resolvedRoot}${sep}`)) state = "outside_storage";
    else {
      try {
        const file = statSync(path);
        if (!file.isFile()) state = "not_file";
        else if (file.size === 0) state = "empty";
        else accessSync(path, constants.R_OK);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : null;
        state = code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unreadable";
      }
    }
    checks.push({ id: row.id, kind, path: stored, state });
  }
  return { publications: rows.length, available: checks.filter((file) => file.state === "available").length, unavailable: checks.filter((file) => file.state !== "available") };
}

export async function auditMediaFiles() {
  return inspectMediaFiles(await db.all<MediaAuditRow>("SELECT id,contact_sheet_path,video_path,audio_path FROM publications"));
}
