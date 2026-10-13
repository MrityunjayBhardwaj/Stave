import { defineConfig, devices } from '@playwright/test'
import { E2E_BASE_URL, E2E_PORT } from './tests/e2e-target'

/**
 * Specs whose ASSERTION IS A MEASUREMENT of real-time rendering — frames per
 * second, spectral variance across frames, reads/frame, scroll jank, a cost ladder.
 *
 * These cannot be mocked or fast-forwarded: to observe that output VARIES across
 * frames, frames must actually render, at real frame rate, on a real GPU. But
 * Playwright parallelises across FILES (~6 workers on 12 cores) all sharing ONE
 * GPU — so while these measure, five other workers are competing for the exact
 * resource under measurement. The number degrades and the spec goes red, not
 * because the product regressed but because the measurement was taken in a crowded
 * room. Below, they get the machine to themselves.
 *
 * The alternative — widening their thresholds until they stop complaining — would
 * destroy the only thing they exist for.
 *
 * The list is EVIDENCE-BASED, from repeated full-gate runs. Note what is NOT here:
 * `stave.spec.ts` also failed only under load, and looked like a member — but its
 * a11y test simply never waited for the app to render (`h1` count 0). That is a
 * race, not contention, and it was fixed at the source rather than hidden in here.
 * Serialising it would have been treating a spec bug as an infrastructure cost.
 */
/** vitest-only harnesses that match Playwright's default testMatch — never collect. */
const VITEST_ONLY = ['**/parity-corpus/**']

const MEASUREMENT_SPECS = [
  '**/viz-shared-pump-observe.spec.ts', // reads/frame + sample mean, cache on vs off
  '**/strudel-viz-methods.spec.ts', // 26 worker-backed viz mounts; "varies over frames"
  '**/perf-matrix.spec.ts', // the cost ladder (env-gated)
  '**/viz-scroll-jank.spec.ts', // jank: no-viz control vs heavy worker viz (env-gated)
]

/**
 * The port is overridable (`STAVE_E2E_PORT`) so a collision with another project
 * can be stepped around rather than fought. It defaults to 3000, which is what
 * every existing workflow expects; `globalSetup` is what makes reuse safe, not
 * the number.
 *
 * ONE knob, and ONE definition — both deliberate. An earlier draft also took a
 * `STAVE_E2E_BASE_URL`, and a later one re-derived the port inside `globalSetup`
 * from its own copy of the default. Either way the port Playwright MANAGES and
 * the URL the guard VETS can drift apart, and then the check passes while the
 * suite runs somewhere nobody meant. That is the same shape as the bug being
 * guarded, so the target is imported from one module (`tests/e2e-target.ts`).
 */

/**
 * Specs that only mean something under a finger (#2014): `touch-*.spec.ts`. They run on
 * the touch projects below and are kept out of `chromium`, so the desktop suite
 * collects exactly what it did before.
 *
 * What an emulated device IS here: a screen size, a coarse pointer and touch events —
 * enough for the phone rule (`usePhone`) and the `(pointer: coarse)` styles to answer
 * as they do on the device. What it is NOT: an on-screen keyboard, a notch, a real
 * long press, a memory limit, or a browser that refuses audio before a gesture
 * (headless Chromium starts a context by itself — the sound spec says how it gets
 * round that). Those stay as real-device checks.
 */
const TOUCH_SPECS = ['**/touch-*.spec.ts']
/**
 * The touch specs that also run on an iPhone under WebKit: the layout ones. Safari is
 * where most phones will meet the app and it lays out differently from Chromium. The
 * other touch specs lean on things only Chromium was observed to do (the audio
 * stand-in), so they stay off it rather than fail for the wrong reason.
 */
const TOUCH_LAYOUT_SPECS = ['**/touch-shell.spec.ts', '**/touch-panel-sheet.spec.ts', '**/touch-pattern-steps.spec.ts', '**/touch-safe-area.spec.ts', '**/touch-keyboard.spec.ts']

export default defineConfig({
  testDir: './tests',
  /**
   * Prove the server is Stave before the first spec runs (#1155). `webServer`
   * below reuses any listener on the port, and a port is not an identity — an
   * unrelated app answering there produced 15 failed / 0 passed on a spec that
   * is 15 passed / 0 failed against Stave, with the `[data-bottom-panel="root"]`
   * signature the `measurement` note attributes to contention. Without this the
   * two are indistinguishable from the output.
   */
  globalSetup: './tests/global-setup.ts',
  // `tests/parity-corpus/` holds the maintainer-only VITEST harnesses (the parse-
  // parity and edit-coverage measurements). They match Playwright's default
  // testMatch (`*.spec.ts` / `*.test.ts`), so without this a bare
  // `npx playwright test` collects them and dies on `require is not defined in ES
  // module scope` before running a single browser test — which is why the gate
  // could only ever be run one file at a time. They stay out of the browser gate;
  // `pnpm parity` / `pnpm edit:coverage` run them under vitest.
  testIgnore: VITEST_ONLY,
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: E2E_BASE_URL,
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
      // A project-level `testIgnore` REPLACES the top-level one — it does not merge.
      // So the parity-corpus exclusion has to be repeated here, or the vitest-only
      // harnesses get collected again and the gate dies on `require is not defined`
      // before running a single browser test (the #876 breakage, restored by hand).
      testIgnore: [...VITEST_ONLY, ...MEASUREMENT_SPECS, ...TOUCH_SPECS],
    },
    // a phone held upright, the same phone turned sideways, and a tablet (#2014).
    // `devices[...]` carries the browser (Chromium for all three), so none is named here.
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: TOUCH_SPECS },
    { name: 'phone-sideways', use: { ...devices['Pixel 7 landscape'] }, testMatch: TOUCH_SPECS },
    { name: 'tablet', use: { ...devices['Galaxy Tab S4'] }, testMatch: TOUCH_SPECS },
    { name: 'iphone', use: { ...devices['iPhone 14'] }, testMatch: TOUCH_LAYOUT_SPECS },
    {
      name: 'measurement',
      use: { browserName: 'chromium' },
      testMatch: MEASUREMENT_SPECS,
      // Alone on the GPU: never alongside each other…
      workers: 1,
      // …and never alongside the other ~500 tests, which would otherwise run
      // concurrently with this project and re-create the very contention we are
      // removing.
      //
      // ⚠ `dependencies` also means: if the `chromium` project FAILS, this project
      // is SKIPPED ENTIRELY — its 29 tests do not run and are not even reported as
      // skipped. The gate then prints a plausible-looking "375 passed" that is
      // simply a smaller suite. So ALWAYS reconcile the total: if the count is
      // short, tests were dropped, not passed.
      //
      // ⚠ AND THE TOTAL WRITTEN HERE IS THE FIRST THING TO GO STALE. This note
      // said "531 + 29 = 560 (2026-07-20)" and asked the reader to re-check it —
      // nobody did, and by 2026-08-04 the measured figure was 594 + 29 = 623, so
      // the number guarding against a dropped-test run was itself 63 tests adrift
      // (#1062). A stale total does not fail loudly; it quietly makes a short run
      // look normal, which is the exact failure it was written to prevent.
      //
      // So do not trust the figure below — DERIVE it, every time it matters:
      //   npx playwright test --project=chromium --list | tail -1
      //   npx playwright test --project=measurement --list | tail -1   (includes
      //     the chromium dependency, so `measurement` alone is the difference)
      // Last derived 2026-08-04: chromium 594 in 176 files, measurement 29,
      // complete run 623.
      //
      // Also budget for contention: a full parallel run reproducibly reports
      // ~15 failures that pass on a serial re-run of the same files (measured
      // 2026-07-20: 15 failed parallel → 1 failed serial). Most carry the same
      // signature — `[data-bottom-panel="root"]` never appearing, i.e. the app
      // never loaded, several workers deep. Re-run failures serially before
      // treating any of them as a product defect.
      dependencies: ['chromium'],
    },
  ],
  webServer: {
    command: 'pnpm dev',
    port: E2E_PORT,
    env: { PORT: String(E2E_PORT) },
    // Reuse stays ON — booting a dev server per run costs more than it saves.
    // What makes it safe is `globalSetup`, which checks WHOSE server it is
    // rather than only that something answers (#1155).
    reuseExistingServer: true,
    timeout: 30000,
  },
})
