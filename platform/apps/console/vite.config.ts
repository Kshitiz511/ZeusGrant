import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Same-origin by design: the browser only ever calls /api/*, which Vite proxies
// to the backend services. This mirrors the prod reverse-proxy / BFF topology
// and means no CORS, no cross-site token leakage.
const CORE = process.env.ZEUS_CORE_URL ?? "http://127.0.0.1:8000";
const CC = process.env.ZEUS_CC_URL ?? "http://127.0.0.1:8001";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    host: true, // listen on 0.0.0.0 so it works in Docker / from a phone on LAN
    port: 5173,
    proxy: {
      "/api/core": { target: CORE, changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/core/, "") },
      "/api/cc": { target: CC, changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/cc/, "") },
    },
  },
});
