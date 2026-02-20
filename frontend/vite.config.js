import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Explicitly point the subpath to the correct file if resolution fails
      'dunder-proto/get': 'dunder-proto/get.js',
    }
  },
  build: {
    commonjsOptions: {
      // Ensure these packages are treated as CommonJS if they are causing issues
      include: [/dunder-proto/, /node_modules/],
      transformMixedEsModules: true
    },
    rollupOptions: {
      // Ensure dunder-proto is NOT treated as an external module
      external: [], 
    }
  },
  optimizeDeps: {
    include: ['dunder-proto', 'dunder-proto/get']
  }
})