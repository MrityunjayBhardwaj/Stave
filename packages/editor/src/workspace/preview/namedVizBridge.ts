/**
 * namedVizBridge — compile + register helpers for viz presets.
 *
 * This is the higher-level wrapper that `vizPresetBridge` deliberately
 * avoids being. It imports `compilePreset` (which transitively loads
 * the p5 / hydra renderer stack), so any test or module that wants to
 * stay decoupled from the renderer pack should import from
 * `vizPresetBridge` instead.
 *
 * @remarks
 * ## Why a separate file
 *
 * The plain `vizPresetBridge` is a pure data utility — tests exercise
 * it without mocking the renderer chain. Adding `compilePreset` to its
 * imports broke unit tests by transitively pulling in p5 (which imports
 * gifenc, which fails in vitest's ESM loader). Keeping the compile +
 * register combo in a sibling file that only the app layer / compat
 * shims import preserves the test isolation while still giving
 * consumers a one-line API for "make this preset resolvable by name."
 */

import { compilePreset } from '../../visualizers/vizCompiler'
import {
  registerNamedViz,
  unregisterNamedViz,
} from '../../visualizers/namedVizRegistry'
import type { VizPreset } from '../../visualizers/vizPreset'
import { setVizDescriptorSource } from '../../visualizers/inlineVizWarmup'

/**
 * Compile a preset into a `VizDescriptor` and register it in the
 * `namedVizRegistry` under `preset.name`. Subsequent inline lookups
 * via `resolveDescriptor` (e.g., `.viz("my-preset")`) will resolve to
 * this compiled descriptor.
 *
 * On compile error, unregisters any stale entry for the same name and
 * returns `false`. Returns `true` on successful registration.
 *
 * Callers:
 *   - App layer `StrudelEditorClient` — after seeding bundled presets
 *     and after saving via Ctrl+S, so the user's inline references
 *     keep working across code edits.
 *   - `VizEditor` compat shim — after `seedFromPreset` loads
 *     persisted presets from `VizPresetStore`.
 *
 * Idempotent for same-preset calls: registering the same descriptor
 * twice is a no-op. Registering a DIFFERENT descriptor for the same
 * name replaces the entry (so saves pick up fresh code).
 *
 * `name` defaults to `preset.name` but can be overridden to register
 * under a renderer-qualified key (e.g. `"scope:hydra"`) when two presets
 * share a basename — see the `mode:renderer` convention in
 * `resolveDescriptor`. This keeps the bare mode name reserved for the
 * default renderer instead of last-write-wins between p5 and hydra.
 */
export function registerPresetAsNamedViz(
  preset: VizPreset,
  name: string = preset.name,
): boolean {
  try {
    const descriptor = compilePreset(preset)
    // #2560 — what it was built from, so a re-registration of the SAME code
    // (a re-run of the registration sweep) keeps its warm inline renderer.
    setVizDescriptorSource(
      descriptor,
      JSON.stringify([preset.renderer, preset.code, preset.filePath ?? null, preset.nativeSize ?? null]),
    )
    registerNamedViz(name, descriptor)
    return true
  } catch {
    // Compile error — drop any stale registration so inline lookups
    // don't return a broken descriptor.
    unregisterNamedViz(name)
    return false
  }
}
