import { resolve } from "path";
import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    target: "chrome114",
    rollupOptions: {
      input: {
        whiteboard: resolve(__dirname, "src/whiteboard/whiteboard.html"),
        settings: resolve(__dirname, "src/settings/settings.html"),
      },
    },
  },
});
