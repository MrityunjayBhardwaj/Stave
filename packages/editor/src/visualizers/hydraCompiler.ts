import type {
  HydraPatternFn,
  HydraStaveBag,
} from './renderers/HydraVizRenderer'
import { locateVizSyntaxError } from './vizSyntaxError'

/**
 * Compile a `.hydra` source string into a `HydraPatternFn`.
 *
 * User code executes inside `new Function('s', 'stave', code)`:
 *   - `s`      — the hydra synth (audio reactive via `s.a.fft[]`).
 *   - `stave`  — scheduler bag; see `HydraStaveBag`.
 *
 * Kept in its own module (mirroring `p5Compiler.ts`) so unit tests can
 * import it without transitively pulling in `P5VizRenderer` → `p5` →
 * `gifenc`, which vitest's ESM loader can't resolve.
 */
export function compileHydraCode(code: string): HydraPatternFn {
  // Pre-validate syntax synchronously. Mirrors the p5 path — without
  // this, the factory below defers `new Function(code)` until the
  // async `initHydra` chain runs, so a syntax error surfaces via the
  // onError promise callback with an emitFixed already fired from
  // compilePreset's success. Pre-validating keeps emitFixed honest:
  // it only fires when we really have a compilable factory.
  // #2220 — thrown with its line in the user's file, which V8's lacks.
  try {
    new Function('s', 'stave', code)
  } catch (err) {
    throw locateVizSyntaxError(code, err)
  }
  return (s: unknown, stave: HydraStaveBag) => {
    const fn = new Function('s', 'stave', code)
    fn(s, stave)
  }
}

/**
 * `new Function(args, body)` prepends a 2-line header in V8:
 *
 *   function anonymous(s,stave
 *   ) {
 *     <user line 1 lands here on line 3>
 *
 * Hydra adds no body wrapper of its own (unlike p5's `with (p) {}`),
 * so the total offset is just that header. Call-sites that need to
 * translate a wrapped-body line back to a user-file line subtract
 * this value.
 */
export const HYDRA_LINE_OFFSET = 2

/** Mirror of `getP5LineOffset` so consumers can look up by runtime. */
export function getHydraLineOffset(): number {
  return HYDRA_LINE_OFFSET
}
