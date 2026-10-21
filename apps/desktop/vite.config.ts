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
    // Tool packages stay excluded so they are not prebundled with a second React.
    // Their libraries must be included up front. pnpm keeps them inside the tool
    // package, so the "> " form resolves from that package. Discovering them on
    // the first prep open re-optimizes deps, and hmr is off so the page never reloads.
    include: [
      "@ek-tool/scenario > @tiptap/core",
      "@ek-tool/scenario > @tiptap/react",
      "@ek-tool/scenario > @tiptap/starter-kit",
      "@ek-tool/scenario > @tiptap/extension-image",
      "@ek-tool/scenario > @tiptap/extension-placeholder",
      "@ek-tool/scenario > @tiptap/extension-text-style",
      "@ek-tool/scenario > @tiptap/extension-highlight",
      "@ek-tool/scenario > @tiptap/extension-find-and-replace",
      "@ek-tool/copilot > react-markdown",
      "@ek-tool/copilot > remark-gfm",
    ],
    exclude: ["@ek-tool/character", "@ek-tool/copilot", "@ek-tool/dice", "@ek-tool/scenario", "@ek/tool-api"],
  },
});
