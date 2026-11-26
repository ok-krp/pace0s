import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 2000,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tanstackStart({
      router: {
        routeFileIgnorePattern: "(^|/)routeTree\\.gen\\.ts$",
      },
      server: {
        entry: "server",
      },
    }),
    nitro(),
    tailwindcss(),
    viteReact(),
  ],
});
