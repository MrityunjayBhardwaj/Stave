/**
 * Whether the bottom panel is open, and on which tab — held where more than the
 * panel itself can read and set it (#2002).
 *
 * This lived in `BottomPanel`'s own state. That was enough while the panel's header
 * was the only thing that opened it or switched its tab. A phone held sideways has no
 * room for that header: its four-way switch is in the app's top bar, a different
 * component in a different package, and it has to say "show the Mixer" to a panel it
 * does not render. Two places in the app were already reading the answer back out of
 * localStorage on a timer because nothing told them when it changed.
 *
 * So: one module-level store, the same shape as `bottomPanelRegistry` beside it.
 * The panel reads it, and anything else may. Every change is saved as it is made, to
 * the same localStorage keys as before, so what a user left open is still open.
 *
 * The HEIGHT stays in `BottomPanel`: it is a drag in progress for most of its life,
 * and nothing outside the panel asks for it.
 */
import * as React from 'react'

import {
  readPersistedActiveTabId,
  readPersistedOpen,
  writePersistedActiveTabId,
  writePersistedOpen,
} from './persistence'

export interface BottomPanelState {
  readonly open: boolean
  /** the tab last chosen; `null` until one is, and it may name a tab no longer registered */
  readonly activeTabId: string | null
}

type Listener = () => void

const SERVER_STATE: BottomPanelState = { open: false, activeTabId: null }

/** `null` until first asked for: localStorage is read once, on the client, when needed */
let state: BottomPanelState | null = null
const listeners = new Set<Listener>()

function current(): BottomPanelState {
  if (state === null) state = { open: readPersistedOpen(), activeTabId: readPersistedActiveTabId() }
  return state
}

function commit(next: BottomPanelState): void {
  state = next
  for (const l of listeners) {
    try {
      l()
    } catch {
      /* one listener's error does not stop the others — as in bottomPanelRegistry */
    }
  }
}

/** The state right now. The same object until something changes. */
export function getBottomPanelState(): BottomPanelState {
  return current()
}

export function setBottomPanelOpen(open: boolean): void {
  const now = current()
  if (now.open === open) return
  writePersistedOpen(open)
  commit({ ...now, open })
}

export function setBottomPanelActiveTab(activeTabId: string | null): void {
  const now = current()
  if (now.activeTabId === activeTabId) return
  writePersistedActiveTabId(activeTabId)
  commit({ ...now, activeTabId })
}

/** Open the panel on a tab, in one change: what a tab's button, or a switch elsewhere, does. */
export function showBottomPanelTab(activeTabId: string): void {
  const now = current()
  if (now.open && now.activeTabId === activeTabId) return
  writePersistedOpen(true)
  writePersistedActiveTabId(activeTabId)
  commit({ open: true, activeTabId })
}

export function subscribeToBottomPanelState(cb: Listener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useBottomPanelState(): BottomPanelState {
  return React.useSyncExternalStore(subscribeToBottomPanelState, getBottomPanelState, () => SERVER_STATE)
}

/**
 * Test-only: forget everything, so the next read takes localStorage afresh — what a
 * page load does. Not exported from the package's entry.
 */
export function __resetBottomPanelStateForTest(): void {
  state = null
  listeners.clear()
}
