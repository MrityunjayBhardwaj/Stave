/**
 * Strudel's official inline-visualization vocabulary → the Stave renderer
 * id each one maps to. The keys are Strudel's Pattern viz methods (verified
 * against `@strudel/draw` + `@strudel/webaudio` source): `pianoroll`,
 * `punchcard`, `spiral`, `pitchwheel` (draw); `scope`, `tscope`, `fscope`,
 * `spectrum` (webaudio); `wordfall` (draw).
 *
 * Each method is intercepted in BOTH chain forms so pasted Strudel code
 * works out of the gate:
 *   - `._name()` (underscore) → inline viz zone (mini, in-REPL form); inside a
 *     master `all(x => …)` it is the backdrop, having no track to sit under (#2387)
 *   - `.name()`  (non-underscore) → Stave backdrop (the "big"/fullscreen form)
 *
 * Aliases map to the nearest Stave renderer that exists today:
 *   - `tscope` → `scope`     (Strudel itself aliases tscope = scope)
 *   - `punchcard` → `pianoroll` (no PunchcardSketch yet — approximation;
 *      a real punchcard renderer is a tracked follow-up)
 *
 * We deliberately do NOT chain to Strudel's real method: `@strudel/draw`
 * isn't loaded, and the webaudio `scope`/`spectrum`/`fscope` would draw
 * strudel's own fullscreen `#test-canvas` — the very thing Stave avoids.
 *
 * ⚠ ITS OWN MODULE, SO THE STATIC-IR READERS CAN ASK WITHOUT IMPORTING THE ENGINE
 * (#1592). Both chain forms return the pattern they were called on, so none of
 * these changes a hap, and a stepped parameter above one plays exactly what it
 * plays without it (`steppedAutomation.ts`, `leavesTheCycle`). A name added here
 * is a promise to that reader too: the method it installs must return `this`.
 */
export const STRUDEL_VIZ_METHODS: Record<string, string> = {
  pianoroll: 'pianoroll',
  punchcard: 'pianoroll',
  wordfall: 'wordfall',
  scope: 'scope',
  tscope: 'scope',
  fscope: 'fscope',
  spectrum: 'spectrum',
  spiral: 'spiral',
  pitchwheel: 'pitchwheel',
}
