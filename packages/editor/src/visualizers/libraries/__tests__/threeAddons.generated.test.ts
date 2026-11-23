/**
 * #2638 — the addon table is generated from three's own folder. Re-derive it
 * and fail when the committed file is stale (a three.js upgrade, a hand edit).
 * Regenerate with `node scripts/gen-three-addons.mjs` in packages/editor.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
// @ts-expect-error — a plain .mjs script, no types
import { deriveThreeAddons, renderGenerated, GENERATED_PATH } from '../../../../scripts/gen-three-addons.mjs'
import { THREE_ADDON_LOADERS, THREE_ADDONS_LEFT_OUT } from '../threeAddons.generated'

describe('threeAddons.generated', () => {
  it('matches what three.js ships (regenerate with scripts/gen-three-addons.mjs)', async () => {
    const derived = await deriveThreeAddons()
    expect(fs.readFileSync(GENERATED_PATH, 'utf8')).toBe(renderGenerated(derived))
    // Every file is either an addon or left out with a reason: none disappears.
    expect(Object.keys(THREE_ADDON_LOADERS).length + Object.keys(THREE_ADDONS_LEFT_OUT).length).toBe(derived.examined)
  })

  it("includes Spark's Pass.js and every addon the old fixed list had", () => {
    const before = [
      'environments/RoomEnvironment.js', 'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js',
      'postprocessing/ShaderPass.js', 'postprocessing/OutputPass.js', 'postprocessing/UnrealBloomPass.js',
      'postprocessing/BokehPass.js', 'postprocessing/AfterimagePass.js', 'postprocessing/FilmPass.js',
      'postprocessing/GlitchPass.js', 'postprocessing/SMAAPass.js', 'postprocessing/FXAAPass.js', 'shaders/CopyShader.js',
      'shaders/FXAAShader.js', 'shaders/RGBShiftShader.js', 'shaders/VignetteShader.js', 'loaders/GLTFLoader.js',
      'loaders/RGBELoader.js', 'loaders/HDRLoader.js', 'loaders/EXRLoader.js', 'geometries/RoundedBoxGeometry.js',
      'utils/BufferGeometryUtils.js', 'math/SimplexNoise.js', 'math/ImprovedNoise.js',
    ]
    for (const p of [...before, 'postprocessing/Pass.js']) expect(THREE_ADDON_LOADERS, p).toHaveProperty([p])
  })

  it('leaves a file out only for a stated reason', () => {
    expect(THREE_ADDONS_LEFT_OUT['loaders/TTFLoader.js']).toMatch(/imports a module from a URL/)
    expect(THREE_ADDONS_LEFT_OUT['libs/draco/draco_decoder.js']).toMatch(/classic script/)
    expect(THREE_ADDONS_LEFT_OUT['offscreen/offscreen.js']).toMatch(/worker's entry script/)
    expect(THREE_ADDONS_LEFT_OUT['Addons.js']).toMatch(/imports three\/addons\/loaders\/TTFLoader\.js/)
    // GLTFLoader names a URL only in a comment: it is an addon, not left out.
    expect(THREE_ADDONS_LEFT_OUT).not.toHaveProperty(['loaders/GLTFLoader.js'])
  })
})
