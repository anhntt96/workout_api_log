import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin API in development: /api/x → <API_URL>/x, so the API needs no CORS.
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // East of UTC, so code that reads the UTC day instead of the local day fails the date tests.
    env: { TZ: 'Asia/Ho_Chi_Minh' },
    // Node 25+ defines its own localStorage global (undefined without --localstorage-file), which hides jsdom's.
    execArgv: ['--no-experimental-webstorage'],
  },
});
