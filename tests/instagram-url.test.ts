import { describe, expect, test } from "bun:test";
import { parseInstagramUrl } from "../src/lib/instagram-url";

describe("Instagram URL parser", () => {
  test("normalizes reels and strips tracking parameters", () => {
    expect(parseInstagramUrl("https://instagram.com/reel/Ab_C-12/?igsh=abc")).toEqual({
      normalizedUrl: "https://www.instagram.com/reel/Ab_C-12/",
      shortcode: "Ab_C-12",
      route: "reel",
      id: expect.stringMatching(/^publication_[a-f0-9]{16}$/),
    });
  });

  test("accepts posts", () => {
    expect(parseInstagramUrl("https://www.instagram.com/p/ABC123/").route).toBe("p");
  });

  test("rejects arbitrary URLs and Instagram profile pages", () => {
    expect(() => parseInstagramUrl("https://example.com/reel/ABC/")).toThrow("unsupported_instagram_url");
    expect(() => parseInstagramUrl("https://instagram.com/some-profile/")).toThrow("unsupported_instagram_url");
  });
});
