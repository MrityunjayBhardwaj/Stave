/**
 * #2571 — the GL side of the notes texture: uploaded when the feed's version
 * moves, not every frame. A recording stand-in for the WebGL2 context (the
 * real pipeline, shader and pixels are checked in the browser).
 */
import { describe, it, expect } from 'vitest'
import { createGLSLProgram } from '../renderers/glslCore'
import { GLSLNoteFeed, STAVE_MAX_NOTES } from '../renderers/glslNotes'

/** A WebGL2 stand-in: every call succeeds and is recorded; constants are their
 *  own names, so a call's arguments read back plainly. */
function recordingGL(uniformNames: ReadonlySet<string>) {
  const calls: Array<[string, unknown[]]> = []
  const gl = new Proxy({} as Record<string | symbol, unknown>, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined
      if (/^[A-Z0-9_]+$/.test(prop)) return prop // e.g. gl.FLOAT → 'FLOAT'
      return (...args: unknown[]) => {
        calls.push([prop, args])
        if (prop === 'getShaderParameter' || prop === 'getProgramParameter') return true
        if (prop === 'getUniformLocation') return uniformNames.has(args[1] as string) ? { name: args[1] } : null
        if (prop === 'getShaderInfoLog' || prop === 'getProgramInfoLog') return ''
        return {}
      }
    },
  })
  return { gl: gl as unknown as WebGL2RenderingContext, calls }
}

const SRC = 'void mainImage(out vec4 c, in vec2 p) { c = vec4(float(uNoteCount)); }'
const STATE = { width: 4, height: 4, timeMs: 0 }
const noteUploads = (calls: Array<[string, unknown[]]>) =>
  calls.filter(([n, a]) => n === 'texSubImage2D' && a.includes('FLOAT'))

describe('GLSLProgram — the notes texture (#2571)', () => {
  it('uploads once per feed version, not once per frame', () => {
    const { gl, calls } = recordingGL(new Set(['uNotes', 'uNoteCount', 'uNow', 'uCps']))
    const program = createGLSLProgram(gl, SRC)
    expect(program.readsNotes).toBe(true)
    // allocated as RGBA32F STAVE_MAX_NOTES × 2, NEAREST
    const alloc = calls.find(([n, a]) => n === 'texImage2D' && a.includes('RGBA32F'))
    expect(alloc?.[1]).toEqual(['TEXTURE_2D', 0, 'RGBA32F', STAVE_MAX_NOTES, 2, 0, 'RGBA', 'FLOAT', null])
    expect(calls.some(([n, a]) => n === 'texParameteri' && a[2] === 'NEAREST')).toBe(true)

    const feed = new GLSLNoteFeed()
    feed.update([{ begin: 1, end: 2, midi: 60 }], 1, 1.5, 0.5, [])
    program.draw(null, STATE, undefined, undefined, feed)
    program.draw(null, STATE, undefined, undefined, feed)
    feed.update([{ begin: 1, end: 2, midi: 60 }], 1, 1.6, 0.5, []) // same window
    program.draw(null, STATE, undefined, undefined, feed)
    expect(noteUploads(calls)).toHaveLength(1)
    expect(program.notesUploads).toBe(1)

    feed.update([], 2, 1.7, 0.5, []) // the window changed
    program.draw(null, STATE, undefined, undefined, feed)
    expect(noteUploads(calls)).toHaveLength(2)

    // now/cps/count are per-frame uniforms
    const u1f = calls.filter(([n, a]) => n === 'uniform1f' && (a[0] as { name?: string })?.name === 'uNow')
    expect(u1f.at(-1)?.[1][1]).toBe(1.7)
    const cnt = calls.filter(([n, a]) => n === 'uniform1i' && (a[0] as { name?: string })?.name === 'uNoteCount')
    expect(cnt.at(-1)?.[1][1]).toBe(0)
    // uNotes samples unit 1 (unit 0 is iChannel0)
    const unit = calls.filter(([n, a]) => n === 'uniform1i' && (a[0] as { name?: string })?.name === 'uNotes')
    expect(unit.at(-1)?.[1][1]).toBe(1)
  })

  it('a shader that reads no notes gets no notes texture', () => {
    const { gl, calls } = recordingGL(new Set(['iTime']))
    const program = createGLSLProgram(gl, 'void mainImage(out vec4 c, in vec2 p) { c = vec4(iTime); }')
    expect(program.readsNotes).toBe(false)
    expect(calls.some(([n, a]) => n === 'texImage2D' && a.includes('RGBA32F'))).toBe(false)
  })
})
