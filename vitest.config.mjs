import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    alias: {
      '@plugin-host': resolve(__dirname, 'test/__mocks__/plugin-host.js'),
    },
  },
  resolve: {
    alias: {
      '@plugin-host': resolve(__dirname, 'test/__mocks__/plugin-host.js'),
    },
  },
});
