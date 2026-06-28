import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({ include: ['buffer'], globals: { Buffer: true } }),
  ],
  envDir: '../..',
  base: '/chat/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // @clude/shared is a CJS workspace package whose symlinked real path sits OUTSIDE node_modules,
    // so vite's default commonjsOptions.include (/node_modules/) skips it and Rollup can't see its
    // named exports — which the chat now imports transitively via @clude/ui (OWNER_SIGN_MESSAGE +
    // the register/decrypt crypto). Without this, the chat `vite build` fails in the Docker builder
    // and takes the whole Railway deploy down. Mirrors apps/dashboard/vite.config.ts.
    commonjsOptions: {
      include: [/node_modules/, /packages\/shared/],
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-privy': ['@privy-io/react-auth'],
          'vendor-motion': ['framer-motion'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
