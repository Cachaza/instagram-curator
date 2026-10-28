import { mkdtemp, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Publish only complete media; a failed retry must preserve the previous file. */
export async function publishMediaFile(destination: string, generate: (temporary: string) => Promise<void>) {
  // A sibling temporary directory guarantees rename stays on the same filesystem.
  const directory = await mkdtemp(join(dirname(destination), ".media-write-"));
  const temporary = join(directory, basename(destination));
  try {
    await generate(temporary);
    const file = await stat(temporary);
    if (!file.isFile() || file.size === 0) throw new Error("Media generation produced no file content; previous media retained.");
    await rename(temporary, destination);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
