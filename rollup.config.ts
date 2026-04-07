import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

const config = {
  input: 'src/index.ts',
  output: {
    esModule: true,
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true
  },
  plugins: [typescript(), nodeResolve({ preferBuiltins: true }), commonjs()],
  onwarn(warning, warn) {
    // @actions/core has an internal circular dependency (core.js <-> oidc-utils.js)
    // that is harmless but noisy. Suppress it.
    if (warning.code === 'CIRCULAR_DEPENDENCY') return
    // @actions/core CJS files use `this` at top-level which gets rewritten to undefined in ESM.
    // This is safe because the __awaiter pattern handles it gracefully.
    if (warning.code === 'THIS_IS_UNDEFINED') return
    warn(warning)
  }
}

export default config
