import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Inject development runtime env for /api proxy path
const envVars = {
  PORT: process.env.PORT || '8888',
  NODE_ENV: process.env.NODE_ENV || 'development'
};

// Write env to a JSON file that can be read at runtime
const envPath = path.join(__dirname, 'env.json');
fs.writeFileSync(envPath, JSON.stringify(envVars, null, 2));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Forward relative /api/... requests to the Black Box backend,
    // preserving the path (e.g. /api/state -> http://localhost:8888/api/state).
    proxy: {
      '/api': `http://localhost:${envVars.PORT}`
    }
  },
  preview: {
    port: 4173,
    strictPort: true
  },
  define: {
    'process.env.PORT': JSON.stringify(envVars.PORT),
    'process.env.NODE_ENV': JSON.stringify(envVars.NODE_ENV)
  }
});
