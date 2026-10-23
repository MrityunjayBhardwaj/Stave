/**
 * vizPresetBridge — Phase 10.2 Task 06.
 *
 * Two small functions that bridge between the persisted `VizPresetStore`
 * (IndexedDB, Phase 10.1 artifact) and the in-memory `WorkspaceFile` store
 * (Phase 10.2 editing layer). Per CONTEXT S6: the two stores are NOT
 * continuously synced — they're bridged explicitly at tab-creation time
 * and at save-time, and nothing in between.
 *
 *   - `seedFromPreset(preset)` — read a preset and create a WorkspaceFile
 *     with the preset's code. Called by Task 09's viz editor compat shim
 *     on tab open, and by Task 10's app startup sequence when restoring
 *     the open-tab set.
 *
 *   - `flushToPreset(fileId, presetId)` — read the current file content
 *     from the workspace store and write it back to the preset store via
 *     `VizPresetStore.put`. Called by Task 09 when the user hits Ctrl+S
 *     inside a viz editor tab.
 *
 * @remarks
 * ## Why a dedicated bridge module
 *
 * Phase 10.1's `VizEditor.tsx` loads presets directly into its own tab
 * state (`VizEditor.tsx:136-148` today). Post-refactor, that coupling
 * dies — the editor doesn't know about `VizPresetStore`, and the
 * provider doesn't know about the file store beyond its `ctx.file`
 * snapshot. Something has to stitch the two sides at the bookends of a
 * file's lifetime. That something is this file.
 *
 * Both functions are pure data utilities — no React, no UI, no bus
 * subscription. Task 09 (the editor compat shim) mounts them into the
 * Ctrl+S keyboard handler. Task 10 (the app rewire) calls them on
 * startup. This file itself never renders anything.
 *
 * ## Language mapping
 *
 * `VizPreset.renderer` is either `'hydra'` or `'p5'`. `WorkspaceLanguage`
 * is either `'hydra'` or `'p5js'` (the extra `js` comes from the Monaco
 * language id that the p5 editor uses for syntax highlighting, which is
 * `p5js` not `p5`). We map at the boundary — callers don't need to know
 * the quirk.
 *
 * ## File id generation
 *
 * `seedFromPreset` returns the workspace file id so callers can track
 * which file belongs to which preset. The id is derived from the preset
 * id with a `viz:` prefix to avoid collisions with pattern file ids
 * (which use their extension as a hint) and with the bundled-preset
 * prefix. This keeps the two-store bridge visible at a glance in
 * debugging output — `viz:__bundled_piano_roll_hydra__` immediately
 * tells you "this workspace file was seeded from the piano-roll bundled
 * preset."
 *
 * Re-seeding the same preset is safe: `createWorkspaceFile` overwrites
 * the existing entry and notifies subscribers, so the editor view
 * picks up the fresh content on the next render.
 *
 * The `presetId` is stashed in `WorkspaceFile.meta.presetId` as a
 * back-reference so tests and future callers can read it without
 * having to re-parse the file id. The `meta` bag is the documented
 * escape hatch for per-file metadata that doesn't belong on the
 * store's public API.
 */

import { createWorkspaceFile, getFile } from '../WorkspaceFile'
import { VizPresetStore } from '../../visualizers/vizPreset'
import type { VizPreset } from '../../visualizers/vizPreset'
import type { WorkspaceFile, WorkspaceLanguage } from '../types'
import { languageForRenderer, rendererForLanguage } from '../vizLanguages'

/*
 * Auto-registration of presets into `namedVizRegistry` is owned by the
 * consumer (app layer or compat shim), NOT the bridge. Importing
 * `compilePreset` here pulls the full renderer stack (p5 / hydra-synth)
 * into the bridge's module graph, which breaks any test that mocks or
 * stubs the renderer layer — the module transitively fails to load
 * before the mock takes effect. Keeping the bridge pure data lets
 * unit tests of `flushToPreset` / `seedFromPreset` run without the
 * renderer pack.
 *
 * See `workspace/preview/namedVizBridge.ts` for the consumer-facing
 * helper that combines compilation + registration for convenience.
 */

/**
 * Workspace file id derivation from a preset id. Namespaced with `viz:`
 * so that file ids are self-describing in debug output.
 */
export function workspaceFileIdForPreset(presetId: string): string {
  return `viz:${presetId}`
}

/**
 * Map `VizPreset.renderer` to `WorkspaceLanguage`. Exported so tests and
 * the Task 09 shim can assert the mapping directly without going through
 * a full seed.
 */
export function languageForPresetRenderer(
  renderer: VizPreset['renderer'],
): WorkspaceLanguage {
  return languageForRenderer(renderer)
}

/**
 * Seed a `WorkspaceFile` from a `VizPreset`. The file id is derived from
 * the preset id; path is `${preset.name}.${preset.renderer}`; content is
 * the preset code; language is mapped via `languageForPresetRenderer`;
 * `meta.presetId` is set as a back-reference.
 *
 * Returns the workspace file id so callers can push it into a tab
 * descriptor without recomputing it.
 *
 * @remarks
 * ## Why this function is synchronous
 *
 * The caller passes a `VizPreset` object directly — the IndexedDB read
 * happens at the caller's layer (`VizPresetStore.getAll()` at app
 * startup, or `VizPresetStore.get(id)` for a specific preset). Keeping
 * the seed itself synchronous lets the Task 09 compat shim call it
 * inside a React `useEffect` without an async dance, and lets tests
 * exercise it without touching IndexedDB.
 *
 * The async variant — `seedFromPresetId(id)` — is a one-liner on top
 * of this function; see below.
 */
export function seedFromPreset(preset: VizPreset): string {
  const id = workspaceFileIdForPreset(preset.id)
  const path = `${preset.name}.${preset.renderer}`
  const language = languageForPresetRenderer(preset.renderer)
  createWorkspaceFile(id, path, preset.code, language, {
    presetId: preset.id,
  })
  return id
}

/**
 * Async convenience: fetch a preset by id from the IndexedDB-backed
 * `VizPresetStore`, then seed a workspace file from it. Returns the
 * workspace file id, or `undefined` if the preset does not exist.
 *
 * This is the path Task 10 calls on app startup when it needs to hydrate
 * the open-tab set from persisted ids. Tests that want to avoid
 * IndexedDB should use the synchronous `seedFromPreset(preset)` form
 * with an in-memory preset object.
 */
export async function seedFromPresetId(
  presetId: string,
): Promise<string | undefined> {
  const preset = await VizPresetStore.get(presetId)
  if (!preset) return undefined
  return seedFromPreset(preset)
}

/**
 * Read the current content of a workspace file and write it back to the
 * viz preset store. Caller supplies both the file id (identifying which
 * workspace file to flush) and the preset id (identifying which preset
 * entry to overwrite) — these are usually the same up to the `viz:`
 * prefix, but keeping them separate lets a future "save-as" flow write
 * to a different preset id from the file's origin.
 *
 * Returns a promise that resolves once the IndexedDB write completes.
 * On unknown file id the function is a no-op and resolves immediately —
 * the user hitting Ctrl+S on a dead tab should not throw.
 *
 * Updates `updatedAt` to the current time. `createdAt` and `id` are
 * preserved from the existing preset entry to keep persistence stable
 * across saves. If the preset does not yet exist in the store (e.g.,
 * first save of a brand-new file), the preset is created with
 * `createdAt` set to `updatedAt`.
 *
 * @remarks
 * ## Why the caller supplies the preset id
 *
 * `WorkspaceFile.meta.presetId` stores the back-reference (see
 * `seedFromPreset`), but meta is opaque typed (`Record<string,
 * unknown>`) so callers have to read it themselves. Requiring the
 * preset id as an explicit argument removes that bookkeeping from this
 * function and keeps the signature type-safe.
 */
export async function flushToPreset(
  fileId: string,
  presetId: string,
): Promise<void> {
  const file = getFile(fileId)
  if (!file) return

  const existing = await VizPresetStore.get(presetId)
  const now = Date.now()

  // Infer renderer from the file's language so a flush preserves the
  // original renderer even if no preset existed (first-save case).
  const renderer: VizPreset['renderer'] =
    rendererForLanguage(file.language) ?? 'p5'

  const preset: VizPreset = {
    ...existing,               // preserve cropRegion + any future fields
    id: presetId,
    name: existing?.name ?? file.path.replace(/^.*\//, '').replace(/\.[^.]+$/, ''),
    renderer: existing?.renderer ?? renderer,
    code: file.content,
    requires: existing?.requires ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    // Always the file's CURRENT path, so a rename is picked up on the next flush.
    filePath: file.path,
  }

  await VizPresetStore.put(preset)
}

/**
 * Read-only helper: given a workspace file, return the preset id it was
 * seeded from (if any). Useful for tests and for Task 09 when it needs
 * to know whether a tab is backed by a persisted preset.
 */
export function getPresetIdForFile(file: WorkspaceFile): string | undefined {
  const metaId = file.meta?.presetId
  return typeof metaId === 'string' ? metaId : undefined
}
