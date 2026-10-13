/**
 * bottomPanelRegistry — module-level singleton registry of tabs that the
 * BottomPanel component renders.
 *
 * Mirrors the activity-bar panel registry shape at
 * `packages/app/src/panels/registry.ts` (DA-05). Idempotent register
 * (re-registering by id REPLACES the existing entry) so a re-mount /
 * hot-reload doesn't double-up tabs.
 *
 * `listBottomPanelTabs()` returns a FRESH array on every call (PV34) so
 * React subscribers using `useMemo([])` or shallow-prop comparison don't
 * go stale on register/unregister.
 *
 * `__resetBottomPanelRegistryForTest` is intentionally NOT exported from
 * the top-level barrel — it's test-internal. Tests import directly from
 * this module path. (Trap 9 — vitest test isolation.)
 *
 * Phase 20-01 PR-A.
 */

import type * as React from 'react'

export interface BottomPanelTab {
  readonly id: string
  /** User-facing tab title. Vocabulary discipline (PV32 / PV35) is the
   *  responsibility of the registering caller — the registry stores
   *  whatever string it's given. */
  readonly title: string
  /** Optional codicon name without the `codicon-` prefix. */
  readonly icon?: string
  /**
   * Tab body. Either a ReactNode rendered directly, or a function that
   * returns one (function form lets a future tab defer expensive mount
   * until first activation). PR-A always uses the ReactNode form.
   */
  readonly content: React.ReactNode | (() => React.ReactNode)
  /**
   * Controls of this tab's own, drawn at the right end of the header row — beside the
   * panel's show/hide button — while this tab is the one showing and the panel is open
   * (#2044: the Pattern tab's side-panel button).
   */
  readonly headerActions?: React.ReactNode
}

type Listener = () => void

const tabs = new Map<string, BottomPanelTab>()
const listeners = new Set<Listener>()

function notify(): void {
  // Listener errors do NOT block other listeners — mirrors irInspector.ts.
  for (const l of listeners) {
    try {
      l()
    } catch {
      /* swallow */
    }
  }
}

/**
 * Register a tab. Idempotent — re-registering by `id` REPLACES the
 * existing entry (matches activity-bar `registerPanel` semantics, lets
 * PR-B re-register `'musical-timeline'` to swap the placeholder for the
 * real component without an explicit unregister).
 *
 * Returns an unsubscribe function that removes the tab IF it's still the
 * registered one (a later replace is the new owner).
 */
export function registerBottomPanelTab(tab: BottomPanelTab): () => void {
  tabs.set(tab.id, tab)
  notify()
  return () => {
    if (tabs.get(tab.id) === tab) {
      tabs.delete(tab.id)
      notify()
    }
  }
}

/** Remove a tab by id. No-op if the id isn't registered. */
export function unregisterBottomPanelTab(id: string): void {
  if (tabs.delete(id)) {
    notify()
  }
}

/**
 * Fresh array of all registered tabs (insertion order). PV34 — never
 * cache between renders without subscribing.
 */
export function listBottomPanelTabs(): readonly BottomPanelTab[] {
  return Array.from(tabs.values())
}

/** Direct lookup by id. */
export function getBottomPanelTab(id: string): BottomPanelTab | undefined {
  return tabs.get(id)
}

/**
 * Subscribe to register / unregister / replace events. Listener fires
 * with no arguments — consumers re-read `listBottomPanelTabs()`.
 */
export function subscribeToBottomPanelTabs(cb: Listener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/**
 * Test-only: reset all module state. NOT exported via the top-level
 * barrel; tests import directly from this module path. Mirrors
 * `__resetCaptureForTest` in `engine/timelineCapture.ts`.
 */
export function __resetBottomPanelRegistryForTest(): void {
  tabs.clear()
  listeners.clear()
}
