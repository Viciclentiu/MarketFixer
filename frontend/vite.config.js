import { defineConfig } from "vite";
const isVercel = process.env.VERCEL === "1";

export default defineConfig({
  build: {
    minify: false,
    cssMinify: false,
    outDir: isVercel ? "dist" : "../backend/public",
    emptyOutDir: isVercel,
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
