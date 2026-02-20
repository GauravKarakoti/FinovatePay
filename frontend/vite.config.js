import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { createRequire } from 'module'

// createRequire allows us to use require.resolve in an ESM config
const require = createRequire(import.meta.url)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      /**
       * FINAL FIX:
       * We use require.resolve on 'dunder-proto/get' (WITHOUT .js).
       * This uses the package's internal export map to find the correct file 
       * and returns the absolute path for the bundler, bypassing ENOENT issues.
       */
      'dunder-proto/get': require.resolve('dunder-proto/get'),
      'dunder-proto/set': require.resolve('dunder-proto/set'),
    }
  },
  build: {
    commonjsOptions: {
      // Ensure these transitive CJS dependencies are transformed for the browser
      include: [/dunder-proto/, /node_modules/],
      transformMixedEsModules: true
    },
    rollupOptions: {
      // Ensure the wallet-sdk dependencies are NOT treated as external
      external: [], 
    }
  },
  optimizeDeps: {
    include: ['dunder-proto', 'dunder-proto/get', 'dunder-proto/set']
  }
})