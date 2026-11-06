import { afterEach, describe, expect, it } from 'vitest'
import { backdropOptionsFor, getCodeBackdropOptions, setCodeBackdropOptions } from '../codeBackdropOptions'
import { backdropOwnerFor } from '../../backdropPrecedence'

// #2423 — a background belongs to a file: a pattern's background takes that
// pattern's code options; a viz file's own background takes none, even when both
// draw the same viz file.
describe('code background options belong to the pattern that declares them', () => {
  afterEach(() => {
    setCodeBackdropOptions(null, 'song')
    setCodeBackdropOptions(null, 'other')
    setCodeBackdropOptions(null)
  })

  it("the pattern's background gets its code options", () => {
    setCodeBackdropOptions({ fileId: 'fold', options: { theme: 'black' } }, 'song')
    expect(backdropOptionsFor('song', 'fold')).toEqual({ codeOptions: { theme: 'black' }, busOptions: false })
  })

  it("the viz file's OWN background gets neither the pattern's options nor the bus's", () => {
    setCodeBackdropOptions({ fileId: 'fold', options: { theme: 'black' } }, 'song')
    expect(backdropOptionsFor(null, 'fold')).toEqual({ codeOptions: null, busOptions: false })
  })

  it("another pattern's background is not given this pattern's options", () => {
    setCodeBackdropOptions({ fileId: 'fold', options: { theme: 'black' } }, 'song')
    expect(backdropOptionsFor('other', 'fold').codeOptions).toBeNull()
    setCodeBackdropOptions({ fileId: 'fold', options: { theme: 'white' } }, 'other')
    expect(backdropOptionsFor('other', 'fold').codeOptions).toEqual({ theme: 'white' })
    expect(backdropOptionsFor('song', 'fold').codeOptions).toEqual({ theme: 'black' })
  })

  it('options for another viz file do not apply', () => {
    setCodeBackdropOptions({ fileId: 'fold', options: { theme: 'black' } }, 'song')
    expect(backdropOptionsFor('song', 'scope').codeOptions).toBeNull()
  })

  it('a host that does not say whose background it is keeps the legacy single slot and the bus', () => {
    setCodeBackdropOptions({ fileId: 'fold', options: { theme: 'black' } })
    expect(backdropOptionsFor(undefined, 'fold')).toEqual({ codeOptions: { theme: 'black' }, busOptions: true })
    expect(getCodeBackdropOptions('song')).toBeNull()
  })
})

describe('backdropOwnerFor — whose background a pane draws', () => {
  it("a viz pane drawing its own file: the viz's own (null)", () => {
    expect(backdropOwnerFor('fold', 'fold')).toBeNull()
  })
  it("a pattern pane drawing that viz: the pattern's", () => {
    expect(backdropOwnerFor('fold', 'song')).toBe('song')
  })
  it('no tab: the viz’s own', () => {
    expect(backdropOwnerFor('fold', null)).toBeNull()
  })
})
