/**
 * tabPersistence — SSR-safe localStorage helpers for the WorkspaceShell's
 * full layout snapshot (groups + tabs + per-group active + 2-D pane
 * layout + active group).
 *
 * Mirrors the shape and discipline of `bottomPanel/persistence.ts`:
 *   - Readers MUST be safe to call from a `useState` initializer (no DOM
 *     access without the `typeof window !== 'undefined'` guard, no throws
 *     on Safari private mode where `localStorage.getItem` raises).
 *   - Constants are exported so Playwright assertions can reference the
 *     canonical key names.
 *   - Pure helpers for everything not localStorage-bound, so the shell
 *     and tests can exercise validation without a real storage layer.
 *
 * @remarks
 * ## Scope (issue #175)
 *
 * Persist the full shell state per project — every group's tab set +
 * order, each group's active tab id, the 2-D pane layout (split groups),
 * the active group id, and per-group `backgroundFileId`. On reload, the
 * shell hydrates from this snapshot; on every shell-state change, the
 * snapshot is rewritten.
 *
 * **What's NOT persisted (deliberate):**
 *   - **Preview tabs.** Preview tabs are transient by design (VSCode
 *     parity — open another file in preview mode and the preview slot
 *     replaces). Persisting them would resurrect "stale ghosts" the user
 *     never explicitly pinned. They're filtered out at serialize-time;
 *     editor tabs go through verbatim.
 *   - **History tabs.** A commit can be pruned between sessions.
 *   - **Drag/hover/scroll UI state.** Per-frame state isn't a preference.
 *
 * **App tabs ARE persisted (#2471)** — `kind: 'app'` with its `appKey` and
 * the small JSON `state` the host keeps on it (the gallery remembers where
 * you were across reloads). On read, an app tab whose `appKey` the host does
 * not list in `validAppKeys` is dropped (a key the app no longer has would be
 * a ghost), as is a second tab with an already-seen key (one tab per key).
 *
 * ## Validation on read
 *
 * Persisted state can drift from reality between sessions: a tab's
 * `fileId` may have been deleted in the file tree; a group id in the
 * layout may have been removed; the schema may have changed. The reader
 * validates against the current workspace file list and returns
 * `null` when nothing usable remains (caller falls back to
 * `buildDefaultSnapshot`). This keeps the "if persistence is bad, give
 * the user a sane fresh state" path obvious instead of crashing the
 * shell on a stale fileId.
 *
 * ## Versioning
 *
 * Persisted blobs carry a `version` field so future schema changes can
 * either migrate or fall back without throwing. v1 is the current shape.
 * Mismatched versions return `null` — the user loses tab state once, the
 * shell rebuilds the default, and forward writes use the new version.
 *
 * App tabs (#2471) were added WITHOUT a version bump, on purpose: the change
 * is additive in both directions. An older blob (editor tabs only) reads
 * unchanged. A newer blob read by an older build loses only its app tabs —
 * the v1 reader has always skipped any tab whose kind is not `editor` and
 * reassigned an active id that pointed at one. A bump would instead have
 * wiped every user's saved layout once, for no gain.
 *
 * ## Key shape
 *
 *     stave:workspace:${projectId}:state
 *
 * Project-scoped via `projectId`. The active project is the unit of
 * persistence — switching projects remounts the editor (StaveApp keys by
 * `activeProject.id`) so the shell sees a fresh hydration each time.
 */

import type { GroupLayout } from './groupLayout'
import type { AppTabState, WorkspaceTab, WorkspaceGroupState } from './types'
import type { BackdropQuality } from './editorRegistry'

/** Validate a persisted per-pane backdrop opacity — a finite number in [0, 1]. */
function validBackdropOpacity(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined
}

/** Validate a persisted per-pane backdrop quality tier. */
function validBackdropQuality(v: unknown): BackdropQuality | undefined {
  return v === 'full' || v === 'half' || v === 'quarter' ? v : undefined
}

/**
 * Canonical localStorage key prefix. Per-project keys append `:${projectId}:state`.
 * Exported so Playwright/integration tests can clear or inspect persisted
 * state without hard-coding the format.
 */
export const SHELL_STATE_KEY_PREFIX = 'stave:workspace:'

/** Schema version of the persisted snapshot. Bump on breaking changes. */
export const SHELL_STATE_VERSION = 1

/** Build the full localStorage key for a project. */
export function shellStateKeyFor(projectId: string): string {
  return `${SHELL_STATE_KEY_PREFIX}${projectId}:state`
}

/**
 * The shape stored in localStorage. JSON-friendly — readonly markers
 * from the source types are dropped because JSON has no concept of
 * "mutable vs not."
 */
export interface PersistedShellState {
  readonly version: typeof SHELL_STATE_VERSION
  readonly groups: Record<string, PersistedGroup>
  /** 2-D pane layout: columns × cells, each cell is a group id. */
  readonly layout: readonly (readonly string[])[]
  readonly activeGroupId: string
}

export interface PersistedGroup {
  readonly id: string
  /** Editor and app tabs. Preview / history tabs are dropped at write-time. */
  readonly tabs: readonly PersistedTab[]
  readonly activeTabId: string | null
  readonly backgroundFileId?: string
  /** Per-pane backdrop opacity override (#350c). Absent → global default. */
  readonly backdropOpacity?: number
  /** Per-pane backdrop quality override (#350c). Absent → global default. */
  readonly backdropQuality?: BackdropQuality
}

export interface PersistedEditorTab {
  readonly kind: 'editor'
  readonly id: string
  readonly fileId: string
  /** Optional in V1 — preview-state-for-an-editor-tab survives across reloads
   *  because it's part of the user's working set, not the transient preview slot. */
  readonly preview?: boolean
}

/** #2471 — an app-drawn tab, with the small JSON state its host keeps on it. */
export interface PersistedAppTab {
  readonly kind: 'app'
  readonly id: string
  readonly appKey: string
  readonly state?: AppTabState
}

/** A tab as stored in the persisted layout. */
export type PersistedTab = PersistedEditorTab | PersistedAppTab

/**
 * Snapshot the shell hands to `saveShellState` — same shape the shell's
 * internal state holds. Slimmer than `PersistedShellState` because it
 * uses `Map` and the source `WorkspaceTab` union (with preview tabs the
 * serializer filters out).
 */
export interface ShellSnapshot {
  readonly groups: ReadonlyMap<string, WorkspaceGroupState>
  readonly layout: GroupLayout
  readonly activeGroupId: string
}

// ---------------------------------------------------------------------------
// Read path
// ---------------------------------------------------------------------------

/** #2471 — default for callers that name no app keys: no app tab survives a read. */
const NO_APP_KEYS: ReadonlySet<string> = new Set()

/**
 * Read the persisted shell state for this project, validate it against
 * the live workspace file list, and return the cleaned snapshot — or
 * `null` if there is no usable state (no key, malformed JSON, schema
 * mismatch, or no live tabs remained after validation).
 *
 * `validFileIds` is consulted at validation time to prune tabs whose
 * underlying file no longer exists; `validAppKeys` (#2471) to prune app
 * tabs whose key the host no longer draws (omitted → no app tab survives).
 *
 * Safe to call from a `useState` initializer (no DOM, no throws).
 */
export function loadShellState(
  projectId: string,
  validFileIds: ReadonlySet<string>,
  validAppKeys: ReadonlySet<string> = NO_APP_KEYS,
): PersistedShellState | null {
  if (typeof window === 'undefined') return null
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(shellStateKeyFor(projectId))
  } catch {
    // Safari private mode etc. — fail closed.
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return validatePersistedState(parsed, validFileIds, validAppKeys)
}

/**
 * Pure validator — exported so unit tests can drive arbitrary inputs
 * without touching localStorage.
 *
 * Validation rules:
 *   - Schema version must match.
 *   - Tabs whose `fileId` is not in `validFileIds` are dropped.
 *   - App tabs (#2471) whose `appKey` is not in `validAppKeys` are dropped,
 *     and so is any later app tab repeating a key already kept.
 *   - A group's `activeTabId` is reassigned to the first remaining tab
 *     (or null) if the persisted active was pruned.
 *   - A group's `backgroundFileId` is dropped if no longer valid.
 *   - Layout cells referencing groups that no longer exist are removed;
 *     columns that become empty are collapsed.
 *   - If `activeGroupId` is not in the cleaned layout, falls back to the
 *     first group in reading order.
 *   - Returns `null` if the cleaned layout has no groups left — the
 *     caller should rebuild the default in that case.
 *
 * Empty groups (group exists, all tabs pruned) are KEPT — the shell
 * treats empty groups as legal and renders a drop-target placeholder.
 */
export function validatePersistedState(
  input: unknown,
  validFileIds: ReadonlySet<string>,
  validAppKeys: ReadonlySet<string> = NO_APP_KEYS,
): PersistedShellState | null {
  if (!input || typeof input !== 'object') return null
  const s = input as Partial<PersistedShellState>
  if (s.version !== SHELL_STATE_VERSION) return null
  if (!s.groups || typeof s.groups !== 'object') return null
  if (!Array.isArray(s.layout)) return null
  if (typeof s.activeGroupId !== 'string') return null

  // Clean every group.
  const cleanedGroups: Record<string, PersistedGroup> = {}
  // #2471 — one app tab per key across the whole layout.
  const seenAppKeys = new Set<string>()
  for (const [gid, rawGroup] of Object.entries(s.groups)) {
    const g = rawGroup as Partial<PersistedGroup>
    if (!g || typeof g !== 'object' || g.id !== gid) continue
    const inTabs = Array.isArray(g.tabs) ? g.tabs : []
    const cleanedTabs: PersistedTab[] = []
    for (const t of inTabs) {
      if (!t || typeof t !== 'object') continue
      if ((t as PersistedTab).kind === 'app') {
        const at = t as PersistedAppTab
        if (typeof at.id !== 'string' || typeof at.appKey !== 'string') continue
        if (!validAppKeys.has(at.appKey) || seenAppKeys.has(at.appKey)) continue
        seenAppKeys.add(at.appKey)
        cleanedTabs.push({
          kind: 'app',
          id: at.id,
          appKey: at.appKey,
          ...(at.state !== undefined ? { state: at.state } : {}),
        })
        continue
      }
      if ((t as PersistedEditorTab).kind !== 'editor') continue
      const tt = t as PersistedEditorTab
      if (typeof tt.id !== 'string' || typeof tt.fileId !== 'string') continue
      if (!validFileIds.has(tt.fileId)) continue
      cleanedTabs.push({
        kind: 'editor',
        id: tt.id,
        fileId: tt.fileId,
        ...(tt.preview === true ? { preview: true } : {}),
      })
    }
    // Reassign activeTabId if pruned.
    let activeTabId = typeof g.activeTabId === 'string' ? g.activeTabId : null
    if (activeTabId !== null && !cleanedTabs.some((t) => t.id === activeTabId)) {
      activeTabId = cleanedTabs.length > 0 ? cleanedTabs[0].id : null
    }
    // Drop stale backgroundFileId.
    const bg =
      typeof g.backgroundFileId === 'string' && validFileIds.has(g.backgroundFileId)
        ? g.backgroundFileId
        : undefined
    // Per-pane backdrop overrides (#350c) — validated, absent → global default.
    const opacity = validBackdropOpacity(g.backdropOpacity)
    const quality = validBackdropQuality(g.backdropQuality)
    cleanedGroups[gid] = {
      id: gid,
      tabs: cleanedTabs,
      activeTabId,
      ...(bg !== undefined ? { backgroundFileId: bg } : {}),
      ...(opacity !== undefined ? { backdropOpacity: opacity } : {}),
      ...(quality !== undefined ? { backdropQuality: quality } : {}),
    }
  }

  // Clean the layout: drop unknown group ids; collapse empty columns.
  const cleanedLayout: string[][] = []
  for (const col of s.layout) {
    if (!Array.isArray(col)) continue
    const cleanedCol: string[] = []
    for (const gid of col) {
      if (typeof gid === 'string' && cleanedGroups[gid]) cleanedCol.push(gid)
    }
    if (cleanedCol.length > 0) cleanedLayout.push(cleanedCol)
  }
  if (cleanedLayout.length === 0) return null

  // Reassign activeGroupId if pruned.
  const liveIds = new Set<string>()
  for (const col of cleanedLayout) for (const gid of col) liveIds.add(gid)
  const activeGroupId = liveIds.has(s.activeGroupId)
    ? s.activeGroupId
    : cleanedLayout[0][0]

  // Trim cleanedGroups to only those in the layout (orphans dropped).
  const finalGroups: Record<string, PersistedGroup> = {}
  for (const gid of liveIds) finalGroups[gid] = cleanedGroups[gid]

  return {
    version: SHELL_STATE_VERSION,
    groups: finalGroups,
    layout: cleanedLayout,
    activeGroupId,
  }
}

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

/**
 * Serialize the shell's live state into the persisted form, keeping editor
 * and app tabs and dropping preview / history tabs (transient by design —
 * see header).
 *
 * Pure — exported so tests can exercise the round-trip without
 * localStorage.
 */
export function serializeShellState(snapshot: ShellSnapshot): PersistedShellState {
  const groups: Record<string, PersistedGroup> = {}
  for (const [gid, g] of snapshot.groups.entries()) {
    const keptTabs: PersistedTab[] = []
    for (const t of g.tabs) {
      if (!isPersistableTab(t)) continue
      if (t.kind === 'app') {
        keptTabs.push({
          kind: 'app',
          id: t.id,
          appKey: t.appKey,
          ...(t.state !== undefined ? { state: t.state } : {}),
        })
        continue
      }
      keptTabs.push({
        kind: 'editor',
        id: t.id,
        fileId: t.fileId,
        ...(t.preview === true ? { preview: true } : {}),
      })
    }
    // If the persisted active was a preview tab we dropped, fall back to
    // the first remaining kept tab (or null) — same policy as the
    // validator on read.
    let activeTabId = g.activeTabId
    if (activeTabId !== null && !keptTabs.some((t) => t.id === activeTabId)) {
      activeTabId = keptTabs.length > 0 ? keptTabs[0].id : null
    }
    groups[gid] = {
      id: gid,
      tabs: keptTabs,
      activeTabId,
      ...(g.backgroundFileId !== undefined
        ? { backgroundFileId: g.backgroundFileId }
        : {}),
      ...(g.backdropOpacity !== undefined
        ? { backdropOpacity: g.backdropOpacity }
        : {}),
      ...(g.backdropQuality !== undefined
        ? { backdropQuality: g.backdropQuality }
        : {}),
    }
  }
  return {
    version: SHELL_STATE_VERSION,
    groups,
    layout: snapshot.layout.map((col) => [...col]),
    activeGroupId: snapshot.activeGroupId,
  }
}

/**
 * Write the snapshot to localStorage for this project. SSR-safe and
 * swallows quota/private-mode errors — a failed write degrades to "no
 * persistence this session," not a crash.
 */
export function saveShellState(projectId: string, snapshot: ShellSnapshot): void {
  if (typeof window === 'undefined') return
  try {
    const payload = JSON.stringify(serializeShellState(snapshot))
    window.localStorage.setItem(shellStateKeyFor(projectId), payload)
  } catch {
    // Quota exceeded, private mode, etc. — silently no-op.
  }
}

/**
 * Remove the persisted entry for a project. Used by tests and by
 * "Reset workspace" flows.
 */
export function clearShellState(projectId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(shellStateKeyFor(projectId))
  } catch {
    // No-op.
  }
}

// ---------------------------------------------------------------------------
// Default-state builder
// ---------------------------------------------------------------------------

/**
 * Build a sane default snapshot for first-launch: a single group with at
 * most one tab — the Strudel pattern file when it exists in the workspace
 * (the natural starting point), otherwise an empty group with a drop-
 * target placeholder.
 *
 * Pure — exported so the caller can use it as the fallback when
 * `loadShellState` returns `null`.
 *
 * Why ONE tab and not zero: the user lands inside an editable Strudel
 * file out of the gate. Zero tabs would force a sidebar click before
 * anything is editable.
 */
export function buildDefaultSnapshot(
  newGroupId: string,
  defaultFileId: string | null,
): ShellSnapshot {
  const tabs: WorkspaceTab[] = defaultFileId
    ? [{ kind: 'editor', id: `tab-${defaultFileId}`, fileId: defaultFileId }]
    : []
  const group: WorkspaceGroupState = {
    id: newGroupId,
    tabs,
    activeTabId: tabs.length > 0 ? tabs[0].id : null,
  }
  const groups = new Map<string, WorkspaceGroupState>()
  groups.set(newGroupId, group)
  return {
    groups,
    layout: [[newGroupId]],
    activeGroupId: newGroupId,
  }
}

/**
 * Inverse of `serializeShellState` — used by callers that load a
 * persisted snapshot and want to feed it back into the shell's
 * state shape (Map + GroupLayout + activeGroupId).
 */
export function hydrateSnapshot(
  persisted: PersistedShellState,
): ShellSnapshot {
  const groups = new Map<string, WorkspaceGroupState>()
  for (const [gid, pg] of Object.entries(persisted.groups)) {
    groups.set(gid, {
      id: pg.id,
      tabs: pg.tabs.map((t): WorkspaceTab =>
        t.kind === 'app'
          ? {
              kind: 'app',
              id: t.id,
              appKey: t.appKey,
              ...(t.state !== undefined ? { state: t.state } : {}),
            }
          : {
              kind: 'editor',
              id: t.id,
              fileId: t.fileId,
              ...(t.preview === true ? { preview: true } : {}),
            },
      ),
      activeTabId: pg.activeTabId,
      ...(pg.backgroundFileId !== undefined
        ? { backgroundFileId: pg.backgroundFileId }
        : {}),
      ...(pg.backdropOpacity !== undefined
        ? { backdropOpacity: pg.backdropOpacity }
        : {}),
      ...(pg.backdropQuality !== undefined
        ? { backdropQuality: pg.backdropQuality }
        : {}),
    })
  }
  return {
    groups,
    layout: persisted.layout.map((col) => [...col]),
    activeGroupId: persisted.activeGroupId,
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isPersistableTab(
  t: WorkspaceTab,
): t is Extract<WorkspaceTab, { kind: 'editor' | 'app' }> {
  return t.kind === 'editor' || t.kind === 'app'
}
