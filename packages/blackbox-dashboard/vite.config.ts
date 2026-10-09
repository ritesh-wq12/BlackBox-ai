import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Forward relative /api/... requests to the Black Box backend,
    // preserving the path (e.g. /api/state -> http://localhost:8888/api/state).
    proxy: {
      "/api": "http://localhost:8888"
    }
  },
  preview: {
    port: 4173,
    strictPort: true
  }
});
