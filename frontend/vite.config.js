import { defineConfig } from "vite";
export default defineConfig({
  build: {
    minify: false,
    cssMinify: false,
    outDir: "../backend/public",
    emptyOutDir: false,
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/audit.html": "http://localhost:3000",
    },
  },
});
