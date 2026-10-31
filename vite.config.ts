import { defineConfig } from 'vitest/config';

// IFClite's WASM geometry uses SharedArrayBuffer, which needs cross-origin isolation.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  optimizeDeps: {
    exclude: ['@ifc-lite/wasm', '@ifc-lite/diff'],
  },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  test: { include: ['src/**/*.test.ts'] },
});
