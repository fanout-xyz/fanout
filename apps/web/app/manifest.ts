import type { MetadataRoute } from "next";

/** Installable payee app: opens straight to the balance, like a bank app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/balance",
    name: "Fanout",
    short_name: "Fanout",
    description: "Get paid in dollars by the platforms you work with. Claim with Face ID, keep your balance, prove your earnings.",
    start_url: "/balance",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FFF6EA",
    theme_color: "#FFF6EA",
    categories: ["finance"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
