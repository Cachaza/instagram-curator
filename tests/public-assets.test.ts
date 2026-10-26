import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("public source excludes private library captures", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0");
  expect(tracked.filter((path) => /^(data\/|docs\/(screenshots|design)\/)/.test(path))).toEqual([]);
});

test("the local publisher rejects private-capture paths before Docker runs", () => {
  const fixture = mkdtempSync(join(tmpdir(), "curator-publication-guard-"));
  try {
    mkdirSync(join(fixture, "scripts"));
    mkdirSync(join(fixture, "bin"));
    mkdirSync(join(fixture, "docs/screenshots"), { recursive: true });
    mkdirSync(join(fixture, "sesión"), { recursive: true });
    copyFileSync("scripts/publish-local-image.sh", join(fixture, "scripts/publish-local-image.sh"));
    writeFileSync(join(fixture, "docs/screenshots/library.png"), "Synthetic regression fixture, no personal content");
    writeFileSync(join(fixture, "docs/screenshots/captura-mañana.png"), "Synthetic fixture");
    writeFileSync(join(fixture, "sesión/cookies.txt"), "Synthetic fixture");
    writeFileSync(join(fixture, "docs/screenshots/two\nlines.png"), "Synthetic fixture");
    const dockerMarker = join(fixture, "docker-was-called");
    writeFileSync(join(fixture, "bin/docker"), `#!/bin/sh\ntouch '${dockerMarker}'\n`);
    chmodSync(join(fixture, "bin/docker"), 0o755);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: fixture, stdio: "pipe" });
    git("init");
    git("add", ".");
    git("-c", "user.name=Curator test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Synthetic fixture");
    const result = spawnSync("bash", ["scripts/publish-local-image.sh", "HEAD"], {
      cwd: fixture,
      encoding: "utf8",
      env: { ...process.env, PATH: `${join(fixture, "bin")}:${process.env.PATH}` },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing public image publication");
    expect(result.stderr).toContain("docs/screenshots/library.png");
    expect(result.stderr).toContain("docs/screenshots/captura-mañana.png");
    expect(result.stderr).toContain("sesión/cookies.txt");
    expect(result.stderr).toContain("docs/screenshots/two\nlines.png");
    expect(existsSync(dockerMarker)).toBe(false);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
