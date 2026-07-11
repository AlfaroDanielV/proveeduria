import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Config de Vite para el Centro de Control (apps/portal). El build sale a dist/ (contrato
// que espera build:all en la raiz); en dev el proxy reenvia /api hacia apps/api local.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
  },
});
