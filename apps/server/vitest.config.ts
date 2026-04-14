import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@clude/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@clude/brain': path.resolve(__dirname, '../../packages/brain/src'),
    },
  },
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', '.claude', 'dist'],
  },
});
