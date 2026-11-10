/**
 * vizLanguages — the single home for the viz `language` ↔ renderer `kind`
 * correspondence.
 *
 * ## Why this module exists
 *
 * A workspace file's `language` (`'p5js' | 'hydra' | 'glsl'`) maps to a
 * concrete renderer `kind` (`'p5' | 'hydra' | 'glsl'`), and the inverse.
 * Before this module that correspondence was duplicated as inline ternaries
 * and `language === 'p5js' || 'hydra'` allow-list filters across ~13 call
 * sites in the editor and app packages. Adding the GLSL renderer kind (#287)
 * meant threading `'glsl'` through every one of them — and the easily-missed
 * sites were the **filters**: a union-widen forces the type system to make you
 * add a ternary arm, but an allow-list filter compiles fine while silently
 * excluding the new kind, so the feature just no-ops (P118 / PV88 — the
 * named-viz registration filter and the backdrop filters dropped `'glsl'`
 * invisibly to tsc + unit tests; found only by live observation).
 *
 * Consolidating into one helper means:
 *   - the allow-list (`VIZ_LANGUAGES`) has ONE definition every filter calls,
 *     so a new kind can't be silently dropped by a forgotten filter, and
 *   - the maps are exhaustive `Record`s keyed by the renderer union, so a new
 *     renderer kind is a compile error until every arm is added — the next
 *     kind is a 1-line change, not a 13-site scavenger hunt.
 *
 * @see PV88 (the consolidation target), P118 (the silent-drop trap).
 */

import type { WorkspaceLanguage } from './types'
import type { VizPreset } from '../visualizers/vizPreset'

/**
 * The concrete renderer kind a viz file compiles to. Mirror of
 * `VizPreset['renderer']` — kept as a named alias so call sites read
 * intent rather than reaching into the preset shape.
 */
export type VizRendererKind = VizPreset['renderer']

/**
 * The workspace languages that compile to a viz renderer — THE single
 * allow-list. Every "is this a viz file?" filter must derive from this
 * (via {@link isVizLanguage}) so a new viz language can never be silently
 * excluded by a forgotten filter site.
 *
 * `satisfies` (not `as`) keeps each entry checked against
 * `WorkspaceLanguage` while preserving the literal tuple type.
 */
export const VIZ_LANGUAGES = ['p5js', 'hydra', 'glsl', 'three'] as const satisfies readonly WorkspaceLanguage[]

/** Narrowing of `WorkspaceLanguage` to the viz languages. */
export type VizLanguage = (typeof VIZ_LANGUAGES)[number]

/**
 * Language → renderer kind. Exhaustive over `VizLanguage`, so adding a viz
 * language to {@link VIZ_LANGUAGES} forces an arm here at compile time.
 */
const LANGUAGE_TO_RENDERER = {
  p5js: 'p5',
  hydra: 'hydra',
  glsl: 'glsl',
  three: 'three',
} as const satisfies Record<VizLanguage, VizRendererKind>

/**
 * Renderer kind → language. Exhaustive over `VizRendererKind`, so adding a
 * renderer kind to `VizPreset['renderer']` forces an arm here at compile time.
 */
const RENDERER_TO_LANGUAGE = {
  p5: 'p5js',
  hydra: 'hydra',
  glsl: 'glsl',
  three: 'three',
} as const satisfies Record<VizRendererKind, WorkspaceLanguage>

/** True when `lang` is a viz language (compiles to a renderer). */
export function isVizLanguage(lang: WorkspaceLanguage): lang is VizLanguage {
  return (VIZ_LANGUAGES as readonly WorkspaceLanguage[]).includes(lang)
}

/**
 * The renderer kind a workspace `language` compiles to, or `null` when the
 * language is not a viz language. Callers that have already established a
 * viz file (e.g. via {@link isVizLanguage}) typically fall back to `'p5'`.
 */
export function rendererForLanguage(lang: WorkspaceLanguage): VizRendererKind | null {
  return isVizLanguage(lang) ? LANGUAGE_TO_RENDERER[lang] : null
}

/** The workspace language a renderer kind authors as. */
export function languageForRenderer(renderer: VizRendererKind): WorkspaceLanguage {
  return RENDERER_TO_LANGUAGE[renderer]
}
