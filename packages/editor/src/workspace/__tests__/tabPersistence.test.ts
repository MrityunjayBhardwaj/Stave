/**
 * tabPersistence — unit tests.
 *
 * Covers the pure helpers (serialize/validate/hydrate/buildDefault) and
 * the localStorage round-trip path. SSR safety is exercised by
 * temporarily nulling out `window` (vitest's jsdom environment provides
 * one by default).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
  SHELL_STATE_KEY_PREFIX,
  SHELL_STATE_VERSION,
  shellStateKeyFor,
  loadShellState,
  saveShellState,
  clearShellState,
  validatePersistedState,
  serializeShellState,
  buildDefaultSnapshot,
  hydrateSnapshot,
  type PersistedShellState,
  type ShellSnapshot,
} from '../tabPersistence'
import type { WorkspaceGroupState } from '../types'

const PROJECT = 'p1'

// jsdom in this repo's vitest config provides a non-functional localStorage
// stub (no setItem / getItem / clear methods — see bottomPanel persistence
// test for the same workaround). Install a Map-backed mock for these tests.
function installMockLocalStorage(): void {
  const store = new Map<string, string>()
  const mock: Storage = {
    get length() { return store.size },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => { store.delete(k) },
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: mock })
}

beforeAll(() => {
  installMockLocalStorage()
})

function group(
  id: string,
  tabs: WorkspaceGroupState['tabs'],
  activeTabId: string | null = tabs[0]?.id ?? null,
  extra: Partial<WorkspaceGroupState> = {},
): WorkspaceGroupState {
  return { id, tabs, activeTabId, ...extra }
}

function snap(
  groups: WorkspaceGroupState[],
  layout: string[][],
  activeGroupId: string,
): ShellSnapshot {
  const map = new Map<string, WorkspaceGroupState>()
  for (const g of groups) map.set(g.id, g)
  return { groups: map, layout, activeGroupId }
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('shellStateKeyFor', () => {
  it('scopes the key by project id', () => {
    expect(shellStateKeyFor('proj-a')).toBe(`${SHELL_STATE_KEY_PREFIX}proj-a:state`)
    expect(shellStateKeyFor('proj-b')).not.toBe(shellStateKeyFor('proj-a'))
  })
})

describe('serializeShellState', () => {
  it('round-trips editor tabs verbatim', () => {
    const s = snap(
      [
        group('g1', [
          { kind: 'editor', id: 't1', fileId: 'f1' },
          { kind: 'editor', id: 't2', fileId: 'f2' },
        ]),
      ],
      [['g1']],
      'g1',
    )
    const out = serializeShellState(s)
    expect(out.version).toBe(SHELL_STATE_VERSION)
    expect(out.groups.g1.tabs).toEqual([
      { kind: 'editor', id: 't1', fileId: 'f1' },
      { kind: 'editor', id: 't2', fileId: 'f2' },
    ])
    expect(out.layout).toEqual([['g1']])
    expect(out.activeGroupId).toBe('g1')
  })

  it('drops preview tabs and preserves preview-flag on editor tabs', () => {
    const s = snap(
      [
        group('g1', [
          { kind: 'editor', id: 't1', fileId: 'f1', preview: true }, // VSCode-style preview editor tab
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { kind: 'preview', id: 't2', fileId: 'fviz', sourceRef: {} as any },
          { kind: 'editor', id: 't3', fileId: 'f3' },
        ]),
      ],
      [['g1']],
      'g1',
    )
    const out = serializeShellState(s)
    expect(out.groups.g1.tabs).toEqual([
      { kind: 'editor', id: 't1', fileId: 'f1', preview: true },
      { kind: 'editor', id: 't3', fileId: 'f3' },
    ])
  })

  it('reassigns activeTabId when the active tab was a preview tab (and dropped)', () => {
    const s = snap(
      [
        group(
          'g1',
          [
            { kind: 'editor', id: 't1', fileId: 'f1' },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { kind: 'preview', id: 't2', fileId: 'fviz', sourceRef: {} as any },
          ],
          't2', // active was the preview tab
        ),
      ],
      [['g1']],
      'g1',
    )
    const out = serializeShellState(s)
    expect(out.groups.g1.activeTabId).toBe('t1')
  })

  it('keeps backgroundFileId', () => {
    const s = snap(
      [
        group(
          'g1',
          [{ kind: 'editor', id: 't1', fileId: 'f1' }],
          't1',
          { backgroundFileId: 'fbg' },
        ),
      ],
      [['g1']],
      'g1',
    )
    expect(serializeShellState(s).groups.g1.backgroundFileId).toBe('fbg')
  })

  it('keeps per-pane backdropOpacity / backdropQuality (#350c)', () => {
    const s = snap(
      [
        group(
          'g1',
          [{ kind: 'editor', id: 't1', fileId: 'f1' }],
          't1',
          { backdropOpacity: 0.4, backdropQuality: 'quarter' },
        ),
      ],
      [['g1']],
      'g1',
    )
    const out = serializeShellState(s).groups.g1
    expect(out.backdropOpacity).toBe(0.4)
    expect(out.backdropQuality).toBe('quarter')
  })

  it('omits per-pane backdrop overrides when absent (→ global default applies)', () => {
    const s = snap(
      [group('g1', [{ kind: 'editor', id: 't1', fileId: 'f1' }], 't1')],
      [['g1']],
      'g1',
    )
    const out = serializeShellState(s).groups.g1
    expect(out.backdropOpacity).toBeUndefined()
    expect(out.backdropQuality).toBeUndefined()
  })
})

describe('validatePersistedState', () => {
  const valid = new Set(['f1', 'f2', 'f3', 'fbg'])

  function good(): PersistedShellState {
    return {
      version: SHELL_STATE_VERSION,
      groups: {
        g1: {
          id: 'g1',
          tabs: [{ kind: 'editor', id: 't1', fileId: 'f1' }],
          activeTabId: 't1',
        },
      },
      layout: [['g1']],
      activeGroupId: 'g1',
    }
  }

  it('returns the same shape on the happy path', () => {
    expect(validatePersistedState(good(), valid)).toMatchObject(good())
  })

  it('returns null for a version mismatch', () => {
    const v0 = { ...good(), version: 0 }
    expect(validatePersistedState(v0, valid)).toBeNull()
  })

  it.each([null, undefined, 42, 'oops', [], {}])(
    'returns null for non-object / malformed input: %p',
    (input) => {
      expect(validatePersistedState(input, valid)).toBeNull()
    },
  )

  it('prunes tabs whose fileId is no longer in the workspace', () => {
    const s: PersistedShellState = {
      ...good(),
      groups: {
        g1: {
          id: 'g1',
          tabs: [
            { kind: 'editor', id: 't1', fileId: 'f1' },
            { kind: 'editor', id: 't2', fileId: 'GONE' },
            { kind: 'editor', id: 't3', fileId: 'f2' },
          ],
          activeTabId: 't2', // was the doomed tab
        },
      },
    }
    const out = validatePersistedState(s, valid)
    expect(out?.groups.g1.tabs).toEqual([
      { kind: 'editor', id: 't1', fileId: 'f1' },
      { kind: 'editor', id: 't3', fileId: 'f2' },
    ])
    // activeTabId reassigned to first remaining tab.
    expect(out?.groups.g1.activeTabId).toBe('t1')
  })

  it('drops backgroundFileId when the file is gone', () => {
    const s: PersistedShellState = {
      ...good(),
      groups: {
        g1: {
          id: 'g1',
          tabs: [{ kind: 'editor', id: 't1', fileId: 'f1' }],
          activeTabId: 't1',
          backgroundFileId: 'GONE',
        },
      },
    }
    expect(validatePersistedState(s, valid)?.groups.g1.backgroundFileId).toBeUndefined()
  })

  it('keeps valid per-pane backdropOpacity / backdropQuality (#350c)', () => {
    const s: PersistedShellState = {
      ...good(),
      groups: {
        g1: {
          id: 'g1',
          tabs: [{ kind: 'editor', id: 't1', fileId: 'f1' }],
          activeTabId: 't1',
          backdropOpacity: 0.25,
          backdropQuality: 'full',
        },
      },
    }
    const g = validatePersistedState(s, valid)?.groups.g1
    expect(g?.backdropOpacity).toBe(0.25)
    expect(g?.backdropQuality).toBe('full')
  })

  it('drops out-of-range / malformed per-pane backdrop overrides (#350c)', () => {
    for (const [opacity, quality] of [
      [2, 'ultra'],
      [-0.5, ''],
      [NaN, 'HALF'],
      ['0.5', 42],
    ] as Array<[unknown, unknown]>) {
      const s = {
        ...good(),
        groups: {
          g1: {
            id: 'g1',
            tabs: [{ kind: 'editor', id: 't1', fileId: 'f1' }],
            activeTabId: 't1',
            backdropOpacity: opacity,
            backdropQuality: quality,
          },
        },
      } as unknown as PersistedShellState
      const g = validatePersistedState(s, valid)?.groups.g1
      expect(g?.backdropOpacity).toBeUndefined()
      expect(g?.backdropQuality).toBeUndefined()
    }
  })

  it('drops layout cells referencing unknown groups and collapses empty columns', () => {
    const s: PersistedShellState = {
      ...good(),
      groups: { g1: good().groups.g1 },
      layout: [['g1'], ['GHOST'], ['g1', 'GHOST']],
      activeGroupId: 'g1',
    }
    const out = validatePersistedState(s, valid)
    expect(out?.layout).toEqual([['g1'], ['g1']])
  })

  it('returns null when the cleaned layout has no live groups', () => {
    const s: PersistedShellState = {
      ...good(),
      groups: { dead: { id: 'dead', tabs: [], activeTabId: null } },
      layout: [['GHOST']], // refers to a group that does exist but layout-only validates against cleanedGroups; GHOST not in groups so column drops; empty layout
      activeGroupId: 'dead',
    }
    // Layout column ['GHOST'] is dropped (not in cleanedGroups) → empty layout → null.
    expect(validatePersistedState(s, valid)).toBeNull()
  })

  it('falls back activeGroupId to first live group when pruned', () => {
    const s: PersistedShellState = {
      ...good(),
      groups: {
        g1: good().groups.g1,
        g2: { id: 'g2', tabs: [], activeTabId: null },
      },
      layout: [['g1'], ['g2']],
      activeGroupId: 'GHOST',
    }
    expect(validatePersistedState(s, valid)?.activeGroupId).toBe('g1')
  })

  it('keeps empty groups present in the layout', () => {
    // Empty groups are LEGAL in the shell (it renders a drop-target
    // placeholder); validation must preserve them.
    const s: PersistedShellState = {
      ...good(),
      groups: {
        g1: good().groups.g1,
        empty: { id: 'empty', tabs: [], activeTabId: null },
      },
      layout: [['g1'], ['empty']],
    }
    const out = validatePersistedState(s, valid)
    expect(out?.groups.empty).toEqual({ id: 'empty', tabs: [], activeTabId: null })
    expect(out?.layout).toEqual([['g1'], ['empty']])
  })
})

describe('buildDefaultSnapshot', () => {
  it('builds a single-group, single-tab snapshot when a fileId is supplied', () => {
    const s = buildDefaultSnapshot('newg', 'fstrudel')
    expect(s.layout).toEqual([['newg']])
    expect(s.activeGroupId).toBe('newg')
    const g = s.groups.get('newg')!
    expect(g.tabs).toEqual([{ kind: 'editor', id: 'tab-fstrudel', fileId: 'fstrudel' }])
    expect(g.activeTabId).toBe('tab-fstrudel')
  })

  it('builds a single empty group when no default file exists', () => {
    const s = buildDefaultSnapshot('newg', null)
    const g = s.groups.get('newg')!
    expect(g.tabs).toEqual([])
    expect(g.activeTabId).toBeNull()
    expect(s.layout).toEqual([['newg']])
  })
})

describe('hydrateSnapshot', () => {
  it('round-trips serialize → hydrate', () => {
    const s = snap(
      [
        group(
          'g1',
          [
            { kind: 'editor', id: 't1', fileId: 'f1' },
            { kind: 'editor', id: 't2', fileId: 'f2' },
          ],
          't2',
          { backgroundFileId: 'fbg' },
        ),
      ],
      [['g1']],
      'g1',
    )
    const out = hydrateSnapshot(serializeShellState(s))
    expect(out.layout).toEqual([['g1']])
    expect(out.activeGroupId).toBe('g1')
    expect(out.groups.get('g1')).toEqual({
      id: 'g1',
      tabs: [
        { kind: 'editor', id: 't1', fileId: 'f1' },
        { kind: 'editor', id: 't2', fileId: 'f2' },
      ],
      activeTabId: 't2',
      backgroundFileId: 'fbg',
    })
  })
})

describe('save / load / clear (localStorage)', () => {
  const valid = new Set(['f1'])
  const s = snap(
    [group('g1', [{ kind: 'editor', id: 't1', fileId: 'f1' }])],
    [['g1']],
    'g1',
  )

  it('round-trips via localStorage', () => {
    saveShellState(PROJECT, s)
    const out = loadShellState(PROJECT, valid)
    expect(out?.groups.g1.tabs).toEqual([
      { kind: 'editor', id: 't1', fileId: 'f1' },
    ])
    expect(out?.activeGroupId).toBe('g1')
  })

  it('returns null when nothing is persisted', () => {
    expect(loadShellState('absent-project', valid)).toBeNull()
  })

  it('returns null when stored JSON is malformed', () => {
    window.localStorage.setItem(shellStateKeyFor(PROJECT), '{not json')
    expect(loadShellState(PROJECT, valid)).toBeNull()
  })

  it('clearShellState removes the entry', () => {
    saveShellState(PROJECT, s)
    clearShellState(PROJECT)
    expect(window.localStorage.getItem(shellStateKeyFor(PROJECT))).toBeNull()
  })

  it('does not throw when localStorage.getItem raises (Safari private mode)', () => {
    const orig = window.localStorage.getItem
    Object.defineProperty(window.localStorage, 'getItem', {
      value: () => {
        throw new Error('quota / private mode')
      },
      configurable: true,
    })
    try {
      expect(loadShellState(PROJECT, valid)).toBeNull()
    } finally {
      Object.defineProperty(window.localStorage, 'getItem', { value: orig, configurable: true })
    }
  })

  it('does not throw when localStorage.setItem raises', () => {
    const orig = window.localStorage.setItem
    Object.defineProperty(window.localStorage, 'setItem', {
      value: () => {
        throw new Error('quota')
      },
      configurable: true,
    })
    try {
      expect(() => saveShellState(PROJECT, s)).not.toThrow()
    } finally {
      Object.defineProperty(window.localStorage, 'setItem', { value: orig, configurable: true })
    }
  })
})

describe('SSR safety (no window)', () => {
  // Simulate SSR by removing window for one call. Restore immediately.
  let origWindow: typeof window | undefined
  beforeEach(() => {
    origWindow = globalThis.window
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window = undefined
  })
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window = origWindow
  })

  it('loadShellState returns null without window', () => {
    expect(loadShellState(PROJECT, new Set())).toBeNull()
  })

  it('saveShellState is a no-op without window', () => {
    expect(() =>
      saveShellState(PROJECT, snap([group('g', [])], [['g']], 'g')),
    ).not.toThrow()
  })

  it('clearShellState is a no-op without window', () => {
    expect(() => clearShellState(PROJECT)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// #2471 — app tabs (a tab the host app draws, e.g. the Community Gallery)
// ---------------------------------------------------------------------------

describe('app tabs (#2471)', () => {
  const GALLERY = new Set(['gallery'])
  const galleryTab = {
    kind: 'app' as const,
    id: 'app-gallery',
    appKey: 'gallery',
    state: { view: 'entry', id: 'e-42', back: [{ view: 'browse' }] },
  }

  it('serializes an app tab with its state, keeping it active', () => {
    const s = snap(
      [group('g1', [{ kind: 'editor', id: 't1', fileId: 'f1' }, galleryTab], 'app-gallery')],
      [['g1']],
      'g1',
    )
    const out = serializeShellState(s)
    expect(out.groups.g1.tabs).toEqual([
      { kind: 'editor', id: 't1', fileId: 'f1' },
      galleryTab,
    ])
    expect(out.groups.g1.activeTabId).toBe('app-gallery')
  })

  it('round-trips through JSON + validate + hydrate with its state intact', () => {
    const s = snap(
      [
        group('g1', [{ kind: 'editor', id: 't1', fileId: 'f1' }]),
        group('g2', [galleryTab], 'app-gallery'),
      ],
      [['g1', 'g2']],
      'g2',
    )
    const wire = JSON.parse(JSON.stringify(serializeShellState(s)))
    const validated = validatePersistedState(wire, new Set(['f1']), GALLERY)
    expect(validated).not.toBeNull()
    const back = hydrateSnapshot(validated!)
    expect(back.groups.get('g2')!.tabs).toEqual([galleryTab])
    expect(back.groups.get('g2')!.activeTabId).toBe('app-gallery')
    expect(back.activeGroupId).toBe('g2')
  })

  it('round-trips through localStorage (save → load with the key known)', () => {
    saveShellState(
      PROJECT,
      snap([group('g1', [galleryTab], 'app-gallery')], [['g1']], 'g1'),
    )
    const loaded = loadShellState(PROJECT, new Set(), GALLERY)
    expect(loaded?.groups.g1.tabs).toEqual([galleryTab])
    expect(loaded?.groups.g1.activeTabId).toBe('app-gallery')
  })

  it('drops an app tab whose key the host does not know, and reassigns the active tab', () => {
    const wire = serializeShellState(
      snap(
        [group('g1', [{ kind: 'editor', id: 't1', fileId: 'f1' }, galleryTab], 'app-gallery')],
        [['g1']],
        'g1',
      ),
    )
    const out = validatePersistedState(wire, new Set(['f1']), new Set(['something-else']))
    expect(out?.groups.g1.tabs).toEqual([{ kind: 'editor', id: 't1', fileId: 'f1' }])
    expect(out?.groups.g1.activeTabId).toBe('t1')
  })

  it('drops app tabs when the caller passes no keys (old callers restore none)', () => {
    saveShellState(PROJECT, snap([group('g1', [galleryTab])], [['g1']], 'g1'))
    const loaded = loadShellState(PROJECT, new Set())
    expect(loaded).not.toBeNull()
    expect(loaded!.groups.g1.tabs).toEqual([])
    expect(loaded!.groups.g1.activeTabId).toBeNull()
  })

  it('keeps one tab per key: a repeated key elsewhere in the layout is dropped', () => {
    const wire = {
      version: SHELL_STATE_VERSION,
      groups: {
        g1: { id: 'g1', tabs: [galleryTab], activeTabId: 'app-gallery' },
        g2: { id: 'g2', tabs: [{ ...galleryTab, id: 'app-gallery-2' }], activeTabId: 'app-gallery-2' },
      },
      layout: [['g1', 'g2']],
      activeGroupId: 'g1',
    }
    const out = validatePersistedState(wire, new Set(), GALLERY)
    expect(out?.groups.g1.tabs).toEqual([galleryTab])
    expect(out?.groups.g2.tabs).toEqual([])
  })

  it('drops malformed app tabs (no id / no key)', () => {
    const wire = {
      version: SHELL_STATE_VERSION,
      groups: {
        g1: {
          id: 'g1',
          tabs: [{ kind: 'app', id: 'x' }, { kind: 'app', appKey: 'gallery' }, { kind: 'app', id: 7, appKey: 'gallery' }],
          activeTabId: null,
        },
      },
      layout: [['g1']],
      activeGroupId: 'g1',
    }
    expect(validatePersistedState(wire, new Set(), GALLERY)?.groups.g1.tabs).toEqual([])
  })

  it('an app tab without state stays without state (no `state: undefined` key)', () => {
    const bare = { kind: 'app' as const, id: 'app-gallery', appKey: 'gallery' }
    const wire = JSON.parse(JSON.stringify(serializeShellState(snap([group('g1', [bare])], [['g1']], 'g1'))))
    const out = validatePersistedState(wire, new Set(), GALLERY)
    expect(out?.groups.g1.tabs).toEqual([bare])
    expect('state' in (out!.groups.g1.tabs[0] as object)).toBe(false)
  })

  it('a layout saved before app tabs existed (editor tabs only, v1) still loads unchanged', () => {
    const legacy = {
      version: 1,
      groups: {
        g1: { id: 'g1', tabs: [{ kind: 'editor', id: 't1', fileId: 'f1', preview: true }], activeTabId: 't1', backgroundFileId: 'f1' },
      },
      layout: [['g1']],
      activeGroupId: 'g1',
    }
    window.localStorage.setItem(shellStateKeyFor(PROJECT), JSON.stringify(legacy))
    expect(loadShellState(PROJECT, new Set(['f1']), GALLERY)).toEqual(legacy)
    // …and with no keys at all, exactly as before.
    expect(loadShellState(PROJECT, new Set(['f1']))).toEqual(legacy)
  })
})
