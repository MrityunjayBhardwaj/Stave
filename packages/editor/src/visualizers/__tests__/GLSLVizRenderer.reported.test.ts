/**
 * #2210 — a GLSL error the renderer writes to the Console is written once.
 *
 * The renderer writes its own row (it alone maps the info-log line back
 * through the wrapper), then calls onError. The error carries a mark so the
 * host's onError knows it is already in the Console.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { GLSLVizRenderer } from '../renderers/GLSLVizRenderer'
import { isReportedVizError } from '../reportedVizErrors'
import { __resetEngineLogForTests, getLogHistory } from '../../engine/engineLog'

beforeEach(() => { __resetEngineLogForTests() })

describe('GLSLVizRenderer — the errors it reports itself', () => {
  it('writes one row named by its file, and marks the error it hands to onError', () => {
    const errors: Error[] = []
    // jsdom has no WebGL2, so the mount fails inside the renderer's own catch
    new GLSLVizRenderer('void mainImage(out vec4 c, in vec2 p) { c = vec4(1.0); }', 'viz_lib/Prism/Prism.glsl')
      .mount(document.createElement('div'), {}, { w: 100, h: 100 }, (e) => errors.push(e))
    expect(errors).toHaveLength(1)
    expect(getLogHistory().map((e) => [e.runtime, e.source])).toEqual([['glsl', 'viz_lib/Prism/Prism.glsl']])
    expect(isReportedVizError(errors[0])).toBe(true)
  })

  it('an error it did not write is not marked', () => {
    expect(isReportedVizError(new Error('WebGL2 not available'))).toBe(false)
  })
})
