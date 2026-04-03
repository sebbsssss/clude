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
    outDir: '../web/public/dashboard',
    emptyOutDir: true,
    commonjsOptions: {
      include: [/node_modules/],
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
