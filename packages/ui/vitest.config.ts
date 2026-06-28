import { defineConfig } from 'vitest/config';

// Node environment is enough — the pmp crypto + export-flow tests are pure logic (tweetnacl +
// Web Crypto + control flow), no DOM. (Component tests would need jsdom; the panel's load-bearing
// register-on-demand logic is extracted into export-flow.ts precisely so it's testable here.)
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
