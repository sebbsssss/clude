import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer'],
      globals: { Buffer: true },
    }),
  ],
  envDir: '../..',
  base: '/dashboard/',
  define: {
    'global': 'globalThis',
  },
  optimizeDeps: {
    include: ['buffer', '@privy-io/react-auth'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    commonjsOptions: {
      // `@clude/shared` is a CommonJS workspace package symlinked under node_modules → its real
      // path is packages/shared/dist (outside node_modules), so the default `/node_modules/`
      // include skips it and Rollup can't statically see its named exports (e.g. the
      // owner-key-constants the client-side .pmp decrypt imports). Include it explicitly so the
      // commonjs plugin transforms it and those named imports resolve in the production build.
      include: [/node_modules/, /packages\/shared/],
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/brain.html': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
