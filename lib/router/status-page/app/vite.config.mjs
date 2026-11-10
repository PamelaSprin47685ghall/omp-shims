import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  publicDir: false,
  plugins: [svelte()],
  build: {
    outDir: fileURLToPath(new URL("../dist", import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    sourcemap: false,
    minify: "oxc",
    target: "es2022",
    rollupOptions: {
      input: fileURLToPath(new URL("client.js", import.meta.url)),
      output: {
        entryFileNames: "assets/status-page.[hash].js",
        chunkFileNames: "assets/status-page.[hash].js",
        assetFileNames: "assets/status-page.[hash][extname]",
      },
    },
  },
});
