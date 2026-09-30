import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

// Midnight SDK packages ship wasm and use top-level await; with
// build.target 'es2022' both are supported natively (no TLA plugin needed —
// its SWC-based transform breaks on this output).
export default defineConfig({
  plugins: [react({ exclude: /credential-registry\.js$/ }), wasm()],
  resolve: {
    alias: {
      '@midnight-ntwrk/compact-runtime': '/node_modules/@midnight-ntwrk/compact-runtime/dist/index.js',
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: { global: 'globalThis' },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 8000,
  },
});
