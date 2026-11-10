import { describe, it, expect } from 'vitest'
import { backdropSourceFor, isOwnBackdropPaused, resolveBackdropFileId, type BackdropSourceRef } from '../backdropPrecedence'

describe('resolveBackdropFileId (#350a per-pane precedence)', () => {
  it('shows nothing when neither layer is set', () => {
    expect(resolveBackdropFileId(undefined, undefined)).toBeUndefined()
  })

  it('shows the manual sticky when there is no code override', () => {
    expect(resolveBackdropFileId('sticky-file', undefined)).toBe('sticky-file')
  })

  it('code override wins over the manual sticky', () => {
    expect(resolveBackdropFileId('sticky-file', 'override-file')).toBe('override-file')
  })

  it('code override shows even with no sticky underneath', () => {
    expect(resolveBackdropFileId(undefined, 'override-file')).toBe('override-file')
  })

  it('dropping the override (undefined) reveals the sticky again — NOT a wipe', () => {
    // The behavior flip at the heart of #350a: when the active program stops
    // declaring a backdrop, the user's manual sticky resurfaces instead of the
    // backdrop going blank (the pre-#350 single-slot model cleared it).
    const sticky = 'user-pinned'
    expect(resolveBackdropFileId(sticky, 'code-scope')).toBe('code-scope') // code playing
    expect(resolveBackdropFileId(sticky, undefined)).toBe(sticky) // code removed → sticky back
  })
})

describe('isOwnBackdropPaused (#2422) — a viz tab pauses only its own background', () => {
  const paused = new Set(['fold'])

  it('pauses the viz file’s own background while it is the pane’s active tab', () => {
    expect(isOwnBackdropPaused('fold', 'fold', paused)).toBe(true)
  })

  it('a pattern pane whose code background is the same viz keeps running', () => {
    expect(isOwnBackdropPaused('fold', 'song', paused)).toBe(false)
  })

  it('a pane with no tab keeps running', () => {
    expect(isOwnBackdropPaused('fold', null, paused)).toBe(false)
  })

  it('a viz that is not paused runs on its own tab too', () => {
    expect(isOwnBackdropPaused('fold', 'fold', new Set())).toBe(false)
    expect(isOwnBackdropPaused('fold', 'fold', new Set(['other']))).toBe(false)
  })
})

describe("backdropSourceFor (#2426) — a background listens to its owner's audio", () => {
  const isPattern = (id: string) => id.endsWith('.strudel')
  const sample: BackdropSourceRef = { kind: 'file', fileId: '__sample__' }
  const chosen = (map: Record<string, BackdropSourceRef>) => (id: string) => map[id]

  it("a pattern's background listens to that pattern, not to a viz's chosen example sound", () => {
    expect(backdropSourceFor('song.strudel', 'probeA', isPattern, chosen({ probeA: sample, probeB: sample }))).toEqual({
      kind: 'file',
      fileId: 'song.strudel',
    })
  })

  it("a viz file's own background listens to the source chosen in its settings", () => {
    expect(backdropSourceFor(null, 'probeB', isPattern, chosen({ probeB: sample }))).toEqual(sample)
  })

  it("…and follows the most recent publisher when nothing (or default) was chosen", () => {
    expect(backdropSourceFor(null, 'probeB', isPattern, chosen({}))).toEqual({ kind: 'default' })
    expect(backdropSourceFor(null, 'probeB', isPattern, chosen({ probeB: { kind: 'default' } }))).toEqual({ kind: 'default' })
  })

  it("another viz's chosen source does not reach this one", () => {
    expect(backdropSourceFor(null, 'probeB', isPattern, chosen({ probeA: sample }))).toEqual({ kind: 'default' })
  })

  it("a viz pinned behind a non-pattern tab uses that viz's own choice", () => {
    expect(backdropSourceFor('other.p5', 'probeB', isPattern, chosen({ probeB: { kind: 'none' } }))).toEqual({ kind: 'none' })
  })
})
