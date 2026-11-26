// SESSION-SCOPED PROBE CONFIG — untracked, delete before any gate run.
// Same as vitest.config.ts but without the `_*` probe exclusion (#1113).
import { configDefaults, defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@kabelsalat/web': fileURLToPath(
        new URL('./test/stubs/kabelsalat-web.mjs', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: [...configDefaults.exclude],
    server: { deps: { inline: [/@strudel\//] } },
  },
})
