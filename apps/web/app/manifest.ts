import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Veylta",
    short_name: "Veylta",
    description: "Личная история здоровья с проверяемыми источниками",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6f8",
    theme_color: "#1649d8",
    lang: "ru",
    categories: ["health", "medical", "productivity"],
    icons: [
      {
        src: "/icons/veylta-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/veylta-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/veylta-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
