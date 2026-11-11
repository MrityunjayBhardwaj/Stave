/**
 * The extensions that ship with Stave (#2507: Stave's own only, for now).
 *
 * Each entry is a manifest whose `load` is a dynamic import, so an extension's code is
 * fetched only when someone switches it on. The voice (#2500) and Vim keybindings (#2148)
 * join this list in their own stages. Extensions by other people are a later piece of
 * work, following VS Code's model, and are not loaded from here.
 */
import { E2E_TONE } from './e2eTone'
import type { ExtensionManifest } from './types'

export const BUILTIN_EXTENSIONS: readonly ExtensionManifest[] = []

const WITH_E2E: readonly ExtensionManifest[] = [...BUILTIN_EXTENSIONS, E2E_TONE]

/** Is this page an end-to-end run? The Playwright specs set the flag before any page script. */
function isEndToEndRun(): boolean {
  return (globalThis as { __STAVE_E2E__?: unknown }).__STAVE_E2E__ === true
}

/**
 * The extensions this page lists (#2511): what the page runtime switches on and what the
 * Extensions view shows, so the two can never disagree. It is `BUILTIN_EXTENSIONS`, plus
 * one test-only extension (`e2eTone.ts`) in an end-to-end run, never for a real user.
 * The same array each call while the flag is unchanged.
 */
export function listedExtensions(): readonly ExtensionManifest[] {
  return isEndToEndRun() ? WITH_E2E : BUILTIN_EXTENSIONS
}
