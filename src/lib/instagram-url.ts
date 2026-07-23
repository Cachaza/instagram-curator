import { createHash } from "node:crypto";

const allowedHosts = new Set(["instagram.com", "www.instagram.com"]);
const shortcodePattern = /^[A-Za-z0-9_-]+$/;

export type InstagramPublicationUrl = {
  normalizedUrl: string;
  shortcode: string;
  route: "reel" | "p";
  id: string;
};

export function parseInstagramUrl(input: string): InstagramPublicationUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("invalid_url");
  }

  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error("unsupported_instagram_url");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const route = parts[0];
  const shortcode = parts[1];
  if ((route !== "reel" && route !== "p") || !shortcode || !shortcodePattern.test(shortcode)) {
    throw new Error("unsupported_instagram_url");
  }

  const normalizedUrl = `https://www.instagram.com/${route}/${shortcode}/`;
  const digest = createHash("sha256").update(normalizedUrl).digest("hex").slice(0, 16);
  return {
    normalizedUrl,
    shortcode,
    route,
    id: `publication_${digest}`,
  };
}
