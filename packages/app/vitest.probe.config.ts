import { defineConfig } from 'vitest/config'

// Untracked probe config — widens `include` to the inert `_*.spec.ts` probes.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/parity-corpus/**/_*.spec.ts', 'src/**/__tests__/**/_*.spec.ts'],
    exclude: ['node_modules', '.next'],
  },
})
