import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Task Sync Hub",
    short_name: "TaskHub",
    description: "Task management app with Google Calendar and Google Tasks sync.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4efe7",
    theme_color: "#b85c38",
    lang: "ja",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png"
      }
    ]
  };
}
