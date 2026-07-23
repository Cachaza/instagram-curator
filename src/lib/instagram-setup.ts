import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type BrowserProfile = {
  browser: "firefox" | "chrome" | "chromium";
  label: string;
  cookieFile: string;
  ytdlpValue: string;
};

function directories(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(path, entry.name));
}

export function discoverBrowserProfiles(): BrowserProfile[] {
  const home = homedir();
  const profiles: BrowserProfile[] = [];
  for (const directory of directories(join(home, ".mozilla", "firefox"))) {
    const cookieFile = join(directory, "cookies.sqlite");
    if (existsSync(cookieFile)) {
      profiles.push({
        browser: "firefox",
        label: `Firefox · ${directory.split("/").at(-1)}`,
        cookieFile,
        ytdlpValue: `firefox:${directory}`,
      });
    }
  }
  for (const [browser, root] of [
    ["chrome", join(home, ".config", "google-chrome")],
    ["chromium", join(home, ".config", "chromium")],
  ] as const) {
    for (const directory of directories(root)) {
      const cookieFile = join(directory, "Cookies");
      if (existsSync(cookieFile)) {
        profiles.push({
          browser,
          label: `${browser === "chrome" ? "Chrome" : "Chromium"} · ${directory.split("/").at(-1)}`,
          cookieFile,
          ytdlpValue: `${browser}:${directory}`,
        });
      }
    }
  }
  return profiles;
}
