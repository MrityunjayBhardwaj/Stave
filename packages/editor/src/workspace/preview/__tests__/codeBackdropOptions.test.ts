import { afterEach, describe, expect, it } from 'vitest'
import {
  backdropOptionsFor,
  getCodeBackdropOptions,
  getCodeBackdropOptionsVersion,
  retainCodeBackdropOptions,
  setCodeBackdropOptions,
  subscribeCodeBackdropOptions,
} from '../codeBackdropOptions'
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

// #2395 — a pattern's options belong to its open tab: when its last tab closes
// they go, so nothing keeps them for a background drawn later.
describe('retainCodeBackdropOptions — only open patterns keep their options', () => {
  afterEach(() => {
    setCodeBackdropOptions(null, 'song')
    setCodeBackdropOptions(null, 'other')
    setCodeBackdropOptions(null)
  })

  it("drops a closed pattern's options and keeps the open ones'", () => {
    setCodeBackdropOptions({ fileId: 'fold', options: { theme: 'black' } }, 'song')
    setCodeBackdropOptions({ fileId: 'fold', options: { theme: 'white' } }, 'other')
    retainCodeBackdropOptions(['song'])
    expect(getCodeBackdropOptions('song')).toEqual({ fileId: 'fold', options: { theme: 'black' } })
    expect(getCodeBackdropOptions('other')).toBeNull()
    expect(backdropOptionsFor('other', 'fold').codeOptions).toBeNull()
  })

  it('leaves the legacy single slot alone', () => {
    setCodeBackdropOptions({ fileId: 'fold', options: { theme: 'black' } })
    retainCodeBackdropOptions([])
    expect(getCodeBackdropOptions()).toEqual({ fileId: 'fold', options: { theme: 'black' } })
  })

  it('notifies once when something was dropped, and not at all otherwise', () => {
    setCodeBackdropOptions({ fileId: 'fold', options: { theme: 'black' } }, 'song')
    setCodeBackdropOptions({ fileId: 'fold', options: { theme: 'white' } }, 'other')
    let calls = 0
    const un = subscribeCodeBackdropOptions(() => calls++)
    const before = getCodeBackdropOptionsVersion()
    retainCodeBackdropOptions(['song', 'other'])
    expect(calls).toBe(0)
    expect(getCodeBackdropOptionsVersion()).toBe(before)
    retainCodeBackdropOptions([])
    expect(calls).toBe(1)
    expect(getCodeBackdropOptionsVersion()).toBe(before + 1)
    un()
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
