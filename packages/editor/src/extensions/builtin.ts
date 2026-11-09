/**
 * The extensions that ship with Stave (#2507: Stave's own only, for now).
 *
 * Each entry is a manifest whose `load` is a dynamic import, so an extension's code is
 * fetched only when someone switches it on. The voice (#2500) and Vim keybindings (#2148)
 * join this list in their own stages. Extensions by other people are a later piece of
 * work, following VS Code's model, and are not loaded from here.
 */
import type { ExtensionManifest } from './types'

export const BUILTIN_EXTENSIONS: readonly ExtensionManifest[] = []
