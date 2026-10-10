import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: { port: 47231, strictPort: true, host: "127.0.0.1", hmr: false },
  clearScreen: false,
  optimizeDeps: {
    exclude: ["@ek-tool/dice", "@ek-tool/scenario", "@ek/tool-api"],
  },
});
