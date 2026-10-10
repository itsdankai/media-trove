import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "app",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./app/src", import.meta.url)) } },
  build: { outDir: "dist", emptyOutDir: true },
  // Keep the browser's Host header: sign-in trusts same-host origins, and the shorthand form rewrote it to :8787.
  server: { proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false } } },
});
