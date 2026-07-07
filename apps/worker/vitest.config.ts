import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@proveeduria/core': fileURLToPath(
        new URL('../../packages/core/src/index.ts', import.meta.url),
      ),
      '@proveeduria/agent': fileURLToPath(
        new URL('../../packages/agent/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
