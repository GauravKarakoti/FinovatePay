import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

// Helper to safely resolve the path without crashing the build
const safeResolve = (name) => {
  try {
    return require.resolve(name)
  } catch (e) {
    console.warn(`Could not resolve ${name} during config load. Ensure it is installed.`)
    return name
  }
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      /**
       * We use the bare specifier for the alias key.
       * The value points to the actual file resolved via Node's logic.
       */
      'dunder-proto/get': safeResolve('dunder-proto/get'),
      'dunder-proto/set': safeResolve('dunder-proto/set'),
    }
  },
  build: {
    commonjsOptions: {
      // Ensure these transitive CJS dependencies are transformed
      include: [/dunder-proto/, /node_modules/],
      transformMixedEsModules: true
    }
  },
  optimizeDeps: {
    // Force pre-bundling for these utilities
    include: ['dunder-proto', 'dunder-proto/get', 'dunder-proto/set']
  }
})