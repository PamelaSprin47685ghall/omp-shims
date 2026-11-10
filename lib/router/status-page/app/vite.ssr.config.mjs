import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  publicDir: false,
  plugins: [svelte()],
  ssr: {
    noExternal: true,
    external: [],
  },
  build: {
    ssr: fileURLToPath(new URL("ssr.js", import.meta.url)),
    outDir: fileURLToPath(new URL("../dist/server", import.meta.url)),
    emptyOutDir: true,
    emitAssets: false,
    ssrEmitAssets: false,
    cssCodeSplit: false,
    sourcemap: false,
    minify: false,
    target: "node20",
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "status-page.ssr.mjs",
        chunkFileNames: "status-page.[hash].mjs",
      },
    },
  },
});
