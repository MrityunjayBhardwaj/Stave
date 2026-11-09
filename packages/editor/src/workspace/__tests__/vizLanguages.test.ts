import { describe, it, expect } from 'vitest'
import {
  VIZ_LANGUAGES,
  isVizLanguage,
  rendererForLanguage,
  languageForRenderer,
} from '../vizLanguages'
import type { WorkspaceLanguage } from '../types'

describe('vizLanguages — the single language↔renderer home', () => {
  it('VIZ_LANGUAGES is exactly the four viz languages', () => {
    expect([...VIZ_LANGUAGES].sort()).toEqual(['glsl', 'hydra', 'p5js', 'three'])
  })

  it('isVizLanguage is true for viz languages, false for non-viz', () => {
    expect(isVizLanguage('p5js')).toBe(true)
    expect(isVizLanguage('hydra')).toBe(true)
    expect(isVizLanguage('glsl')).toBe(true)
    expect(isVizLanguage('three')).toBe(true)
    expect(isVizLanguage('strudel')).toBe(false)
    expect(isVizLanguage('sonicpi')).toBe(false)
    expect(isVizLanguage('markdown')).toBe(false)
  })

  it('rendererForLanguage maps each viz language to its renderer kind', () => {
    expect(rendererForLanguage('p5js')).toBe('p5')
    expect(rendererForLanguage('hydra')).toBe('hydra')
    expect(rendererForLanguage('glsl')).toBe('glsl')
    expect(rendererForLanguage('three')).toBe('three')
  })

  it('rendererForLanguage returns null for non-viz languages', () => {
    expect(rendererForLanguage('strudel')).toBeNull()
    expect(rendererForLanguage('markdown')).toBeNull()
  })

  it('languageForRenderer is the inverse of rendererForLanguage', () => {
    expect(languageForRenderer('p5')).toBe('p5js')
    expect(languageForRenderer('hydra')).toBe('hydra')
    expect(languageForRenderer('glsl')).toBe('glsl')
    expect(languageForRenderer('three')).toBe('three')
  })

  it('round-trips language → renderer → language for every viz language', () => {
    for (const lang of VIZ_LANGUAGES) {
      const renderer = rendererForLanguage(lang)
      expect(renderer).not.toBeNull()
      expect(languageForRenderer(renderer!)).toBe(lang)
    }
  })

  it('glsl is NOT silently dropped — the P118/PV88 regression guard', () => {
    // The bug this whole consolidation closes: a viz language excluded
    // from the allow-list filter no-ops silently (type-safe). Assert glsl
    // is a first-class member so a future kind can't regress here unseen.
    const langs: WorkspaceLanguage[] = ['p5js', 'hydra', 'glsl', 'strudel', 'markdown']
    expect(langs.filter(isVizLanguage)).toEqual(['p5js', 'hydra', 'glsl'])
  })
})
