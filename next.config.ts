import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: "/sw.js",
      headers: [
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; object-src 'none'" },
      ],
    }];
  },
  serverExternalPackages: ["pg", "better-sqlite3"],
  allowedDevOrigins: (process.env.CURATOR_ALLOWED_DEV_ORIGINS ?? "localhost,127.0.0.1")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

export default nextConfig;
