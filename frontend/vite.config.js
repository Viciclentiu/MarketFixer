import { defineConfig } from "vite";
export default defineConfig({
  build: {
    minify: false,
    cssMinify: false,
    outDir: "../backend/public",
    emptyOutDir: false,
    rollupOptions: {
      input: { main: 'index.html', audit: 'audit.html' },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
