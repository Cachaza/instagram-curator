import { open } from "node:fs/promises";

/** Caller authenticates first. Errors must never be cached as an image. */
export function mediaNotFound() {
  return new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });
}

export async function previewResponse(path: string, ifNoneMatch: string | null) {
  let file;
  try {
    // Keep one open inode through stat/read: an atomic replacement cannot mix
    // the previous file's validators with the new image's body.
    file = await open(path, "r");
    const stats = await file.stat({ bigint: true });
    if (!stats.isFile() || stats.size === BigInt(0)) return mediaNotFound();
    const etag = `"${stats.ino}-${stats.size}-${stats.mtimeNs}-${stats.ctimeNs}"`;
    const headers = {
      "content-type": "image/jpeg",
      // HTTP max-age=0 requires revalidation; unchanged previews use 304.
      "cache-control": "private, max-age=0, must-revalidate",
      "etag": etag,
      "x-content-type-options": "nosniff",
    };
    const matches = ifNoneMatch?.split(",").some((value) => value.trim().replace(/^W\//, "") === etag || value.trim() === "*");
    if (matches) return new Response(null, { status: 304, headers });
    const bytes = await file.readFile();
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "content-length": String(bytes.length) } });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return mediaNotFound();
    throw error;
  } finally { await file?.close(); }
}
