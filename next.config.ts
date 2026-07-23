import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: (process.env.CURATOR_ALLOWED_DEV_ORIGINS ?? "localhost,127.0.0.1")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

export default nextConfig;
