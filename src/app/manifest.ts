import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Curator",
    short_name: "Curator",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f2efea",
    theme_color: "#1a1d20",
    icons: [
      { src: "/icons/curator-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/curator-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/curator-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
