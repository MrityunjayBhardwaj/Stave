/**
 * WorkspaceShell — Phase 10.2 Task 04.
 *
 * Generic tab/group/split container. Holds any tab kind (editor or
 * preview), supports drag-drop between groups for either kind, and
 * dispatches rendering by `tab.kind` without knowing the file type. Owns
 * nothing about engines, runtime state, or keyboard shortcuts — those are
 * injected by Task 05 (`runtimeProviders` + `chromeForTab`), resolved by
 * Task 06 (`previewProviderFor`), and added by Task 08 (Cmd+K V/B/W
 * window listeners).
 *
 * @remarks
 * ## Relationship to the legacy `EditorGroup.tsx`
 *
 * The old `packages/editor/src/visualizers/editor/EditorGroup.tsx` bundled
 * tab bar + Monaco + preview layout with four rendering modes (panel,
 * inline, background, popout) encoded as a single state field on the
 * group. This file replaces the tab bar / group chrome / drag-drop logic
 * with a **lifted** implementation — not an import, not a delegation.
 * The old group stays on disk until Task 09 deletes it; until then it
 * owns zero dependencies on this shell, and this shell owns zero
 * dependencies on it. Lifting (rather than delegating) is the
 * non-negotiable constraint because the old group's rendering-mode field
 * is exactly what Phase 10.2 exists to dissolve — importing from it
 * would pull that field back in through the type system.
 *
 * The PV7 acceptance test in `WorkspaceShell.test.tsx` greps this file's
 * source for the legacy mode-field identifier and fails if any occurrence
 * is found. The string stays out of this file intentionally.
 *
 * ## Group state shape
 *
 * The shell owns a `Map<groupId, WorkspaceGroupState>` plus an ordered
 * `groupOrder: string[]` that records the left-to-right layout. Using a
 * Map (rather than an object keyed by id) is a deliberate choice: it
 * makes the ordering explicit via `groupOrder`, keeps lookups O(1) on
 * group id, and prevents the "key collision with builtin prototype"
 * class of bugs that plain-object stores suffer. The two fields are
 * always updated together inside a single `setGroups`/`setGroupOrder`
 * transaction so they can't desync.
 *
 * ## Tab dispatch (PV7)
 *
 * Inside `renderGroup()`, the active tab is looked up and dispatched on
 * `tab.kind` via an exhaustiveness-checked `switch`:
 *
 *   - `'editor'` → `<EditorView .../>`
 *   - `'preview'` → `<PreviewView .../>`
 *   - default → `assertNever(tab)` — a `never`-typed call that makes
 *     TypeScript fail the compile if a new tab kind is added without
 *     a branch here.
 *
 * The `chromeSlot` for the editor comes from `props.chromeForTab?.(tab)`
 * — Task 05 wires it to runtime chrome via the runtime provider registry.
 * Task 04 calls the callback if supplied and passes `undefined` otherwise
 * (viz / markdown editors have no chrome).
 *
 * ## Drag-drop logic (lifted from EditorGroup, sanitized for PV7)
 *
 * HTML5 drag-drop with a custom MIME type `application/workspace-tab`.
 * Payload is `{ sourceGroupId, tabId }` JSON-encoded into the dataTransfer.
 * On drop, the shell:
 *
 *   1. Reads the payload from `dataTransfer.getData`.
 *   2. Finds the source group + tab.
 *   3. Removes the tab from the source group.
 *   4. Appends the tab to the target group's tab list.
 *   5. Marks the target group's active tab = the dropped tab.
 *   6. Fires `onActiveTabChange` if the active tab changed.
 *
 * The source group may become empty after the drop — that's legal. The
 * shell does not auto-collapse empty groups (the user might be about to
 * drop something else into it); the explicit "close group" button handles
 * removal.
 *
 * ## Group split
 *
 * `splitGroup(groupId)` inserts a new empty group immediately after the
 * given group in `groupOrder`. The new group has a freshly generated id
 * and no tabs. `SplitPane`'s size reconciliation handles the new pane
 * sizing.
 *
 * ## Close group
 *
 * `closeGroup(groupId)` merges the closing group's tabs into the next
 * adjacent group (previous if this is the last one). If the shell has
 * only one group, close-group is disabled (the user must close individual
 * tabs instead). The merged tabs append to the neighbor's tab list and
 * the active tab in the neighbor stays unchanged.
 *
 * ## Active tab tracking
 *
 * Each group has its own `activeTabId`. The shell also tracks a single
 * `activeGroupId` — the group the user last interacted with — so that
 * `getActiveTab()` can return the one "shell-wide active tab." Clicking
 * a tab in a different group updates both `activeGroupId` and the group's
 * `activeTabId`; `onActiveTabChange` fires with the resolved tab.
 *
 * ## Theme ownership (PV6 / PK6)
 *
 * `applyTheme(shellRootRef.current, theme)` runs in a `useEffect` keyed
 * on `[theme]`. This is belt-and-suspenders: child `EditorView` /
 * `PreviewView` roots also apply their own theme, so the shell chrome
 * (tab bars, group dividers, split handles) has a themed ancestor even
 * when child views mount late.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { SplitPane } from '../visualizers/editor/SplitPane'
import { applyTheme } from '../theme/tokens'
import { EditorView } from './EditorView'
import { ErrorBoundary } from './ErrorBoundary'
import { PreviewView } from './PreviewView'
import { useKeyboardCommands } from './commands/useKeyboardCommands'
import { executeCommand } from './commands/CommandRegistry'
import { getPreviewProviderForLanguage } from './preview/registry'
import { getFile, subscribe as subscribeToWorkspaceFile } from './WorkspaceFile'
import { HistoryDiffOverlay } from './history/HistoryDiffOverlay'
import { HistoryViewOverlay } from './history/HistoryViewOverlay'
import { getCurrentHistory } from './history/historyService'
import { getCommit } from './history/historyGraph'
import {
  getBackdropQuality,
  onBackdropQualityChange,
  backdropQualityFactor,
  getBackdropOpacity,
  onBackdropOpacityChange,
  getPlayVizOnHoverEnabled,
  onPlayVizOnHoverChange,
  getBackdropVizSpan,
  onBackdropVizSpanChange,
  setBackdropVizSpan,
  type BackdropQuality,
  type BackdropVizSpan,
  getActiveEditor,
} from './editorRegistry'
// Cursor-targeted sound assignment (#820) — the Asset Library sidebar writes a
// `.sound()` / `s()` into the code at the cursor via `assignSoundToCursor`,
// reusing the same chunk-detection + writeback spine the Mixer picker uses.
import { commitToEditor, assignmentEdit } from '../codeView'
import { planSoundAssignment } from '../codeView'
import { planVizAssignment } from '../codeView'
import type { WorkspaceShellActions } from './commands/CommandRegistry'
import type {
  WorkspaceGroupState,
  WorkspaceShellProps,
  WorkspaceTab,
} from './types'
import { resolveBackdropFileId } from './backdropPrecedence'
import {
  type GroupLayout,
  type DropDirection,
  findGroupCoords,
  allGroupIds,
  insertGroup as layoutInsertGroup,
  insertEdgeGroup as layoutInsertEdgeGroup,
  removeGroup as layoutRemoveGroup,
} from './groupLayout'
import { findBuiltinExampleSource } from './builtinExampleSources'
import { BottomPanel } from './bottomPanel/BottomPanel'
import { SymbolRow } from './SymbolRow'
import { bottomPanelHiddenForTab } from './bottomPanel/hiddenForTab'

/**
 * Exhaustiveness helper used inside the tab dispatch switch. If TypeScript
 * ever sees a new `WorkspaceTab` variant without a branch added above the
 * default case, this call fails the type-check at compile time.
 */
// Webkit/Blink doesn't honour `scrollbarWidth: 'none'` inline style yet —
// inject a one-time stylesheet rule so the tabbar can scroll horizontally
// without showing a visible track/thumb.
let tabbarScrollStyleInjected = false
function ensureTabbarScrollStyle(): void {
  if (tabbarScrollStyleInjected) return
  if (typeof document === 'undefined') return
  const el = document.createElement('style')
  el.setAttribute('data-stave-style', 'tabbar-scroll')
  el.textContent = '[data-workspace-group-tabbar]::-webkit-scrollbar{display:none;width:0;height:0}'
  document.head.appendChild(el)
  tabbarScrollStyleInjected = true
}

function assertNever(value: never): never {
  throw new Error(
    `WorkspaceShell: unhandled tab kind in dispatch: ${JSON.stringify(value)}`,
  )
}

/**
 * Stable-ish id generator for newly created groups. Uses a module-level
 * counter plus `Math.random()` — good enough for in-memory shell state
 * that never crosses process boundaries. If we ever need deterministic
 * ids for snapshot testing, inject a factory via props.
 */
let __nextGroupSeq = 0
function generateGroupId(): string {
  __nextGroupSeq += 1
  return `group-${__nextGroupSeq}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * MIME type for the HTML5 drag-drop payload. Distinct from the legacy
 * `'application/viz-tab'` type so drag-drops between the shell and the
 * legacy `EditorGroup` (during the transition period) don't cross wires.
 */
const DRAG_MIME = 'application/workspace-tab'

interface DragPayload {
  readonly sourceGroupId: string
  readonly tabId: string
}

/**
 * #787 — a backdrop belongs to the FILE whose editor tab activated it, not to
 * the pane it happened to be activated in. Every cross-group tab move
 * (quadrant split, edge drop, tab-bar slot, center drop) funnels its
 * `setGroups` updater through this helper so the source group's
 * `backgroundFileId` travels with the tab: stripped from the source entry
 * (when it survived the move) and pinned on the destination entry. Without
 * this, the backdrop keeps rendering in the old pane while the tab lives in
 * the new one — and the orphaned chrome then offers a second "Play" whose
 * activation clobbers the audio-teardown record.
 *
 * Pure map mutation (safe for StrictMode double-invoked updaters). Callers
 * own side effects: audio teardown records stay keyed by file id and are
 * deliberately untouched, and no `onBackgroundFileChange` fires — the
 * tab→backdrop association didn't change, only which pane renders it.
 */
function transferBackdropWithTab(
  next: Map<string, WorkspaceGroupState>,
  sourceGroup: WorkspaceGroupState,
  movingTab: WorkspaceTab,
  destGroupId: string,
): void {
  if (movingTab.kind !== 'editor') return
  if (sourceGroup.backgroundFileId !== movingTab.fileId) return
  const src = next.get(sourceGroup.id)
  if (src && src.backgroundFileId === movingTab.fileId) {
    next.set(sourceGroup.id, { ...src, backgroundFileId: undefined })
  }
  const dest = next.get(destGroupId)
  if (dest) {
    next.set(destGroupId, { ...dest, backgroundFileId: movingTab.fileId })
  }
}

/**
 * Create the initial group state from seed tabs. Always produces exactly
 * one group; later splits / drag-drops may create more. The first seed
 * tab becomes the active tab. The initial layout is a single column
 * containing that one group (`[[id]]`).
 */
function createInitialGroupState(
  initialTabs: readonly WorkspaceTab[],
): {
  groups: Map<string, WorkspaceGroupState>
  layout: GroupLayout
  activeGroupId: string
} {
  const id = generateGroupId()
  const group: WorkspaceGroupState = {
    id,
    tabs: initialTabs,
    activeTabId: initialTabs.length > 0 ? initialTabs[0].id : null,
  }
  const groups = new Map<string, WorkspaceGroupState>()
  groups.set(id, group)
  return { groups, layout: [[id]], activeGroupId: id }
}

/**
 * Imperative handle exposed via `ref` on `WorkspaceShell`.
 *
 * Lets parent components programmatically control tab state without
 * going through the `initialTabs` prop (which is read once on mount).
 * Used by the PM Phase 2.5+ file tree to open/focus a file's tab when
 * the user clicks it in the sidebar.
 */
export interface WorkspaceShellHandle {
  /**
   * Open or focus the editor tab for the given file id. If a tab with
   * `kind: 'editor'` and matching `fileId` already exists (in any group),
   * focuses it. Otherwise creates a new editor tab in the currently active
   * group and focuses it. No-op if already focused.
   *
   * When `options.preview` is true, the tab is marked preview — a single
   * preview slot per group is reused across successive preview opens,
   * matching VSCode's single-click-to-preview behaviour. Promotion to a
   * pinned tab happens on double-click or the first content edit.
   */
  openOrFocusFile(fileId: string, options?: { preview?: boolean }): void

  /**
   * Open a read-only history viewer (Diff or time-travel View) as a tab in
   * the main editor area (#210). Reuses a single italic preview slot per
   * the active group: a subsequent call replaces that slot's content
   * instead of stacking tabs; double-clicking the tab promotes it to a
   * pinned tab (same UX as opening a file in preview). Replaces the old
   * cramped sidebar overlay.
   */
  openHistoryTab(req: {
    mode: 'diff' | 'view'
    commitId: string
    fileId: string
    /** Diff: open in "vs current" (live ↔ commit) by default (#211). */
    vsCurrent?: boolean
    /** Diff: file-picker scope override (the dirty set) (#211). */
    pickerFileIds?: readonly string[]
  }): void

  /**
   * Promote the given tab out of preview mode — it becomes pinned and
   * stops being eligible for replacement by the next preview open. No-op
   * if the tab doesn't exist or was already pinned.
   */
  promoteTab(tabId: string): void

  /**
   * Close every tab (editor + preview) that targets the given file id,
   * in any group. Used when a file is deleted from the sidebar so its
   * orphan tabs vanish without remounting the shell. No-op if no tabs
   * reference the file.
   */
  closeTabsForFile(fileId: string): void

  /**
   * Close every tab in the tab's group EXCEPT the given tab. No-op if
   * the tab doesn't exist.
   */
  closeOtherTabs(tabId: string): void

  /** Close every tab in the tab's group. */
  closeAllTabsInGroup(tabId: string): void

  /**
   * Split the currently active group by inserting a new empty group in
   * the given direction (east = right, south = below). Focus stays on
   * the original group; the new group is a drop target for dragged
   * tabs. No-op if there is no active group.
   */
  splitActiveGroup(direction?: 'east' | 'south'): void

  /**
   * Pin a FILE as the backdrop for a group. Pass `null` to clear.
   * `groupId` defaults to the active group. The pinned file's preview
   * renders behind the active editor and survives tab switches.
   * Called by the file-tree context menu and by `Cmd+K B`.
   */
  setBackgroundFile(fileId: string | null, groupId?: string): void

  /**
   * Set the TRANSIENT code-override backdrop for a group (#350a). Pass `null`
   * to drop the override so the manual sticky (`setBackgroundFile`) shows again.
   * `groupId` defaults to the active group. Unlike `setBackgroundFile`, this is
   * NOT persisted and does NOT fire `onBackgroundFileChange` — it's the active
   * program's per-eval `.scope()` / `.viz({ backdrop })` declaration, which
   * OVERLAYS the sticky and clears back to it when the code stops declaring one.
   */
  setBackgroundOverride(fileId: string | null, groupId?: string): void

  /**
   * Read the current backdrop fileId for a group (default: active
   * group). Returns `undefined` when no backdrop is pinned. Useful for
   * UI that needs to render a "Clear" vs "Set" label without
   * subscribing to every shell state change.
   */
  getBackgroundFileId(groupId?: string): string | undefined

  /**
   * Set/clear a group's per-pane backdrop opacity (#350c). `null` drops the
   * override so the global default applies. `groupId` defaults to the active
   * group. Persisted (survives reload) — it's user intent, not transient
   * code state.
   */
  setBackdropOpacity(opacity: number | null, groupId?: string): void

  /** Set/clear a group's per-pane backdrop quality (#350c). `null` → global default. */
  setBackdropQuality(quality: BackdropQuality | null, groupId?: string): void

  /**
   * Read a group's RESOLVED backdrop settings (#350c) — the per-pane override
   * if set, else the global default. `groupId` defaults to the active group.
   * Lets the popover seed its controls without subscribing to shell state.
   */
  getBackdropSettings(groupId?: string): { opacity: number; quality: BackdropQuality }

  /**
   * Write a sound into the code at the cursor (#820, Asset Library insert).
   * If the cursor sits in a note/roll chunk, sets/replaces its `.sound('x')`
   * (mirrors the Mixer picker); otherwise inserts a fresh `s("x")` at the
   * cursor. No-op when there's no active editor. Detects the chunk fresh from
   * the active editor at call time — it does NOT depend on the Pattern/Mixer
   * panel being open. `slow` (#2070) is written as `.slow(N)` on a fresh line,
   * for a clip longer than a cycle. Returns why nothing was written when the
   * `.sound()` under the cursor is a pattern of several sounds (#2226), else null.
   */
  assignSoundToCursor(sound: string, opts?: { slow?: number }): string | null
  /** Attach `.viz("name")` to the pattern chunk under the cursor (Asset Library
   *  viz insert). Returns true if it wrote, false when there's no pattern under
   *  the cursor (nothing to attach to) so the caller can guide the user. */
  assignVizToCursor(name: string): boolean
}

/** Resolve a tab's display name from the file store. Falls back to fileId. */
function tabFileName(tab: WorkspaceTab): string {
  const file = getFile(tab.fileId)
  if (!file) return tab.fileId
  const parts = file.path.split('/')
  return parts[parts.length - 1]
}

interface GroupTabBarProps {
  group: WorkspaceGroupState
  canClose: boolean
  onTabBarDragOver: (e: React.DragEvent<HTMLDivElement>) => void
  onTabBarDrop: (e: React.DragEvent<HTMLDivElement>) => void
  onTabClick: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onTabDragStart: (e: React.DragEvent<HTMLDivElement>, tab: WorkspaceTab) => void
  onTabContextMenu?: (tab: WorkspaceTab, x: number, y: number) => void
  onTabPromote: (tabId: string) => void
  onNewFile?: () => void
  onSplitRight: () => void
  onSplitDown: () => void
  onCloseGroup: () => void
}

// Subcomponent so each group owns its scroll-overflow state and
// scrollIntoView refs — hooks can't live inside a `.map` callback.
function GroupTabBar({
  group,
  canClose,
  onTabBarDragOver,
  onTabBarDrop,
  onTabClick,
  onTabClose,
  onTabDragStart,
  onTabContextMenu,
  onTabPromote,
  onNewFile,
  onSplitRight,
  onSplitDown,
  onCloseGroup,
}: GroupTabBarProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeTabElRef = useRef<HTMLDivElement | null>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  })
  const [menuOpen, setMenuOpen] = useState(false)

  // Recompute overflow flags whenever the strip resizes, scrolls, or the
  // tab list changes. ResizeObserver covers parent resize and tab insertion
  // (which changes scrollWidth) — the scroll listener covers user scrolling.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = (): void => {
      const left = el.scrollLeft > 0
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setOverflow((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right },
      )
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro?.disconnect()
    }
  }, [group.tabs.length])

  // Scroll the active tab into view whenever activation changes. inline:
  // 'nearest' is a no-op when the element is already fully visible, so this
  // doesn't fight the user's manual scrolling.
  useEffect(() => {
    const el = activeTabElRef.current
    if (!el || typeof el.scrollIntoView !== 'function') return
    el.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [group.activeTabId])

  // Close the overflow menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node | null
      if (menuRef.current?.contains(t)) return
      if (menuBtnRef.current?.contains(t)) return
      setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const hasOverflow = overflow.left || overflow.right

  return (
    <div
      data-workspace-group-tabbar={group.id}
      onDragOver={onTabBarDragOver}
      onDrop={onTabBarDrop}
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        height: 30,
        flexShrink: 0,
      }}
    >
      {/* Scrollable strip wrapper — positioning context for fade overlays */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          minWidth: 0,
          height: '100%',
        }}
      >
        <div
          ref={scrollRef}
          data-workspace-tab-strip={group.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            height: '100%',
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {group.tabs.map((tab) => {
            const isActive = tab.id === group.activeTabId
            const isPreview =
              (tab.kind === 'editor' || tab.kind === 'history') &&
              (tab as { preview?: boolean }).preview === true
            return (
              <div
                key={tab.id}
                ref={isActive ? activeTabElRef : undefined}
                data-workspace-tab={tab.id}
                data-tab-kind={tab.kind}
                data-tab-active={isActive ? 'true' : 'false'}
                data-tab-preview={isPreview ? 'true' : 'false'}
                draggable
                onDragStart={(e) => onTabDragStart(e, tab)}
                onClick={() => onTabClick(tab.id)}
                onContextMenu={(e) => {
                  if (!onTabContextMenu) return
                  e.preventDefault()
                  e.stopPropagation()
                  onTabContextMenu(tab, e.clientX, e.clientY)
                }}
                onDoubleClick={() => {
                  if (isPreview) onTabPromote(tab.id)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '0 8px',
                  height: '100%',
                  cursor: 'grab',
                  background: isActive ? 'var(--background)' : 'transparent',
                  borderRight: '1px solid var(--border)',
                  color: isActive
                    ? 'var(--foreground)'
                    : 'var(--foreground-muted)',
                  fontSize: 11,
                  fontStyle: isPreview ? 'italic' : 'normal',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  flexShrink: 0,
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                  {tab.kind === 'history' ? (
                    <span
                      style={{
                        fontSize: 8,
                        fontStyle: 'normal',
                        opacity: 0.65,
                        letterSpacing: 0.5,
                        marginRight: 4,
                        border: '1px solid currentColor',
                        borderRadius: 3,
                        padding: '0 2px',
                      }}
                    >
                      {tab.mode === 'view' ? 'VIEW' : 'DIFF'}
                    </span>
                  ) : tab.kind === 'preview' ? (
                    '🎥 '
                  ) : null}
                  {tabFileName(tab)}
                </span>
                <button
                  data-testid={`tab-close-${tab.id}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onTabClose(tab.id)
                  }}
                  style={closeBtnStyle}
                >
                  {'×'}
                </button>
              </div>
            )
          })}
          {/* #612 — "+" new-file action sits as a small tab immediately after
              the last tab (browser-style), inside the scrollable strip so it
              follows the last tab. Rendered only when the host wires it. */}
          {onNewFile && (
            <button
              data-testid={`tab-new-file-${group.id}`}
              onClick={onNewFile}
              title="New file"
              aria-label="New file"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                padding: '0 8px',
                background: 'transparent',
                border: 'none',
                color: 'var(--foreground-muted)',
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              {'+'}
            </button>
          )}
        </div>
        {/* Fade cues — only render on the side that has hidden tabs */}
        {overflow.left && (
          <div
            aria-hidden
            data-testid={`tab-strip-fade-left-${group.id}`}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: 18,
              pointerEvents: 'none',
              background:
                'linear-gradient(to right, var(--surface), transparent)',
            }}
          />
        )}
        {overflow.right && (
          <div
            aria-hidden
            data-testid={`tab-strip-fade-right-${group.id}`}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: 18,
              pointerEvents: 'none',
              background:
                'linear-gradient(to left, var(--surface), transparent)',
            }}
          />
        )}
      </div>

      {/* Pinned action cluster — never scrolls off-screen */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          padding: '0 4px',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {hasOverflow && (
          <button
            ref={menuBtnRef}
            data-testid={`tab-overflow-menu-${group.id}`}
            onClick={() => setMenuOpen((v) => !v)}
            title="Show all tabs"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            style={actionBtnStyle}
          >
            {'˅'}
          </button>
        )}
        <button
          data-testid={`group-split-${group.id}`}
          onClick={onSplitRight}
          title="Split right (⌘\\)"
          style={actionBtnStyle}
        >
          {'│'}
        </button>
        <button
          data-testid={`group-split-down-${group.id}`}
          onClick={onSplitDown}
          title="Split down (⌘⇧\\)"
          style={actionBtnStyle}
        >
          {'─'}
        </button>
        {canClose && (
          <button
            data-testid={`group-close-${group.id}`}
            onClick={onCloseGroup}
            title="Close group"
            style={actionBtnStyle}
          >
            {'×'}
          </button>
        )}
        {menuOpen && (
          <div
            ref={menuRef}
            role="menu"
            data-testid={`tab-overflow-list-${group.id}`}
            style={{
              position: 'absolute',
              top: '100%',
              right: 4,
              zIndex: 100,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
              minWidth: 200,
              maxHeight: 320,
              overflowY: 'auto',
              padding: '4px 0',
              marginTop: 2,
            }}
          >
            {group.tabs.map((tab) => {
              const isActive = tab.id === group.activeTabId
              return (
                <div
                  key={tab.id}
                  role="menuitem"
                  data-testid={`tab-overflow-item-${tab.id}`}
                  onClick={() => {
                    onTabClick(tab.id)
                    setMenuOpen(false)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '4px 10px',
                    fontSize: 12,
                    cursor: 'pointer',
                    background: isActive
                      ? 'var(--accent-soft, rgba(117,186,255,0.18))'
                      : 'transparent',
                    color: isActive
                      ? 'var(--foreground)'
                      : 'var(--foreground-muted)',
                  }}
                >
                  <span
                    style={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      flex: 1,
                    }}
                  >
                    {tab.kind === 'preview' ? '🎥 ' : ''}
                    {tabFileName(tab)}
                  </span>
                  <button
                    data-testid={`tab-overflow-close-${tab.id}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onTabClose(tab.id)
                    }}
                    style={closeBtnStyle}
                  >
                    {'×'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export const WorkspaceShell = forwardRef<WorkspaceShellHandle, WorkspaceShellProps>(function WorkspaceShell({
  initialTabs = [],
  initialGroups,
  initialLayout,
  initialActiveGroupId,
  onGroupsChange,
  theme = 'dark',
  height = '100%',
  onActiveTabChange,
  onNewFile,
  onBackgroundFileChange,
  onActiveBackdropChange,
  onOpenPopoutPreview,
  backgroundCrop,
  onTabClose,
  previewProviderFor,
  chromeForTab,
  editorExtrasForTab,
  onSaveFile,
  onTabContextMenu,
  onEditViz,
  onCropViz,
  onCropBackdrop,
  onRevealBackdrop,
}, forwardedRef) {
  const shellRootRef = useRef<HTMLDivElement>(null)

  // One-shot seeding — `initialTabs` / `initialGroups` are read exactly
  // once on mount. This mirrors React's uncontrolled-input pattern: the
  // props are initial values, not a source of truth. Re-renders with new
  // references do NOT re-seed the shell.
  //
  // When the consumer hydrates from persistence (issue #175), it passes
  // the full `initialGroups` + `initialLayout` + `initialActiveGroupId`
  // triple; in that path the layout must be valid (non-empty, all group
  // ids covered). Otherwise we fall back to the legacy single-group seed
  // built from `initialTabs`.
  const initialState = useRef(
    initialGroups !== undefined &&
    initialLayout !== undefined &&
    initialLayout.length > 0 &&
    initialActiveGroupId !== undefined
      ? {
          groups: new Map(initialGroups),
          layout: initialLayout,
          activeGroupId: initialActiveGroupId,
        }
      : createInitialGroupState(initialTabs),
  )
  const [groups, setGroups] = useState<Map<string, WorkspaceGroupState>>(
    () => initialState.current.groups,
  )
  const [layout, setLayout] = useState<GroupLayout>(
    () => initialState.current.layout,
  )
  const [activeGroupId, setActiveGroupId] = useState<string>(
    () => initialState.current.activeGroupId,
  )

  // #350a — transient per-group code-OVERRIDE backdrop layer. Deliberately kept
  // OUT of `groups` / the `onGroupsChange` snapshot: the active program declares
  // it every eval, so persisting it would churn tab-persistence and outlive the
  // code that asked for it. `renderGroup` resolves override ?? sticky; clearing
  // (delete) falls back to the persisted manual sticky (`group.backgroundFileId`).
  const [bgOverrides, setBgOverrides] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  )

  // #350a — notify the app when the ACTIVE group's RESOLVED backdrop changes
  // (override ?? sticky) so UI that must reflect "what's showing" (the menubar
  // bg indicator, the popover) tracks reality, not just the persisted sticky.
  // Ref-guarded so steady code in live mode doesn't re-fire every eval.
  const lastActiveBackdropRef = useRef<string | null>(null)
  useEffect(() => {
    const g = groups.get(activeGroupId)
    const resolved =
      resolveBackdropFileId(g?.backgroundFileId, bgOverrides.get(activeGroupId)) ?? null
    if (resolved !== lastActiveBackdropRef.current) {
      lastActiveBackdropRef.current = resolved
      onActiveBackdropChange?.(resolved)
    }
  }, [groups, bgOverrides, activeGroupId, onActiveBackdropChange])

  // Single persistence sink (#175). Fires on every change to groups /
  // layout / activeGroupId. The first render is suppressed via a
  // `didMountRef`, so a freshly-hydrated shell doesn't immediately
  // re-write identical state back. Subsequent changes propagate
  // synchronously after the React commit; the consumer is responsible
  // for any debounce/throttle.
  const didMountRef = useRef(false)
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true
      return
    }
    onGroupsChange?.({ groups, layout, activeGroupId })
  }, [groups, layout, activeGroupId, onGroupsChange])

  // Quadrant drop zone state — when a tab is being dragged over a
  // specific group, `dragOverTarget` records both the target group id
  // and the direction (N/S/E/W/center). Drives the guide line overlay.
  const [dragOverTarget, setDragOverTarget] = useState<{
    groupId: string
    direction: DropDirection
  } | null>(null)

  // Edge drop zone hover state — `'start'` = left edge, `'end'` = right
  // edge, `null` = no edge hovered. Drives the highlight overlay the
  // user sees while dragging a tab near the shell's outer borders.
  // Issue #1: dragging a tab to the left/right edge creates a new
  // split group at that position.
  const [dragOverEdge, setDragOverEdge] = useState<'start' | 'end' | null>(
    null,
  )

  // Global "a tab drag is in progress" flag. Used to toggle the edge
  // drop zones' pointer-events: when no drag is active, the zones are
  // transparent to clicks so the user can interact with content near
  // the shell borders normally; during a drag, the zones activate so
  // drop-over/drop events reach them. Set in handleTabDragStart and
  // cleared in a window-level dragend listener so interrupted drags
  // (drop outside the shell, ESC) also reset state.
  const [tabDragInProgress, setTabDragInProgress] = useState(false)

  /**
   * Set of file ids whose preview tab's render loop is currently
   * paused (user clicked the chrome's Stop button). The chrome
   * reads `previewPaused = pausedPreviews.has(fileId)` and
   * `PreviewView` receives `paused={…}` which threads through to
   * the compiled viz mount, which calls `renderer.pause()` /
   * `renderer.resume()` on state change.
   *
   * Keyed by FILE id (not tab id) because the pause state should
   * survive drag-dropping a preview tab to a new group — the
   * underlying viz file is the same, just rehoused.
   */
  const [pausedPreviews, setPausedPreviews] = useState<Set<string>>(
    () => new Set(),
  )

  // Backdrop quality — subscribed so the render reacts when the user
  // flips Full / Half / Quarter in settings. Lives at the shell so
  // all group backdrops update together (simple policy — a future
  // per-backdrop override can overlay on top).
  const [backdropQuality, setBackdropQualityState] = useState<BackdropQuality>(
    () => getBackdropQuality(),
  )
  useEffect(
    () => onBackdropQualityChange(setBackdropQualityState),
    [],
  )

  // Backdrop opacity — same subscribe pattern. Applied as inline
  // opacity on the backdrop wrapper so the user can dim the viz
  // without touching the code-panel wash.
  const [backdropOpacity, setBackdropOpacityState] = useState<number>(
    () => getBackdropOpacity(),
  )
  useEffect(
    () => onBackdropOpacityChange(setBackdropOpacityState),
    [],
  )

  // #769 "Play viz on hover" — same subscribe pattern. OFF (default) → every
  // pane's backdrop stays live (#768). ON → non-focused panes freeze unless the
  // cursor hovers them, so the backdrop `paused` policy below reads this + the
  // hovered group. Read live so toggling the setting re-evaluates all panes
  // without a remount.
  const [playVizOnHover, setPlayVizOnHoverState] = useState<boolean>(
    () => getPlayVizOnHoverEnabled(),
  )
  useEffect(
    () => onPlayVizOnHoverChange(setPlayVizOnHoverState),
    [],
  )
  // Which group the cursor is currently over — only consulted when
  // `playVizOnHover` is ON, to keep the hovered non-focused pane's backdrop live.
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null)

  // #770 backdrop viz span — 'file' (per-pane, default) or 'workspace' (one
  // backdrop spanning every pane). Same subscribe pattern; read live so toggling
  // the span in the popover re-renders (per-pane ⇄ spanning) without a remount.
  const [backdropVizSpan, setBackdropVizSpanState] = useState<BackdropVizSpan>(
    () => getBackdropVizSpan(),
  )
  useEffect(
    () => onBackdropVizSpanChange(setBackdropVizSpanState),
    [],
  )

  // Theme application — PV6 / PK6. Effect, not render.
  useEffect(() => {
    if (!shellRootRef.current) return
    applyTheme(shellRootRef.current, theme)
  }, [theme])

  // Inject the tabbar-scrollbar hide rule once (webkit/blink fallback
  // because inline scrollbarWidth: 'none' isn't honoured there).
  useEffect(() => {
    ensureTabbarScrollStyle()
  }, [])

  // Resolve the current shell-wide active tab from the group map.
  // Memoized on the [groups, activeGroupId] dep set so the identity
  // reference is stable until something actually changes.
  const activeTab: WorkspaceTab | null = useMemo(() => {
    const group = groups.get(activeGroupId)
    if (!group || group.activeTabId === null) return null
    return group.tabs.find((t) => t.id === group.activeTabId) ?? null
  }, [groups, activeGroupId])

  // Fire `onActiveTabChange` whenever the resolved active tab changes.
  // Identity comparison on the tab reference is the signal — it changes
  // on tab-level activation AND on active-group switches. Also fires
  // once on mount so subscribers see the initial state.
  const prevActiveTabRef = useRef<WorkspaceTab | null | undefined>(undefined)
  useEffect(() => {
    if (prevActiveTabRef.current !== activeTab) {
      prevActiveTabRef.current = activeTab
      onActiveTabChange?.(activeTab)
    }
  }, [activeTab, onActiveTabChange])

  /**
   * Immutable group-state update helper. Takes the current groups map
   * and a patch function; returns a NEW map with the patched group.
   * Leaves the rest of the map alone, so React's referential update
   * semantics work correctly.
   */
  const updateGroup = useCallback(
    (
      groupId: string,
      patch: (g: WorkspaceGroupState) => WorkspaceGroupState,
    ) => {
      setGroups((prev) => {
        const existing = prev.get(groupId)
        if (!existing) return prev
        const next = new Map(prev)
        next.set(groupId, patch(existing))
        return next
      })
    },
    [],
  )

  /**
   * Activate a given tab inside a given group. Updates both the group's
   * local `activeTabId` and the shell-wide `activeGroupId` so the
   * resolved active tab reflects the click.
   */
  const handleTabClick = useCallback(
    (groupId: string, tabId: string) => {
      updateGroup(groupId, (g) => ({ ...g, activeTabId: tabId }))
      setActiveGroupId(groupId)
    },
    [updateGroup],
  )

  /**
   * Close a tab from a group. If the closed tab was active, switches
   * the active tab to the next adjacent tab (preferring the one to the
   * right of the closed position; falling back to the one to the left;
   * null if none remain).
   */
  // #785 — the built-in audio source each file's BACKDROP started, keyed by
  // file id. The backdrop (unlike a side preview tab) carries no sourceRef, so
  // we record it here when the backdrop is activated and stop it on teardown
  // (preview=off, Cmd+K B toggle-off, and viz-file tab close).
  const backdropSourceByFile = useRef<
    Map<string, import('./types').AudioSourceRef>
  >(new Map())
  const stopBackdropSource = useCallback((fileId: string) => {
    const ref = backdropSourceByFile.current.get(fileId)
    if (ref?.kind === 'file') {
      findBuiltinExampleSource(ref.fileId)?.stopIfRunning()
    }
    backdropSourceByFile.current.delete(fileId)
  }, [])

  // #787 — when a moving tab carries its backdrop onto an EXISTING target
  // group (tab-bar slot / center drop), the target's current backdrop — if it
  // belongs to a DIFFERENT file — is displaced by the transfer. Stop that
  // file's audio, matching updateGroupBackground's replace semantics. Runs
  // in the drop callback (outside the setGroups updater) so the side effect
  // fires exactly once. New-group destinations can't displace anything.
  const stopDisplacedBackdrop = useCallback(
    (sourceGroupId: string, tabId: string, targetGroupId: string) => {
      if (sourceGroupId === targetGroupId) return
      const src = groups.get(sourceGroupId)
      const movingTab = src?.tabs.find((t) => t.id === tabId)
      if (movingTab?.kind !== 'editor') return
      if (src?.backgroundFileId !== movingTab.fileId) return
      const displaced = groups.get(targetGroupId)?.backgroundFileId
      if (displaced && displaced !== movingTab.fileId) {
        stopBackdropSource(displaced)
      }
    },
    [groups, stopBackdropSource],
  )

  const handleTabClose = useCallback(
    (groupId: string, tabId: string) => {
      let closedTab: WorkspaceTab | null = null
      // Snapshot the tab count BEFORE the close so we can decide below
      // whether this was the last tab in its group and therefore the
      // group itself should collapse (VS Code parity). We read from
      // the current `groups` closure instead of the setGroups updater
      // because the collapse decision branches on the count AFTER
      // removal, and doing it inside the updater would fight React's
      // batching.
      const existing = groups.get(groupId)
      const wasLastTab =
        existing !== undefined && existing.tabs.length === 1
      const canCollapseGroup = wasLastTab && groups.size > 1

      setGroups((prev) => {
        const cur = prev.get(groupId)
        if (!cur) return prev
        const idx = cur.tabs.findIndex((t) => t.id === tabId)
        if (idx === -1) return prev
        closedTab = cur.tabs[idx]
        const nextTabs = cur.tabs.filter((t) => t.id !== tabId)
        let nextActive: string | null = cur.activeTabId
        if (cur.activeTabId === tabId) {
          if (nextTabs.length === 0) {
            nextActive = null
          } else if (idx < nextTabs.length) {
            nextActive = nextTabs[idx].id
          } else {
            nextActive = nextTabs[nextTabs.length - 1].id
          }
        }
        const next = new Map(prev)
        // Auto-collapse: removing the last tab of a non-only group
        // drops the group entirely. Matches VS Code's "close the last
        // tab and the pane goes away" behavior. Only leaves the group
        // around as an empty "Drop a tab here" placeholder when it's
        // the only group in the shell (otherwise the shell would have
        // nowhere to render).
        if (canCollapseGroup) {
          next.delete(groupId)
        } else {
          next.set(groupId, {
            ...cur,
            tabs: nextTabs,
            activeTabId: nextActive,
          })
        }
        return next
      })

      if (canCollapseGroup) {
        setLayout((prev) => layoutRemoveGroup(prev, groupId))
        // If the closed group was the shell-active one, pick a
        // neighbor from the post-remove layout so the user still has
        // a focused group to interact with.
        setActiveGroupId((prev) => {
          if (prev !== groupId) return prev
          const remaining = allGroupIds(layoutRemoveGroup(layout, groupId))
          return remaining[0] ?? prev
        })
      }

      if (closedTab) {
        // If the closed tab was a preview, clean up its pause
        // state. Keyed by file id because preview tabs can be
        // re-opened from the editor chrome and a stale `paused`
        // entry would freeze the fresh render loop immediately.
        const maybePreview = closedTab as WorkspaceTab
        if (maybePreview.kind === 'preview') {
          const fileId = maybePreview.fileId
          setPausedPreviews((prev) => {
            if (!prev.has(fileId)) return prev
            const next = new Set(prev)
            next.delete(fileId)
            return next
          })
          // If this preview tab was pinned to a built-in example
          // audio source, stop it. Without this, closing the
          // preview tab leaves the drum / chord / sample sound
          // looping forever in the background — the user expects
          // "× the tab → silence" and gets only "× the tab → viz
          // gone, audio still playing."
          //
          // Pattern runtime sources are NOT in the built-in
          // registry, so this never reaches into a Strudel /
          // SonicPi tab's audio. Pattern tabs own their own audio
          // and have their own Stop button.
          if (maybePreview.sourceRef.kind === 'file') {
            const builtin = findBuiltinExampleSource(
              maybePreview.sourceRef.fileId,
            )
            if (builtin) builtin.stopIfRunning()
          }
        }
        // #785 — closing a viz FILE (editor) tab tears down everything for that
        // file: stop its backdrop's built-in audio, clear the backdrop in any
        // group pinned to it, and close its side preview (whose close path stops
        // that source). Non-viz editor tabs (Strudel patterns) have no backdrop
        // or viz preview, so every step is a no-op for them.
        if (maybePreview.kind === 'editor') {
          const fileId = maybePreview.fileId
          stopBackdropSource(fileId)
          for (const [gid, g] of groups) {
            if (g.backgroundFileId === fileId) {
              shellActionsRef.current.updateGroupBackground(gid, null)
            }
          }
          const sidePreview = shellActionsRef.current.findTabByFileId(
            fileId,
            'preview',
          )
          if (sidePreview) shellActionsRef.current.closeTab(sidePreview.tabId)
        }
        onTabClose?.(closedTab)
      }
    },
    [groups, layout, onTabClose, stopBackdropSource],
  )

  /**
   * Split a group horizontally — create a new empty group to the east
   * of the given group in the layout. Focus stays on the original
   * group; the new group becomes available as a drop target.
   */
  const handleSplit = useCallback(
    (groupId: string, direction: 'east' | 'south' = 'east') => {
      const newId = generateGroupId()
      setGroups((prev) => {
        const next = new Map(prev)
        next.set(newId, { id: newId, tabs: [], activeTabId: null })
        return next
      })
      setLayout((prev) => layoutInsertGroup(prev, groupId, direction, newId))
    },
    [],
  )

  /**
   * Helper — find a "neighbor" group id for a closing group so its tabs
   * can be merged somewhere. Walks reading order (left-to-right, top-
   * to-bottom) and picks the first group that isn't the closing one.
   * Returns `null` when the closing group is the only group in the
   * layout; callers MUST check and skip the close in that case.
   */
  const findNeighborGroupId = useCallback(
    (closingId: string): string | null => {
      for (const id of allGroupIds(layout)) {
        if (id !== closingId) return id
      }
      return null
    },
    [layout],
  )

  /**
   * Close a group. Merges the closing group's tabs into a neighbor and
   * removes the closing group from the layout (which collapses empty
   * columns via `removeGroup`). No-op when only one group exists — the
   * shell must always have at least one group.
   */
  const handleCloseGroup = useCallback(
    (groupId: string) => {
      const neighborId = findNeighborGroupId(groupId)
      if (!neighborId) return // only one group exists

      let movedTabs: readonly WorkspaceTab[] = []
      setGroups((prev) => {
        const closing = prev.get(groupId)
        const neighbor = prev.get(neighborId)
        if (!closing || !neighbor) return prev
        movedTabs = closing.tabs
        const mergedTabs = [...neighbor.tabs, ...closing.tabs]
        const mergedActive =
          neighbor.activeTabId ??
          (mergedTabs.length > 0 ? mergedTabs[0].id : null)
        const next = new Map(prev)
        next.delete(groupId)
        next.set(neighborId, {
          ...neighbor,
          tabs: mergedTabs,
          activeTabId: mergedActive,
        })
        return next
      })
      setLayout((prev) => layoutRemoveGroup(prev, groupId))
      if (activeGroupId === groupId) {
        setActiveGroupId(neighborId)
      }
      // Swallow `movedTabs` — it's declared for clarity and as a future
      // hook if we want to emit a per-tab "moved" event. Today's
      // consumers only care about close-tab events, not move events.
      void movedTabs
    },
    [findNeighborGroupId, activeGroupId],
  )

  // -------------------------------------------------------------------------
  // Task 08 — Command-system imperative actions
  // -------------------------------------------------------------------------

  /**
   * Create a sibling group to the right of `originGroupId` and insert
   * `newTab` as its sole tab. Used by `workspace.openPreviewToSide`.
   */
  const splitGroupWithTab = useCallback(
    (originGroupId: string, _direction: 'right', newTab: WorkspaceTab) => {
      const newId = generateGroupId()
      setGroups((prev) => {
        const next = new Map(prev)
        next.set(newId, {
          id: newId,
          tabs: [newTab],
          activeTabId: newTab.id,
        })
        return next
      })
      setLayout((prev) => layoutInsertGroup(prev, originGroupId, 'east', newId))
    },
    [],
  )

  /**
   * Move a tab to a brand-new group at one of the four quadrants of an
   * existing target group (N/S/E/W) — used by the per-group quadrant
   * drop zones (Issue #1). The layout helper `insertGroup` handles the
   * 2-D insertion; here we only own the Map updates for the groups'
   * tab lists and clean up the source group if it empties.
   *
   * If removing the tab leaves the source group empty, the source is
   * dropped from both the `groups` Map and the `layout` via
   * `layoutRemoveGroup` (which collapses empty columns). Activates the
   * new group on success so focus follows the drop.
   *
   * No-op if the source tab isn't found or the target group doesn't
   * exist in the layout. Defensive against mid-drag deletions.
   */
  const moveTabToNewQuadrant = useCallback(
    (
      sourceGroupId: string,
      tabId: string,
      targetGroupId: string,
      direction: 'west' | 'east' | 'north' | 'south',
    ) => {
      const source = groups.get(sourceGroupId)
      if (!source) return
      const movingTab = source.tabs.find((t) => t.id === tabId)
      if (!movingTab) return
      if (!findGroupCoords(layout, targetGroupId)) return

      // Degenerate case: the user is trying to split a single-tab
      // group by dragging its only tab to its own quadrant. The
      // resulting state would be "source collapses, new group takes
      // its slot" — visually identical to doing nothing. Skip it so
      // the user's drop feels like a no-op rather than silently
      // "working" into an identical state.
      if (
        sourceGroupId === targetGroupId &&
        source.tabs.length === 1
      ) {
        return
      }

      // Whether the source group will still exist after we remove
      // the moving tab. Matters for the layout update below: if the
      // source stays (multi-tab case), we insert the new group
      // relative to it; if it collapses (sole-tab cross-group move),
      // we remove it from the layout first.
      const sourceWillCollapse = source.tabs.length === 1

      const newId = generateGroupId()
      setGroups((prev) => {
        const next = new Map(prev)
        // Remove tab from source group.
        const srcTabs = source.tabs.filter((t) => t.id !== tabId)
        const srcActive: string | null =
          source.activeTabId === tabId
            ? srcTabs[0]?.id ?? null
            : source.activeTabId
        if (srcTabs.length === 0) {
          next.delete(sourceGroupId)
        } else {
          next.set(sourceGroupId, {
            ...source,
            tabs: srcTabs,
            activeTabId: srcActive,
          })
        }
        next.set(newId, {
          id: newId,
          tabs: [movingTab],
          activeTabId: movingTab.id,
        })
        transferBackdropWithTab(next, source, movingTab, newId)
        return next
      })
      setLayout((prev) => {
        // If the source group just emptied AND isn't the target
        // (which would have made us return above), remove it from
        // the layout first. Then insert the new group in the chosen
        // direction relative to the target.
        const afterRemove =
          sourceWillCollapse && sourceGroupId !== targetGroupId
            ? layoutRemoveGroup(prev, sourceGroupId)
            : prev
        return layoutInsertGroup(afterRemove, targetGroupId, direction, newId)
      })
      setActiveGroupId(newId)
    },
    [groups, layout],
  )

  /**
   * Move a tab to a brand-new group at the leftmost or rightmost edge
   * of the layout — used by the shell's outer edge drop zones. Wraps
   * `layoutInsertEdgeGroup` and handles the `groups` Map side exactly
   * like `moveTabToNewQuadrant`.
   */
  const moveTabToNewEdgeGroup = useCallback(
    (sourceGroupId: string, tabId: string, position: 'start' | 'end') => {
      const source = groups.get(sourceGroupId)
      if (!source) return
      const movingTab = source.tabs.find((t) => t.id === tabId)
      if (!movingTab) return

      const newId = generateGroupId()
      setGroups((prev) => {
        const next = new Map(prev)
        const srcTabs = source.tabs.filter((t) => t.id !== tabId)
        const srcActive: string | null =
          source.activeTabId === tabId
            ? srcTabs[0]?.id ?? null
            : source.activeTabId
        if (srcTabs.length === 0) {
          next.delete(sourceGroupId)
        } else {
          next.set(sourceGroupId, {
            ...source,
            tabs: srcTabs,
            activeTabId: srcActive,
          })
        }
        next.set(newId, {
          id: newId,
          tabs: [movingTab],
          activeTabId: movingTab.id,
        })
        transferBackdropWithTab(next, source, movingTab, newId)
        return next
      })
      setLayout((prev) => {
        const afterRemove =
          source.tabs.length === 1
            ? layoutRemoveGroup(prev, sourceGroupId)
            : prev
        return layoutInsertEdgeGroup(afterRemove, position, newId)
      })
      setActiveGroupId(newId)
    },
    [groups],
  )

  /**
   * Toggle the background decoration on a group. Pass a FILE id to pin
   * that file's preview behind the editor; `null` clears the backdrop.
   * The file id is stored directly (not tab-scoped) so the backdrop
   * survives tab switches and lifts cleanly when the file is deleted.
   */
  const updateGroupBackground = useCallback(
    (groupId: string, backgroundFileId: string | null) => {
      // Check current value before writing so the callback only fires
      // on real changes — keeps the notification stream tight for
      // persistence consumers that would otherwise see echoes.
      const prev = groups.get(groupId)?.backgroundFileId ?? null
      if (prev === backgroundFileId) return
      // Leaving or replacing a backdrop stops the built-in audio it started
      // (#785) — covers preview=off, Cmd+K B toggle-off, and switching backdrops.
      if (prev) stopBackdropSource(prev)
      updateGroup(groupId, (g) => ({
        ...g,
        backgroundFileId: backgroundFileId ?? undefined,
      }))
      onBackgroundFileChange?.(groupId, backgroundFileId)
    },
    [groups, updateGroup, onBackgroundFileChange, stopBackdropSource],
  )

  /**
   * Set/clear a group's transient code-override backdrop (#350a). `null` deletes
   * the override so the manual sticky shows again. Idempotent — repeated equal
   * calls (every eval in live mode) are no-ops, so there's no per-frame churn.
   */
  const updateGroupOverride = useCallback(
    (groupId: string, overrideFileId: string | null) => {
      setBgOverrides((prev) => {
        const cur = prev.get(groupId) ?? null
        if (cur === overrideFileId) return prev
        const next = new Map(prev)
        if (overrideFileId == null) next.delete(groupId)
        else next.set(groupId, overrideFileId)
        return next
      })
    },
    [],
  )

  /**
   * Set/clear a group's per-pane backdrop opacity override (#350c). `null`
   * drops the override so the global default applies again. Idempotent —
   * persisted via the normal `onGroupsChange` sink (it's user intent, not
   * transient code state, so unlike the override it lives on the snapshot).
   */
  const updateGroupBackdropOpacity = useCallback(
    (groupId: string, opacity: number | null) => {
      const prev = groups.get(groupId)?.backdropOpacity
      const nextVal =
        opacity == null ? undefined : Math.min(1, Math.max(0, opacity))
      if (prev === nextVal) return
      updateGroup(groupId, (g) => ({ ...g, backdropOpacity: nextVal }))
    },
    [groups, updateGroup],
  )

  /** Set/clear a group's per-pane backdrop quality override (#350c). */
  const updateGroupBackdropQuality = useCallback(
    (groupId: string, quality: BackdropQuality | null) => {
      const prev = groups.get(groupId)?.backdropQuality
      const nextVal = quality ?? undefined
      if (prev === nextVal) return
      updateGroup(groupId, (g) => ({ ...g, backdropQuality: nextVal }))
    },
    [groups, updateGroup],
  )

  /**
   * Close a tab by id — scans every group, removes the matching tab, and
   * fires the normal `handleTabClose` path so runtime disposal (U3) still
   * runs. No-op if the tab id isn't found. If closing the tab empties a
   * group that isn't the last group, the empty group is removed from
   * `groupOrder` so the split layout collapses cleanly — matching the
   * "close the preview tab = dismiss the panel" expectation.
   */
  const closeTabById = useCallback(
    (tabId: string) => {
      let ownerGroupId: string | null = null
      for (const [gid, g] of groups.entries()) {
        if (g.tabs.some((t) => t.id === tabId)) {
          ownerGroupId = gid
          break
        }
      }
      if (!ownerGroupId) return
      handleTabClose(ownerGroupId, tabId)

      // Collapse the group if it's now empty AND we have more than one
      // group. Single-group shells keep the empty group around so the
      // shell doesn't render a blank screen with no tab bar.
      const owner = groups.get(ownerGroupId)
      const wasLastTab = owner ? owner.tabs.length === 1 : false
      const willCollapse = wasLastTab && groups.size > 1

      if (willCollapse) {
        setGroups((prev) => {
          if (prev.size <= 1) return prev
          const next = new Map(prev)
          next.delete(ownerGroupId!)
          return next
        })
        setLayout((prev) => layoutRemoveGroup(prev, ownerGroupId!))
        // If the closed group was active, pick the first remaining
        // group from the post-remove layout.
        setActiveGroupId((prev) => {
          if (prev !== ownerGroupId) return prev
          const remaining = allGroupIds(
            layoutRemoveGroup(layout, ownerGroupId!),
          )
          return remaining[0] ?? prev
        })
      }
    },
    [groups, layout, handleTabClose],
  )

  /**
   * Find the first tab with the given file id and kind across all groups.
   * Returns `{ groupId, tabId }` or `null`. The chrome uses this to check
   * whether a preview already exists for the editor tab's file — drives
   * the Play/Stop toggle state on the viz chrome's primary button.
   */
  const findTabByFileId = useCallback(
    (
      fileId: string,
      kind: 'editor' | 'preview',
    ): { groupId: string; tabId: string } | null => {
      for (const [gid, g] of groups.entries()) {
        for (const t of g.tabs) {
          if (t.kind === kind && t.fileId === fileId) {
            return { groupId: gid, tabId: t.id }
          }
        }
      }
      return null
    },
    [groups],
  )

  /**
   * Find the first group that currently contains ANY preview tab. Returns
   * its id or `null` if no group hosts a preview. The chrome's "open
   * preview" handler uses this to REUSE an existing preview area instead
   * of always splitting off a new group — so once the user has opened
   * one preview pane (and possibly resized it), every subsequent "Play"
   * on a different viz file adds its preview to the same pane instead
   * of spawning a parallel split.
   *
   * Treating "any group with any preview tab" as the reuse target
   * (rather than requiring the group to be adjacent or empty-except-for
   * -previews) matches the VS Code side-panel semantic: the user's
   * mental model is "the preview panel," singular, and the shell should
   * preserve that expectation even though structurally it's just a
   * group with preview tabs in it.
   */
  const findGroupWithAnyPreview = useCallback((): string | null => {
    for (const [gid, g] of groups.entries()) {
      if (g.tabs.some((t) => t.kind === 'preview')) return gid
    }
    return null
  }, [groups])

  /**
   * WorkspaceShellActions object for the command system. Stable reference
   * via useMemo since the callbacks themselves are stable (useCallback).
   */
  const shellActionsRef = useRef<WorkspaceShellActions>(null as unknown as WorkspaceShellActions)
  const shellActions: WorkspaceShellActions = useMemo(
    () => ({
      addTab: (groupId: string, tab: WorkspaceTab) => {
        updateGroup(groupId, (g) => ({
          ...g,
          tabs: [...g.tabs, tab],
          activeTabId: tab.id,
        }))
      },
      splitGroupWithTab,
      updateGroupBackground,
      closeTab: closeTabById,
      findTabByFileId,
      // #240 — forward Cmd+K W to the app host (which owns the runtime + audio
      // bus needed to mount the popout). Undefined when the host doesn't wire
      // it → the command's `shell.openPopoutPreview?.()` no-ops.
      openPopoutPreview: onOpenPopoutPreview,
    }),
    [splitGroupWithTab, updateGroupBackground, updateGroup, closeTabById, findTabByFileId, onOpenPopoutPreview],
  )
  shellActionsRef.current = shellActions

  // -------------------------------------------------------------------------
  // Task 08 — Keyboard commands (Cmd+K chord)
  // -------------------------------------------------------------------------

  // Stable getter refs for the keyboard hook. The hook stores these in a
  // ref so the listener always reads current state without re-attachment.
  const getActiveTab = useCallback((): WorkspaceTab | null => activeTab, [activeTab])
  const getActiveGroupId = useCallback((): string | null => activeGroupId, [activeGroupId])
  const getActiveGroup = useCallback((): WorkspaceGroupState | null => {
    return groups.get(activeGroupId) ?? null
  }, [groups, activeGroupId])

  /**
   * Bridge the shell's `previewProviderFor` prop (keyed by tab) with the
   * command system's `getPreviewProvider` (keyed by language). When the
   * prop is supplied (tests inject stubs here), we construct a synthetic
   * preview-tab stub with the active editor's fileId so the prop callback
   * can match on it. Falls back to the module-level registry.
   */
  const getPreviewProviderForCommand = useCallback(
    (language: string) => {
      // Module-level registry first (production path).
      const fromRegistry = getPreviewProviderForLanguage(language)
      if (fromRegistry) return fromRegistry

      // Prop-level fallback (test path): construct a stub preview tab
      // using the current active editor tab's fileId.
      if (previewProviderFor) {
        const currentTab = activeTab
        const fileId = currentTab?.fileId ?? ''
        return previewProviderFor({
          kind: 'preview',
          id: '__cmd-lookup__',
          fileId,
          sourceRef: { kind: 'default' },
        })
      }
      return undefined
    },
    [previewProviderFor, activeTab],
  )

  useKeyboardCommands({
    getActiveTab,
    getActiveGroupId,
    getActiveGroup,
    shellActions,
    getPreviewProvider: getPreviewProviderForCommand,
  })

  /**
   * Edge drop handler (Issue #1). Parses the DRAG_MIME payload and moves
   * the tab to a brand-new group at the target edge position. No-op on
   * malformed payloads or unknown tab ids — edges behave as inert
   * backdrops in the error cases, matching the expectation that "drop
   * that did nothing" is visible by the tab snapping back to its source.
   */
  const handleEdgeDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, position: 'start' | 'end') => {
      e.preventDefault()
      e.stopPropagation()
      setDragOverEdge(null)
      const raw = e.dataTransfer.getData(DRAG_MIME)
      if (!raw) return
      let payload: DragPayload
      try {
        payload = JSON.parse(raw)
      } catch {
        return
      }
      moveTabToNewEdgeGroup(payload.sourceGroupId, payload.tabId, position)
    },
    [moveTabToNewEdgeGroup],
  )

  const handleEdgeDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, position: 'start' | 'end') => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (dragOverEdge !== position) setDragOverEdge(position)
    },
    [dragOverEdge],
  )

  const handleEdgeDragLeave = useCallback(() => {
    setDragOverEdge(null)
  }, [])

  // Shell-level Cmd+S / Ctrl+S save: dispatches to the host-supplied
  // `onSaveFile` with the currently-active editor tab. The host decides
  // what "save" means for that file type (e.g., `flushToPreset` for viz
  // files backed by `VizPresetStore`). No-op if no onSaveFile is
  // registered, or if the active tab is not an editor tab.
  const onSaveFileRef = useRef(onSaveFile)
  onSaveFileRef.current = onSaveFile
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key !== 's' && e.key !== 'S') return
      const current = onSaveFileRef.current
      if (!current) return
      const tab = activeTab
      if (!tab || tab.kind !== 'editor') return
      e.preventDefault()
      current(tab)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeTab])

  /**
   * Drag start handler. Writes the payload into the dataTransfer using
   * the `DRAG_MIME` type. We also stash the tab id on a JSON payload so
   * the drop handler can look up the source group without relying on
   * cross-component state. Flips the shell's `tabDragInProgress` flag
   * so edge drop zones become click-active for the duration of the
   * drag (Issue #1).
   */
  const handleTabDragStart = useCallback(
    (
      e: React.DragEvent<HTMLDivElement>,
      groupId: string,
      tab: WorkspaceTab,
    ) => {
      const payload: DragPayload = { sourceGroupId: groupId, tabId: tab.id }
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
      e.dataTransfer.effectAllowed = 'move'
      setTabDragInProgress(true)
    },
    [],
  )

  // Reset drag-in-progress state on any dragend (drop inside, drop
  // outside, ESC cancel). Window-level because dragend fires on the
  // source element, which may have been unmounted by the time the
  // event lands if the tab moved between groups during the drag.
  useEffect(() => {
    const onDragEnd = () => {
      setTabDragInProgress(false)
      setDragOverEdge(null)
      setDragOverTarget(null)
    }
    window.addEventListener('dragend', onDragEnd)
    window.addEventListener('drop', onDragEnd)
    return () => {
      window.removeEventListener('dragend', onDragEnd)
      window.removeEventListener('drop', onDragEnd)
    }
  }, [])

  /**
   * Compute the drop quadrant for a tab-drag event relative to an
   * element's bounding rect. Four outer quadrants + a center region:
   *
   *   +--------+--------+
   *   |   NW   |   NE   |   ← but we only care about N/S/E/W, so the
   *   +--------+--------+     diagonal gets assigned to whichever
   *   |   SW   |   SE   |     edge the cursor is closer to.
   *   +--------+--------+
   *
   * The center region is a 40% × 40% box in the middle — dropping
   * there keeps the existing "add tab to this group" behavior. Outside
   * the center, the cursor's distance to each of the four edges (as a
   * fraction) decides the direction.
   */
  const computeQuadrant = useCallback(
    (e: React.DragEvent<HTMLElement>, el: HTMLElement): DropDirection => {
      const rect = el.getBoundingClientRect()
      // Degenerate rect (zero width/height) — happens in jsdom tests
      // that don't compute layout, or during transitions. Default to
      // `'center'` so programmatic tests that fire synthetic drops get
      // the intuitive "add to target group" behavior without having to
      // mock getBoundingClientRect.
      if (rect.width <= 0 || rect.height <= 0) return 'center'
      const y = (e.clientY - rect.top)
      // VS Code parity: the top strip (tab bar + optional runtime chrome
      // bar) is a "reorder / add as tab" zone — split quadrants only
      // activate once the cursor moves past it. Tab bar is 30px, chrome
      // bar (when present) is 40px → 70px. A small buffer (10px) keeps
      // borderline drops predictable.
      const SPLIT_ACTIVATE_Y = 80
      if (y < SPLIT_ACTIVATE_Y) return 'center'
      const x = (e.clientX - rect.left) / rect.width
      const yFrac = y / rect.height
      if (Number.isNaN(x) || Number.isNaN(yFrac)) return 'center'
      // Center: 30%..70% both dimensions.
      if (x >= 0.3 && x <= 0.7 && yFrac >= 0.3 && yFrac <= 0.7) {
        return 'center'
      }
      // Pick the nearest edge (smallest fractional distance).
      const distWest = x
      const distEast = 1 - x
      const distNorth = yFrac
      const distSouth = 1 - yFrac
      const min = Math.min(distWest, distEast, distNorth, distSouth)
      if (min === distWest) return 'west'
      if (min === distEast) return 'east'
      if (min === distNorth) return 'north'
      return 'south'
    },
    [],
  )

  /**
   * Drop handler for a target group. Parses the payload, computes the
   * drop quadrant, and dispatches:
   *
   *   - `'center'` → add the tab to the target group (existing
   *     behavior — drop-on-group means "combine").
   *   - `'west'`/`'east'` → create a new column adjacent to the target.
   *   - `'north'`/`'south'` → split the target's column vertically and
   *     stack the new group above or below.
   *
   * The direction-based cases go through `moveTabToNewQuadrant` which
   * delegates to the pure `insertGroup` layout helper so the 2-D
   * arithmetic is tested in isolation.
   */
  /**
   * Tab bar drop — VS Code-style reorder / move-by-index. Computes the
   * insertion point from the cursor X relative to each tab-header's
   * rect, then either reorders within the same group or moves the tab
   * across groups into the specific slot. Drops exactly on the original
   * position are a no-op ("snap back").
   */
  const handleTabBarDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, targetGroupId: string) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return
      e.preventDefault()
      e.stopPropagation()
      setDragOverTarget(null)
      const raw = e.dataTransfer.getData(DRAG_MIME)
      if (!raw) return
      let payload: DragPayload
      try {
        payload = JSON.parse(raw)
      } catch {
        return
      }
      const { sourceGroupId, tabId } = payload
      stopDisplacedBackdrop(sourceGroupId, tabId, targetGroupId)

      // Find the target-tab index from the cursor X. Each rendered tab
      // has a data-workspace-tab attr on its header node; left-half of
      // the tab means "insert before", right-half means "insert after".
      const tabNodes = (
        e.currentTarget as HTMLElement
      ).querySelectorAll<HTMLElement>('[data-workspace-tab]')
      let insertionIndex = tabNodes.length
      for (let i = 0; i < tabNodes.length; i++) {
        const r = tabNodes[i].getBoundingClientRect()
        if (e.clientX < r.left + r.width / 2) {
          insertionIndex = i
          break
        }
      }

      setGroups((prev) => {
        const source = prev.get(sourceGroupId)
        const target = prev.get(targetGroupId)
        if (!source || !target) return prev
        const movingTab = source.tabs.find((t) => t.id === tabId)
        if (!movingTab) return prev

        if (sourceGroupId === targetGroupId) {
          // Same-group reorder. Compute the actual destination index
          // accounting for the removal of the moving tab from earlier
          // in the list.
          const fromIdx = source.tabs.findIndex((t) => t.id === tabId)
          if (fromIdx === -1) return prev
          let toIdx = insertionIndex
          if (toIdx > fromIdx) toIdx -= 1
          if (toIdx === fromIdx) return prev // snap back
          const nextTabs = source.tabs.slice()
          nextTabs.splice(fromIdx, 1)
          nextTabs.splice(toIdx, 0, movingTab)
          const next = new Map(prev)
          next.set(targetGroupId, { ...source, tabs: nextTabs })
          return next
        }

        // Cross-group move into a specific slot in the target tab bar.
        const sourceTabs = source.tabs.filter((t) => t.id !== tabId)
        let sourceActive: string | null = source.activeTabId
        if (source.activeTabId === tabId) {
          sourceActive = sourceTabs.length > 0 ? sourceTabs[0].id : null
        }
        const targetTabs = target.tabs.slice()
        const clamped = Math.max(0, Math.min(insertionIndex, targetTabs.length))
        targetTabs.splice(clamped, 0, movingTab)
        const next = new Map(prev)
        if (sourceTabs.length === 0 && prev.size > 1) {
          next.delete(sourceGroupId)
        } else {
          next.set(sourceGroupId, {
            ...source,
            tabs: sourceTabs,
            activeTabId: sourceActive,
          })
        }
        next.set(targetGroupId, {
          ...target,
          tabs: targetTabs,
          activeTabId: tabId,
        })
        transferBackdropWithTab(next, source, movingTab, targetGroupId)
        return next
      })
      setActiveGroupId(targetGroupId)
    },
    [stopDisplacedBackdrop],
  )

  const handleDropOnGroup = useCallback(
    (e: React.DragEvent<HTMLDivElement>, targetGroupId: string) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOverTarget(null)
      const raw = e.dataTransfer.getData(DRAG_MIME)
      if (!raw) return
      let payload: DragPayload
      try {
        payload = JSON.parse(raw)
      } catch {
        return
      }
      const { sourceGroupId, tabId } = payload
      const direction = computeQuadrant(e, e.currentTarget)

      // Drop on own group in the center = just activate the tab.
      // Directional drops on the SAME group (the common case when the
      // shell starts with all tabs in one group) fall through to the
      // split path below — `moveTabToNewQuadrant` handles the edge
      // case where the source has only one tab.
      if (sourceGroupId === targetGroupId && direction === 'center') {
        setGroups((prev) => {
          const g = prev.get(targetGroupId)
          if (!g) return prev
          const tab = g.tabs.find((t) => t.id === tabId)
          if (!tab) return prev
          const next = new Map(prev)
          next.set(targetGroupId, { ...g, activeTabId: tabId })
          return next
        })
        setActiveGroupId(targetGroupId)
        return
      }

      if (direction === 'center') {
        // Cross-group drop into the center: add the moving tab to the
        // target group's tab list, remove from the source.
        stopDisplacedBackdrop(sourceGroupId, tabId, targetGroupId)
        setGroups((prev) => {
          const source = prev.get(sourceGroupId)
          const target = prev.get(targetGroupId)
          if (!source || !target) return prev
          const movingTab = source.tabs.find((t) => t.id === tabId)
          if (!movingTab) return prev
          const sourceTabs = source.tabs.filter((t) => t.id !== tabId)
          let sourceActive: string | null = source.activeTabId
          if (source.activeTabId === tabId) {
            sourceActive = sourceTabs.length > 0 ? sourceTabs[0].id : null
          }
          const next = new Map(prev)
          // Collapse source if it just emptied AND we have other groups.
          if (sourceTabs.length === 0 && prev.size > 1) {
            next.delete(sourceGroupId)
          } else {
            next.set(sourceGroupId, {
              ...source,
              tabs: sourceTabs,
              activeTabId: sourceActive,
            })
          }
          next.set(targetGroupId, {
            ...target,
            tabs: [...target.tabs, movingTab],
            activeTabId: tabId,
          })
          transferBackdropWithTab(next, source, movingTab, targetGroupId)
          return next
        })
        // If the source was collapsed, drop it from the layout too.
        setLayout((prev) => {
          const source = groups.get(sourceGroupId)
          if (!source || source.tabs.length !== 1) return prev
          return layoutRemoveGroup(prev, sourceGroupId)
        })
        setActiveGroupId(targetGroupId)
        return
      }

      // Directional drop → create a new split group adjacent to target.
      moveTabToNewQuadrant(sourceGroupId, tabId, targetGroupId, direction)
    },
    [computeQuadrant, groups, moveTabToNewQuadrant, stopDisplacedBackdrop],
  )

  /**
   * Dispatch a single tab to its view component. Exhaustiveness-checked
   * so a new `WorkspaceTab` kind fails compile if this switch is not
   * updated alongside the type.
   */
  const renderTabContent = useCallback(
    (
      tab: WorkspaceTab,
      groupId: string,
      isActive: boolean,
    ): React.ReactNode => {
      switch (tab.kind) {
        case 'editor': {
          // Runtime chrome (pattern files) comes from the host's chromeForTab.
          // Preview chrome (viz files) comes from the preview provider's
          // renderEditorChrome — tried as a fallback when no runtime chrome.
          let chromeSlot: React.ReactNode = chromeForTab?.(tab) ?? undefined
          if (!chromeSlot && previewProviderFor) {
            const previewTab = { ...tab, kind: 'preview' as const, sourceRef: { kind: 'default' as const } }
            const provider = previewProviderFor(previewTab as any)
            if (provider?.renderEditorChrome) {
              const file = getFile(tab.fileId)
              if (file) {
                const existingPreview = findTabByFileId(tab.fileId, 'preview')
                chromeSlot = provider.renderEditorChrome({
                  file,
                  previewOpen: existingPreview !== null,
                  previewPaused: pausedPreviews.has(tab.fileId),
                  onTogglePausePreview: () => {
                    // Flip the file's entry in the pausedPreviews
                    // set. The resulting state change propagates
                    // through PreviewView → provider ctx →
                    // CompiledVizMount's pause/resume effect.
                    //
                    // ALSO dispatch start/stop on the built-in
                    // example audio source IF the open preview is
                    // pinned to one. The shell is the right place
                    // for this — not the chrome — because the
                    // chrome's local `selectedSource` state can
                    // get wiped when the layout shape transitions
                    // (e.g., splitting from one group to two
                    // remounts the chrome subtree). The shell-
                    // owned preview tab's `sourceRef` survives
                    // those remounts because it lives in the
                    // groups map, not in component state.
                    //
                    // Pattern runtime sources are NOT in the
                    // built-in registry and stay untouched —
                    // they're owned by their own pattern tab.
                    const wasPaused = pausedPreviews.has(tab.fileId)
                    setPausedPreviews((prev) => {
                      const next = new Set(prev)
                      if (next.has(tab.fileId)) next.delete(tab.fileId)
                      else next.add(tab.fileId)
                      return next
                    })
                    const previewTabLoc =
                      shellActionsRef.current.findTabByFileId(
                        tab.fileId,
                        'preview',
                      )
                    if (previewTabLoc) {
                      const previewTabObj = groups
                        .get(previewTabLoc.groupId)
                        ?.tabs.find((t) => t.id === previewTabLoc.tabId)
                      if (
                        previewTabObj &&
                        previewTabObj.kind === 'preview' &&
                        previewTabObj.sourceRef.kind === 'file'
                      ) {
                        const builtin = findBuiltinExampleSource(
                          previewTabObj.sourceRef.fileId,
                        )
                        if (builtin) {
                          if (wasPaused) {
                            // Resuming after Stop — re-arm the
                            // audio loop so the viz has live data.
                            builtin.startIfIdle()
                          } else {
                            // Pausing — silence the built-in audio
                            // alongside freezing the viz draw loop.
                            builtin.stopIfRunning()
                          }
                        }
                      }
                    }
                  },
                  onChangePreviewSource: (nextRef) => {
                    // Find the open preview tab for this file and
                    // update its sourceRef in place. Task 2's
                    // sourceRef-keyed React tree triggers a remount
                    // on the swap, so setup() re-runs with the
                    // fresh injected refs and any stale module-
                    // level caches get reset. If no preview is
                    // open (shouldn't happen because the chrome
                    // guards on previewOpen before calling this),
                    // silently no-op.
                    const current =
                      shellActionsRef.current.findTabByFileId(
                        tab.fileId,
                        'preview',
                      )
                    if (!current) return
                    updateGroup(current.groupId, (g) => ({
                      ...g,
                      tabs: g.tabs.map((t) =>
                        t.id === current.tabId && t.kind === 'preview'
                          ? { ...t, sourceRef: nextRef }
                          : t,
                      ),
                    }))
                  },
                  onOpenPreview: (selectedSourceRef) => {
                    // Idempotent open: if a preview tab for this file
                    // already exists anywhere in the shell, return
                    // early. Viz tabs are editing surfaces, not
                    // transports — the preview is closed by its own
                    // ✕ button, not by a chrome action. Re-read via
                    // shellActionsRef so a stale closure (after a
                    // user dragged the preview tab elsewhere) still
                    // resolves correctly.
                    const current = shellActionsRef.current.findTabByFileId(
                      tab.fileId,
                      'preview',
                    )
                    if (current) {
                      return
                    }

                    // Issue #4b: the chrome's source dropdown lets the
                    // user pin the new preview tab to a specific audio
                    // publisher (a pattern file, the sample sound, or
                    // none). Default to follow-most-recent if the chrome
                    // didn't supply one.
                    const sourceRef = selectedSourceRef ?? { kind: 'default' as const }

                    // Issue #4a: reuse an existing preview pane if any
                    // group already hosts preview tabs. Only split off a
                    // new group when no preview pane exists yet. This
                    // matches the "one preview panel" mental model while
                    // still allowing the user to manually split further
                    // via drag-drop.
                    const existingPreviewGroup = findGroupWithAnyPreview()
                    if (existingPreviewGroup) {
                      const newTab: WorkspaceTab = {
                        kind: 'preview',
                        id: `preview-${tab.fileId}-${Date.now()}`,
                        fileId: tab.fileId,
                        sourceRef,
                      }
                      shellActionsRef.current.addTab(
                        existingPreviewGroup,
                        newTab,
                      )
                      return
                    }

                    // No existing preview area — split off a new group.
                    // Inline the split here (rather than going through
                    // the command) so we can thread the selected
                    // sourceRef; the command defaults to 'default' and
                    // doesn't accept an override.
                    const newTab: WorkspaceTab = {
                      kind: 'preview',
                      id: `preview-${tab.fileId}-${Date.now()}`,
                      fileId: tab.fileId,
                      sourceRef,
                    }
                    shellActionsRef.current.splitGroupWithTab(
                      groupId,
                      'right',
                      newTab,
                    )
                  },
                  onToggleBackground: (sourceRef) => {
                    // Whether this toggle ACTIVATES the backdrop (vs clears it).
                    // On activate, record the source so teardown can stop it
                    // (#785); the clear direction is handled by
                    // updateGroupBackground, which stops the prior source.
                    const willActivate =
                      groups.get(groupId)?.backgroundFileId !== tab.fileId
                    executeCommand('workspace.toggleBackgroundPreview', {
                      activeTab: tab,
                      activeGroupId: groupId,
                      activeGroup: groups.get(groupId) ?? null,
                      shell: shellActionsRef.current,
                      getPreviewProvider: (lang) => {
                        const pTab = { kind: 'preview' as const, id: '', fileId: '', sourceRef: { kind: 'default' as const } }
                        return previewProviderFor?.({ ...pTab, fileId: tab.fileId }) ?? undefined
                      },
                    })
                    // Only FILE refs are recorded: they're what teardown can
                    // stop. A 'default'/'none' activation must NOT clobber an
                    // existing file-ref entry — that entry tracks audio this
                    // file already started that is still running, and
                    // overwriting it would leak the source past close (#787).
                    if (willActivate && sourceRef?.kind === 'file') {
                      backdropSourceByFile.current.set(tab.fileId, sourceRef)
                    }
                  },
                  // #788 — the popover's source dropdown changed while this
                  // file's backdrop is live. The chrome already swapped the
                  // audio (start next / stop prev, #784); re-key the teardown
                  // record so close / clear stops the CURRENT source. Non-file
                  // refs (default / none) clear the record — their swap already
                  // stopped whatever built-in was playing, so teardown has
                  // nothing left to own.
                  onBackdropSourceChange: (ref) => {
                    if (
                      groups.get(groupId)?.backgroundFileId !== tab.fileId
                    ) {
                      return
                    }
                    if (ref.kind === 'file') {
                      backdropSourceByFile.current.set(tab.fileId, ref)
                    } else {
                      backdropSourceByFile.current.delete(tab.fileId)
                    }
                  },
                  isBackground:
                    groups.get(groupId)?.backgroundFileId === tab.fileId,
                  // #773 — close THIS file's side preview when the viz-settings
                  // popover switches to 'off' or 'backdrop'. Re-read via
                  // shellActionsRef so a stale closure (after the preview tab was
                  // dragged elsewhere) still resolves the current location.
                  onClosePreview: () => {
                    const p = shellActionsRef.current.findTabByFileId(
                      tab.fileId,
                      'preview',
                    )
                    if (p) closeTabById(p.tabId)
                  },
                  // #773 — backdrop controls surfaced inside the viz-settings
                  // popover when this file is the group backdrop. Values are the
                  // group's RESOLVED settings (override ?? global default);
                  // setters route to the group override. Crop/reveal come from
                  // the host (app popups).
                  backdropOpacity:
                    groups.get(groupId)?.backdropOpacity ?? backdropOpacity,
                  backdropQuality:
                    groups.get(groupId)?.backdropQuality ?? backdropQuality,
                  backdropVizSpan,
                  onSetBackdropOpacity: (v) =>
                    updateGroupBackdropOpacity(groupId, v),
                  onSetBackdropQuality: (q) =>
                    updateGroupBackdropQuality(groupId, q),
                  onSetBackdropVizSpan: (s) => setBackdropVizSpan(s),
                  onCropBackdrop,
                  onRevealBackdrop,
                  onSave: () => {
                    // Bridge to the host-supplied save callback. The host
                    // owns the persistence layer (e.g., flushToPreset for
                    // viz files backed by VizPresetStore). Same code path
                    // the window-level Cmd+S listener takes.
                    onSaveFileRef.current?.(tab)
                  },
                  // hotReload / onToggleHotReload are optional on the
                  // PreviewEditorChromeContext interface. Phase 10.2 ships
                  // a provider-level reload policy (always-on for viz);
                  // per-tab toggle is a follow-up phase.
                })
              }
            }
          }
          const extras = editorExtrasForTab?.(tab as WorkspaceTab & { kind: 'editor' })
          return (
            <ErrorBoundary key={tab.id} resetKey={tab.fileId}>
              <EditorView
                fileId={tab.fileId}
                chromeSlot={chromeSlot}
                theme={theme}
                onPlay={extras?.onPlay}
                onStop={extras?.onStop}
                error={extras?.error}
                onEditViz={onEditViz}
                onCropViz={onCropViz}
              />
            </ErrorBoundary>
          )
        }
        case 'preview': {
          const provider = previewProviderFor?.(tab)
          if (!provider) {
            return (
              <div
                data-testid={`preview-no-provider-${tab.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: 'var(--foreground-muted)',
                  fontSize: 12,
                }}
              >
                No preview provider registered for this file type.
              </div>
            )
          }
          return (
            <PreviewView
              key={tab.id}
              fileId={tab.fileId}
              provider={provider}
              sourceRef={tab.sourceRef}
              theme={theme}
              // Issue #3 fix: only the active tab of each group is
              // mounted here, so by the time PreviewView renders the tab
              // is always visible. The old `hidden={!isActive}` was
              // wrong — it paused viz previews whenever the user focused
              // a different group, even though the preview was still
              // on-screen. D-03's "pause when hidden" is for the
              // tab-switched-away case, which the shell handles by
              // simply not rendering inactive tabs at all.
              hidden={false}
              paused={pausedPreviews.has(tab.fileId)}
              onSourceRefChange={(nextRef) => {
                // Update the tab's sourceRef in place. Tab id is stable,
                // so we replace the tab object inside the group while
                // preserving its order.
                updateGroup(groupId, (g) => ({
                  ...g,
                  tabs: g.tabs.map((t) =>
                    t.id === tab.id && t.kind === 'preview'
                      ? { ...t, sourceRef: nextRef }
                      : t,
                  ),
                }))
              }}
            />
          )
        }
        case 'history': {
          // Read-only commit Diff / time-travel View, hosted full-size in
          // the main editor area (#210). The overlay components use
          // `position:absolute; inset:0`, so a relative full-height wrapper
          // makes them fill the tab. The commit content is immutable, so a
          // non-reactive `getCurrentHistory()` read is sufficient.
          const history = getCurrentHistory()
          const commit = history ? getCommit(history, tab.commitId) : undefined
          if (!history || !commit) {
            return (
              <div
                data-testid={`history-tab-missing-${tab.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: 'var(--foreground-muted)',
                  fontSize: 12,
                }}
              >
                This commit is no longer available.
              </div>
            )
          }
          // Keep a stable key per tab so a same-mode file swap updates the
          // diff models in place (the picker path) rather than remounting
          // the editor. Diff↔View remount anyway (different components).
          return (
            <div style={{ position: 'relative', height: '100%', width: '100%' }}>
              {tab.mode === 'view' ? (
                <HistoryViewOverlay
                  key={`${tab.id}:view`}
                  history={history}
                  commit={commit}
                  initialFileId={tab.fileId}
                  onClose={() => closeTabById(tab.id)}
                />
              ) : (
                <HistoryDiffOverlay
                  key={`${tab.id}:diff`}
                  history={history}
                  commit={commit}
                  initialFileId={tab.fileId}
                  defaultMode={tab.vsCurrent ? 'current' : 'previous'}
                  pickerFileIds={tab.pickerFileIds}
                  onClose={() => closeTabById(tab.id)}
                />
              )}
            </div>
          )
        }
        default:
          return assertNever(tab)
      }
    },
    // Issue #2 fix: `groups` and `findTabByFileId` must be in the dep
    // array so `previewOpen` stays fresh after a preview tab is added.
    // Without them, renderTabContent holds a stale closure over the
    // old groups map, findTabByFileId always returns null, and the
    // chrome's Play button never flips to Stop. editorExtrasForTab and
    // findGroupWithAnyPreview are also added because they were silently
    // missing before.
    //
    // `pausedPreviews` must ALSO be a dep — without it, a second-click
    // Stop → Play transition can't refresh the chrome. The first click
    // (Preview → Stop) happens to work because `groups` changes (a
    // preview tab is added), invalidating the callback. The second
    // click only changes `pausedPreviews`, and without this dep the
    // callback returns a cached function that reads a stale
    // `pausedPreviews.has(fileId) === false` via its closure. The
    // regression test in WorkspaceShell.test.tsx covers this exact
    // path and fails without `pausedPreviews` in the deps.
    [
      chromeForTab,
      previewProviderFor,
      theme,
      updateGroup,
      groups,
      pausedPreviews,
      findTabByFileId,
      findGroupWithAnyPreview,
      editorExtrasForTab,
      closeTabById,
      // P239 guard — the viz-settings ctx (#773) reads these; without them
      // in the deps the callback closes over stale backdrop settings /
      // handlers and the popover controls act on outdated values.
      backdropOpacity,
      backdropQuality,
      backdropVizSpan,
      updateGroupBackdropOpacity,
      updateGroupBackdropQuality,
      onCropBackdrop,
      onRevealBackdrop,
    ],
  )

  // #770 — in 'workspace' span mode, ONE backdrop spans every pane. It's driven
  // by the FIRST group (in layout order) that has a backdrop set — stable, so it
  // doesn't change or vanish as focus moves between panes. Null in 'file' mode or
  // when no pane has a backdrop.
  const workspaceSpanBackdrop = useMemo(() => {
    if (backdropVizSpan !== 'workspace') return null
    for (const gid of allGroupIds(layout)) {
      const g = groups.get(gid)
      if (!g) continue
      const fileId = resolveBackdropFileId(g.backgroundFileId, bgOverrides.get(gid))
      if (fileId) {
        return {
          fileId,
          groupId: gid,
          quality: g.backdropQuality ?? backdropQuality,
          opacity: g.backdropOpacity ?? backdropOpacity,
        }
      }
    }
    return null
  }, [backdropVizSpan, layout, groups, bgOverrides, backdropQuality, backdropOpacity])
  // True when a single spanning backdrop is active → every pane goes transparent
  // (via `data-stave-backdrop="on"`) so the one backdrop shows behind all of them.
  const workspaceSpanActive = workspaceSpanBackdrop != null

  // Shared backdrop-layer renderer (#770) — used BOTH per-pane (file mode) and
  // once at the workspace level (workspace mode). Extracted so the crop/quality
  // transform math lives in one place. `dataGroupId` labels the layer for
  // observation ('workspace' for the spanning one); `paused` routes to
  // renderer.pause() (the #769 hover-gate in file mode; always live when spanning).
  const renderBackdropLayer = useCallback(
    (params: {
      bgFileId: string
      dataGroupId: string
      quality: BackdropQuality
      opacity: number
      crop: { x: number; y: number; w: number; h: number } | null
      paused: boolean
    }): React.ReactNode => {
      const { bgFileId, dataGroupId, quality, opacity, crop, paused } = params
      const bgProvider = previewProviderFor?.({
        kind: 'preview',
        id: `bg-${bgFileId}`,
        fileId: bgFileId,
        sourceRef: { kind: 'default' },
      })
      if (!bgProvider) return null
      const qf = backdropQualityFactor(quality)
      const cx = crop?.x ?? 0
      const cy = crop?.y ?? 0
      const cw = crop?.w ?? 1
      const ch = crop?.h ?? 1
      const scaleX = qf / cw
      const scaleY = qf / ch
      const innerSizePct = qf === 1 ? 100 : 100 / qf
      const translateX = -cx * 100
      const translateY = -cy * 100
      return (
        <div
          data-workspace-background={dataGroupId}
          data-background-file-id={bgFileId}
          data-backdrop-quality={quality}
          data-backdrop-live={paused ? 'false' : 'true'}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            opacity,
            pointerEvents: 'none',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${innerSizePct}%`,
              height: `${innerSizePct}%`,
              transform:
                crop || qf !== 1
                  ? `scale(${scaleX}, ${scaleY}) translate(${translateX}%, ${translateY}%)`
                  : undefined,
              transformOrigin: 'top left',
            }}
          >
            <PreviewView
              fileId={bgFileId}
              provider={bgProvider}
              sourceRef={{ kind: 'default' }}
              theme={theme}
              hidden={false}
              paused={paused}
              onSourceRefChange={() => {}}
            />
          </div>
        </div>
      )
    },
    [previewProviderFor, theme],
  )

  /**
   * Render one group's tab bar + content area. Factored out of the top-
   * level render body so the `SplitPane` children are readable.
   */
  const renderGroup = useCallback(
    (group: WorkspaceGroupState): React.ReactNode => {
      const activeTabObj = group.tabs.find((t) => t.id === group.activeTabId)
      const isShellActiveGroup = activeGroupId === group.id
      const canClose = groups.size > 1
      const isDragOver = dragOverTarget?.groupId === group.id

      return (
        <div
          data-workspace-group={group.id}
          data-active-group={isShellActiveGroup ? 'true' : 'false'}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DRAG_MIME)) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const direction = computeQuadrant(e, e.currentTarget)
              if (
                dragOverTarget?.groupId !== group.id ||
                dragOverTarget.direction !== direction
              ) {
                setDragOverTarget({ groupId: group.id, direction })
              }
            }
          }}
          onDragLeave={(e) => {
            // Only clear the highlight when leaving the group's root,
            // not when crossing child boundaries inside it.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setDragOverTarget((t) =>
                t?.groupId === group.id ? null : t,
              )
            }
          }}
          onDrop={(e) => handleDropOnGroup(e, group.id)}
          // #769: track the hovered group ONLY when "Play viz on hover" is on, so
          // its non-focused backdrop resumes while the cursor is over it. Guarded
          // on the flag so the common (OFF) path never re-renders on mouse move.
          onMouseEnter={
            playVizOnHover ? () => setHoveredGroupId(group.id) : undefined
          }
          onMouseLeave={
            playVizOnHover
              ? () => setHoveredGroupId((h) => (h === group.id ? null : h))
              : undefined
          }
          onMouseDown={() => {
            // Clicking anywhere inside a group focuses it without
            // changing the tab selection. Used by `onActiveTabChange`
            // to emit group-switch events when the user clicks into
            // a non-active group's content area.
            if (activeGroupId !== group.id) {
              setActiveGroupId(group.id)
            }
          }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
            // #770: transparent in workspace-span mode so the single backdrop
            // (rendered behind the groups container) shows through every pane.
            background: workspaceSpanActive ? 'transparent' : 'var(--background)',
            outline: isDragOver
              ? '2px solid var(--accent, #75baff)'
              : 'none',
            outlineOffset: -2,
          }}
        >
          {/* Tab bar (scroll strip + overflow menu + pinned actions) */}
          <GroupTabBar
            group={group}
            canClose={canClose}
            onTabBarDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG_MIME)) return
              e.preventDefault()
              e.stopPropagation()
              e.dataTransfer.dropEffect = 'move'
            }}
            onTabBarDrop={(e) => handleTabBarDrop(e, group.id)}
            onTabClick={(tabId) => handleTabClick(group.id, tabId)}
            onTabClose={(tabId) => handleTabClose(group.id, tabId)}
            onTabDragStart={(e, tab) => handleTabDragStart(e, group.id, tab)}
            onTabContextMenu={onTabContextMenu}
            onTabPromote={(tabId) => {
              setGroups((prev) => {
                const g = prev.get(group.id)
                if (!g) return prev
                const nextTabs = g.tabs.map((t) =>
                  t.id === tabId && (t.kind === 'editor' || t.kind === 'history')
                    ? { ...t, preview: false }
                    : t,
                )
                const nx = new Map(prev)
                nx.set(group.id, { ...g, tabs: nextTabs })
                return nx
              })
            }}
            onNewFile={onNewFile}
            onSplitRight={() => handleSplit(group.id, 'east')}
            onSplitDown={() => handleSplit(group.id, 'south')}
            onCloseGroup={() => handleCloseGroup(group.id)}
          />
          {/* Content area */}
          <div
            data-workspace-group-content={group.id}
            style={{ flex: 1, minHeight: 0, position: 'relative' }}
          >
            {/* Backdrop — promote-to-background / Cmd+K B.
                Renders the pinned FILE's preview, independent of the
                active tab. The pinned file id lives on
                `group.backgroundFileId`; the app's `previewProviderFor`
                resolves its language via the file registry, so the
                shell doesn't need to know file→language mapping
                directly. Survives tab switches; silently drops when
                the promoted file is deleted (provider lookup returns
                undefined). */}
            {(() => {
              // #770: in 'workspace' span mode the single backdrop is rendered
              // ONCE at the workspace level (below), not per-pane — suppress the
              // per-pane layer here so we don't paint N copies.
              if (backdropVizSpan === 'workspace') return null
              // #350a precedence: code override (this eval) wins over the manual
              // sticky; neither set → no backdrop.
              const bgFileId = resolveBackdropFileId(
                group.backgroundFileId,
                bgOverrides.get(group.id),
              )
              if (!bgFileId) return null
              // #350c: per-pane opacity/quality override the global default.
              const groupQuality = group.backdropQuality ?? backdropQuality
              const groupOpacity = group.backdropOpacity ?? backdropOpacity
              // #767/#769: by DEFAULT every pane's backdrop renders LIVE. With the
              // opt-in "Play viz on hover" setting, non-focused panes freeze UNLESS
              // hovered (the focused pane stays live). `vizGovernor` holds the GPU
              // floor either way.
              const backdropPaused =
                playVizOnHover &&
                !isShellActiveGroup &&
                hoveredGroupId !== group.id
              return renderBackdropLayer({
                bgFileId,
                dataGroupId: group.id,
                quality: groupQuality,
                opacity: groupOpacity,
                crop: backgroundCrop ?? null,
                // #781 — the viz chrome's play/pause button pauses the backdrop
                // through the same per-file `pausedPreviews` set it uses for
                // side previews (a viz's placement is exclusive, so one flag
                // covers both). OR it with the hover-gate policy above.
                paused: backdropPaused || pausedPreviews.has(bgFileId),
              })
            })()}
            {activeTabObj ? (
              <div
                data-stave-code-panel="true"
                data-stave-backdrop={
                  // #770: in workspace-span mode EVERY pane goes transparent so the
                  // single shared backdrop shows behind all of them — not just panes
                  // that have their own backdrop (the file-mode condition).
                  workspaceSpanActive ||
                  resolveBackdropFileId(
                    group.backgroundFileId,
                    bgOverrides.get(group.id),
                  )
                    ? 'on'
                    : 'off'
                }
                style={{
                  position: 'relative',
                  zIndex: 0,
                  height: '100%',
                }}
              >
                {renderTabContent(activeTabObj, group.id, isShellActiveGroup)}
              </div>
            ) : (
              <div
                data-testid={`group-empty-${group.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: 'var(--foreground-muted)',
                  fontSize: 12,
                }}
              >
                Drop a tab here
              </div>
            )}
          </div>
        </div>
      )
    },
    [
      activeGroupId,
      groups,
      dragOverTarget,
      computeQuadrant,
      handleDropOnGroup,
      handleTabClick,
      handleTabClose,
      handleTabDragStart,
      handleSplit,
      handleCloseGroup,
      renderTabContent,
      // Backdrop props — without these, renderGroup keeps a stale
      // closure and never re-reads the crop / quality / provider,
      // so Save-in-crop-popup + quality-picker + theme-flip never
      // reach the render.
      backgroundCrop,
      backdropQuality,
      backdropOpacity,
      bgOverrides,
      previewProviderFor,
      theme,
      // #769: the backdrop `paused` policy reads both — omit them and
      // renderGroup keeps a stale closure, so toggling "Play viz on hover"
      // or hovering a pane never reaches the backdrop (P239 memo-dep trap).
      playVizOnHover,
      hoveredGroupId,
      // #770: span mode gates the per-pane backdrop + pane transparency; the
      // layer renderer is a fresh closure each time it changes. Same P239 trap.
      backdropVizSpan,
      workspaceSpanActive,
      renderBackdropLayer,
      // #781: the backdrop `paused` now also reads `pausedPreviews` (the chrome
      // play/pause button). Omit it and toggling pause never reaches the
      // backdrop — the same P239 stale-closure trap.
      pausedPreviews,
    ],
  )

  // Total group count — used to decide the "canClose" button visibility
  // across multiple groups, and to skip rendering the outer SplitPane
  // when there's only one group.
  const totalGroupCount = useMemo(
    () => allGroupIds(layout).length,
    [layout],
  )

  // Auto-promote preview tabs on first edit to the backing file. We
  // subscribe to every preview tab's workspace file; the subscription
  // fires only on real Y.Text changes (initial read state doesn't fire
  // synchronously), so the first fire is the user's first edit. We
  // promote the tab and tear down the subscription in one pass.
  const previewTabIds = useMemo(() => {
    const out: Array<{ tabId: string; fileId: string }> = []
    for (const g of groups.values()) {
      for (const t of g.tabs) {
        if (
          t.kind === 'editor' &&
          (t as { preview?: boolean }).preview === true
        ) {
          out.push({ tabId: t.id, fileId: t.fileId })
        }
      }
    }
    return out
  }, [groups])

  useEffect(() => {
    const unsubs = previewTabIds.map(({ tabId, fileId }) =>
      subscribeToWorkspaceFile(fileId, () => {
        setGroups((prev) => {
          let changed = false
          const next = new Map(prev)
          for (const [gid, g] of prev) {
            const nextTabs = g.tabs.map((t) => {
              if (t.id !== tabId) return t
              if (t.kind !== 'editor' || !(t as { preview?: boolean }).preview) return t
              changed = true
              return { ...t, preview: false }
            })
            if (changed) next.set(gid, { ...g, tabs: nextTabs })
          }
          return changed ? next : prev
        })
      }),
    )
    return () => {
      for (const u of unsubs) u()
    }
  }, [previewTabIds])

  // Expose imperative handle — lets parent call openOrFocusFile(fileId)
  // to programmatically open/focus a file's editor tab. Used by the file
  // tree sidebar so clicking a file opens its tab.
  useImperativeHandle(
    forwardedRef,
    () => ({
      openOrFocusFile: (fileId: string, options?: { preview?: boolean }) => {
        const preview = options?.preview === true
        // Search every group for an existing editor tab with this fileId.
        let foundGroupId: string | null = null
        let foundTabId: string | null = null
        for (const [gid, group] of groups) {
          const hit = group.tabs.find(
            (t) => t.kind === 'editor' && t.fileId === fileId,
          )
          if (hit) {
            foundGroupId = gid
            foundTabId = hit.id
            break
          }
        }
        if (foundGroupId && foundTabId) {
          // Existing tab — activate it. A pinned-open overrides an existing
          // preview flag by promoting the tab in the same pass.
          const targetGid = foundGroupId
          const targetTid = foundTabId
          setGroups((prev) => {
            const existing = prev.get(targetGid)
            if (!existing) return prev
            const next = new Map(prev)
            const nextTabs = existing.tabs.map((t) => {
              if (t.id !== targetTid) return t
              if (t.kind !== 'editor') return t
              if (!preview && t.preview) return { ...t, preview: false }
              return t
            })
            next.set(targetGid, {
              ...existing,
              tabs: nextTabs,
              activeTabId: targetTid,
            })
            return next
          })
          setActiveGroupId(targetGid)
          return
        }
        // No existing tab for this fileId. If this is a preview open and
        // the active group already has a preview tab, REPLACE its fileId
        // instead of appending — keeps the preview slot bounded to one.
        if (preview) {
          const existing = groups.get(activeGroupId)
          const slot = existing?.tabs.find(
            (t) => t.kind === 'editor' && (t as { preview?: boolean }).preview === true,
          )
          if (existing && slot) {
            const slotId = slot.id
            setGroups((prev) => {
              const g = prev.get(activeGroupId)
              if (!g) return prev
              const nextTabs = g.tabs.map((t) =>
                t.id === slotId && t.kind === 'editor'
                  ? { ...t, fileId, preview: true }
                  : t,
              )
              const nx = new Map(prev)
              nx.set(activeGroupId, { ...g, tabs: nextTabs, activeTabId: slotId })
              return nx
            })
            return
          }
        }
        // No slot to reuse — create a fresh tab.
        const newTab: WorkspaceTab = {
          kind: 'editor',
          id: `tab-${fileId}-${Date.now()}`,
          fileId,
          ...(preview ? { preview: true } : {}),
        }
        setGroups((prev) => {
          const existing = prev.get(activeGroupId)
          if (!existing) return prev
          const next = new Map(prev)
          next.set(activeGroupId, {
            ...existing,
            tabs: [...existing.tabs, newTab],
            activeTabId: newTab.id,
          })
          return next
        })
      },
      openHistoryTab: (req: {
        mode: 'diff' | 'view'
        commitId: string
        fileId: string
        vsCurrent?: boolean
        pickerFileIds?: readonly string[]
      }) => {
        const { mode, commitId, fileId, vsCurrent, pickerFileIds } = req
        // Reuse the active group's history preview slot if one exists —
        // the next Diff/View swaps its content instead of stacking tabs.
        const existing = groups.get(activeGroupId)
        const slot = existing?.tabs.find(
          (t) => t.kind === 'history' && (t as { preview?: boolean }).preview === true,
        )
        if (existing && slot) {
          const slotId = slot.id
          setGroups((prev) => {
            const g = prev.get(activeGroupId)
            if (!g) return prev
            const nextTabs = g.tabs.map((t) =>
              t.id === slotId && t.kind === 'history'
                ? { ...t, mode, commitId, fileId, vsCurrent, pickerFileIds, preview: true }
                : t,
            )
            const nx = new Map(prev)
            nx.set(activeGroupId, { ...g, tabs: nextTabs, activeTabId: slotId })
            return nx
          })
          setActiveGroupId(activeGroupId)
          return
        }
        // No slot to reuse — create a fresh history preview tab.
        const newTab: WorkspaceTab = {
          kind: 'history',
          id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          fileId,
          mode,
          commitId,
          ...(vsCurrent ? { vsCurrent: true } : {}),
          ...(pickerFileIds ? { pickerFileIds } : {}),
          preview: true,
        }
        setGroups((prev) => {
          const g = prev.get(activeGroupId)
          if (!g) return prev
          const next = new Map(prev)
          next.set(activeGroupId, {
            ...g,
            tabs: [...g.tabs, newTab],
            activeTabId: newTab.id,
          })
          return next
        })
        setActiveGroupId(activeGroupId)
      },
      promoteTab: (tabId: string) => {
        setGroups((prev) => {
          let changed = false
          const next = new Map<string, typeof prev extends Map<infer K, infer V> ? V : never>()
          for (const [gid, g] of prev) {
            const nextTabs = g.tabs.map((t) => {
              if (t.id !== tabId) return t
              if (
                (t.kind !== 'editor' && t.kind !== 'history') ||
                !(t as { preview?: boolean }).preview
              )
                return t
              changed = true
              return { ...t, preview: false }
            })
            next.set(gid, changed ? { ...g, tabs: nextTabs } : g)
          }
          return changed ? next : prev
        })
      },
      closeTabsForFile: (fileId: string) => {
        const targets: string[] = []
        for (const g of groups.values()) {
          for (const t of g.tabs) {
            if (
              (t.kind === 'editor' || t.kind === 'preview' || t.kind === 'history') &&
              t.fileId === fileId
            ) {
              targets.push(t.id)
            }
          }
        }
        for (const tid of targets) closeTabById(tid)
      },
      closeOtherTabs: (tabId: string) => {
        let ownerGroup: WorkspaceGroupState | null = null
        for (const g of groups.values()) {
          if (g.tabs.some((t) => t.id === tabId)) { ownerGroup = g; break }
        }
        if (!ownerGroup) return
        const victims = ownerGroup.tabs.filter((t) => t.id !== tabId).map((t) => t.id)
        for (const tid of victims) closeTabById(tid)
      },
      closeAllTabsInGroup: (tabId: string) => {
        let ownerGroup: WorkspaceGroupState | null = null
        for (const g of groups.values()) {
          if (g.tabs.some((t) => t.id === tabId)) { ownerGroup = g; break }
        }
        if (!ownerGroup) return
        const victims = ownerGroup.tabs.map((t) => t.id)
        for (const tid of victims) closeTabById(tid)
      },
      splitActiveGroup: (direction: 'east' | 'south' = 'east') => {
        if (!activeGroupId) return
        handleSplit(activeGroupId, direction)
      },
      setBackgroundFile: (
        fileId: string | null,
        groupId?: string,
      ) => {
        const gid = groupId ?? activeGroupId
        if (!gid) return
        updateGroupBackground(gid, fileId)
      },
      setBackgroundOverride: (
        fileId: string | null,
        groupId?: string,
      ) => {
        const gid = groupId ?? activeGroupId
        if (!gid) return
        updateGroupOverride(gid, fileId)
      },
      getBackgroundFileId: (groupId?: string) => {
        const gid = groupId ?? activeGroupId
        if (!gid) return undefined
        return groups.get(gid)?.backgroundFileId
      },
      setBackdropOpacity: (opacity: number | null, groupId?: string) => {
        const gid = groupId ?? activeGroupId
        if (!gid) return
        updateGroupBackdropOpacity(gid, opacity)
      },
      setBackdropQuality: (quality: BackdropQuality | null, groupId?: string) => {
        const gid = groupId ?? activeGroupId
        if (!gid) return
        updateGroupBackdropQuality(gid, quality)
      },
      getBackdropSettings: (groupId?: string) => {
        const gid = groupId ?? activeGroupId
        const g = gid ? groups.get(gid) : undefined
        // Per-pane override if set, else the global (EditorSettings) default.
        return {
          opacity: g?.backdropOpacity ?? backdropOpacity,
          quality: g?.backdropQuality ?? backdropQuality,
        }
      },
      assignSoundToCursor: (sound: string, opts?: { slow?: number }): string | null => {
        if (!sound) return null
        // Reach the live editor through the registry singleton, NOT the
        // Mixer's `useActiveChunk` (which only exists while that panel is
        // mounted) — the sidebar assigns with the Pattern tab closed.
        const editor = getActiveEditor()
        const model = editor?.getModel()
        const pos = editor?.getPosition()
        if (!editor || !model || !pos) return null
        const offset = model.getOffsetAt(pos)
        // The whole decision — roll chunk under the cursor → set/replace its
        // `.sound()` (chainMethod idiom, single-quoted so PV44 doesn't reify
        // it); else drop a fresh `s("…")` on its OWN line (line-aware so a raw
        // offset can't land mid-token or inside a comment) — lives in the pure
        // `planSoundAssignment` helper so it can be unit-tested (#830). Detect
        // is fresh at call time, which also sidesteps the freshness guard.
        const plan = planSoundAssignment(model.getValue(), offset, sound, opts?.slow)
        if (!plan) return null
        if (plan.kind === 'refused') return plan.reason
        commitToEditor(editor, assignmentEdit(plan), 'mixer')
        return null
      },
      assignVizToCursor: (name: string): boolean => {
        if (!name) return false
        // Same live-editor reach as assignSoundToCursor. `planVizAssignment`
        // appends/replaces `.viz("name")` on the pattern chunk under the cursor
        // (#832) — pure + unit-tested. No pattern under the cursor → null → no
        // write; returns false so the caller can guide the user (a viz decorates
        // a pattern; it can't stand alone).
        const editor = getActiveEditor()
        const model = editor?.getModel()
        const pos = editor?.getPosition()
        if (!editor || !model || !pos) return false
        const offset = model.getOffsetAt(pos)
        const plan = planVizAssignment(model.getValue(), offset, name)
        if (!plan) return false
        return commitToEditor(editor, assignmentEdit(plan), 'mixer') === 'written'
      },
    }),
    [
      groups,
      activeGroupId,
      closeTabById,
      handleSplit,
      updateGroupBackground,
      updateGroupOverride,
      updateGroupBackdropOpacity,
      updateGroupBackdropQuality,
      backdropOpacity,
      backdropQuality,
    ],
  )

  return (
    <div
      ref={shellRootRef}
      data-workspace-shell="root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height,
        background: 'var(--background)',
        color: 'var(--foreground)',
        position: 'relative',
      }}
    >
      {/*
        Edge drop zones — Issue #1. Each is an absolutely positioned
        thin strip overlaid on the left and right borders of the shell.
        On drag over, they preview themselves with an accent tint; on
        drop they move the dragged tab into a brand-new group at the
        corresponding end of `groupOrder`.

        Top/bottom edge drops require vertical splits inside each group
        (nested SplitPane or a replacement layout engine). Tracked as a
        follow-up in the phase notes — not landed here.

        `pointerEvents` are only active while a drag is in progress —
        an idle drop zone is transparent to clicks so the user can
        interact with tabs near the edges normally. The DRAG_MIME check
        inside the dragover handlers means the zones also ignore
        non-tab drags (file drops, text selections).
      */}
      <div
        data-workspace-edge-drop="start"
        onDragOver={(e) => handleEdgeDragOver(e, 'start')}
        onDragLeave={handleEdgeDragLeave}
        onDrop={(e) => handleEdgeDrop(e, 'start')}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 24,
          zIndex: 10,
          pointerEvents: tabDragInProgress ? 'auto' : 'none',
          background:
            dragOverEdge === 'start'
              ? 'rgba(139,92,246,0.18)'
              : 'transparent',
          borderLeft:
            dragOverEdge === 'start'
              ? '2px solid var(--accent)'
              : '2px solid transparent',
          transition: 'background 80ms ease, border-color 80ms ease',
        }}
      />
      <div
        data-workspace-edge-drop="end"
        onDragOver={(e) => handleEdgeDragOver(e, 'end')}
        onDragLeave={handleEdgeDragLeave}
        onDrop={(e) => handleEdgeDrop(e, 'end')}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 24,
          zIndex: 10,
          pointerEvents: tabDragInProgress ? 'auto' : 'none',
          background:
            dragOverEdge === 'end'
              ? 'rgba(139,92,246,0.18)'
              : 'transparent',
          borderRight:
            dragOverEdge === 'end'
              ? '2px solid var(--accent)'
              : '2px solid transparent',
          transition: 'background 80ms ease, border-color 80ms ease',
        }}
      />
      {/*
       * 2-D layout render (Issue #1).
       *
       *   - Empty layout → a single "drop a tab here" placeholder.
       *   - Single group → rendered directly without any SplitPane
       *     wrapper (pure perf + zero-chrome for the common case).
       *   - Multi-column → outer horizontal SplitPane. Each column
       *     with one cell becomes a single group; each column with
       *     multiple cells becomes a nested vertical SplitPane.
       *
       * The nested-SplitPane key combines column index with the cell
       * ids it contains — so a vertical insert/remove inside one
       * column only unmounts that column's subtree, not the whole
       * shell.
       */}
      {/*
       * Groups-area container — Phase 20-01 PR-A (DA-01).
       *
       * The shell's existing groups/SplitPane logic is unchanged inside
       * this wrapper. The wrapper exists so the BottomPanel sibling
       * (added below) can claim its own auto-height while the groups
       * area still consumes `flex: 1` of the remaining shell space.
       *
       * `minHeight: 0` is load-bearing — without it the inner SplitPane
       * doesn't shrink when the BottomPanel grows, defeating the resize.
       */}
      <div
        data-workspace-groups="container"
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          // #770: relative so the workspace-spanning backdrop (absolute, inset 0)
          // is bounded to the groups area. No-op for the default 'file' mode.
          position: 'relative',
        }}
      >
        {/* #770 — the ONE backdrop that spans every pane, painted behind the
            groups (zIndex 0) with the layout above it (zIndex 1). Driven by the
            first pane with a backdrop; every pane is transparent so it shows
            through. Absent (and zero cost) in 'file' mode. */}
        {workspaceSpanBackdrop &&
          renderBackdropLayer({
            bgFileId: workspaceSpanBackdrop.fileId,
            dataGroupId: 'workspace',
            quality: workspaceSpanBackdrop.quality,
            opacity: workspaceSpanBackdrop.opacity,
            crop: backgroundCrop ?? null,
            // #781 — pause the shared span backdrop when its source viz is
            // paused via the chrome play/pause button (same per-file set).
            paused: pausedPreviews.has(workspaceSpanBackdrop.fileId),
          })}
        <div
          data-workspace-groups-content="true"
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            zIndex: 1,
          }}
        >
        {totalGroupCount === 0 ? (
          <div
            data-testid="workspace-shell-empty"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--foreground-muted)',
              fontSize: 12,
            }}
          >
            Drop a tab here
          </div>
        ) : layout.length === 1 && layout[0].length === 1 ? (
          (() => {
            const g = groups.get(layout[0][0])
            return g ? renderGroup(g) : null
          })()
        ) : (
          <SplitPane direction="horizontal">
            {layout.map((column, colIdx) => {
              if (column.length === 1) {
                const g = groups.get(column[0])
                return (
                  <React.Fragment key={`col-${colIdx}-${column[0]}`}>
                    {g ? renderGroup(g) : null}
                  </React.Fragment>
                )
              }
              return (
                <SplitPane
                  key={`col-${colIdx}-${column.join('+')}`}
                  direction="vertical"
                >
                  {column.map((gid) => {
                    const g = groups.get(gid)
                    return (
                      <React.Fragment key={gid}>
                        {g ? renderGroup(g) : null}
                      </React.Fragment>
                    )
                  })}
                </SplitPane>
              )
            })}
          </SplitPane>
        )}
        </div>
      </div>

      {/*
       * Bottom drawer — Phase 20-01 PR-A (DA-01 / DA-04).
       *
       * Mounted as a sibling AFTER the groups container so the editor
       * grid takes flex:1 and the drawer takes its auto-height
       * contribution. Default closed -> ~29px header strip; user
       * expands to expose the body. Tab content is contributed via the
       * `bottomPanelRegistry` singleton; PR-A seeds a placeholder
       * `Timeline` tab via `seedTabs.ts`. PR-B (MusicalTimeline) will
       * replace by re-registering under the same id (idempotent).
       */}
      <BottomPanel hidden={bottomPanelHiddenForTab(activeTab)} />

      {/* #2005 — pattern symbols above a phone's keyboard. Last in the column, so it
          sits where the shell ends: on the keyboard's top edge. Draws nothing unless
          the keyboard is up on an upright phone with the cursor in a code file. */}
      <SymbolRow />

      {/*
       * Guide line overlay — a shell-level element that previews where
       * the dragged tab will land. Positioned in screen coordinates by
       * reading the hovered group's DOM rect. Only visible during a
       * tab drag AND when the cursor is over a known group quadrant.
       *
       * The overlay is a child of the shell root (absolutely positioned
       * with inset styles), so it layers above every group but below
       * any portal UI. `pointerEvents: none` so it never captures the
       * drag events that drive it.
       */}
      {tabDragInProgress && dragOverTarget && (
        <QuadrantGuideOverlay
          target={dragOverTarget}
          shellRootRef={shellRootRef}
        />
      )}
    </div>
  )
})

/**
 * Shell-level overlay that draws a translucent rectangle showing where
 * a directional drop will land. Reads the target group's DOM rect via
 * `document.querySelector` (by its `data-workspace-group` attribute)
 * and computes a child rectangle covering the corresponding half
 * (N/S/E/W) or full group body (center).
 *
 * Pure DOM math, no React state beyond the prop — re-renders on every
 * `target` change because the parent passes a new object identity for
 * each dragover hit.
 */
function QuadrantGuideOverlay({
  target,
  shellRootRef,
}: {
  target: { groupId: string; direction: DropDirection }
  shellRootRef: React.RefObject<HTMLDivElement | null>
}): React.ReactElement | null {
  const shell = shellRootRef.current
  if (!shell) return null
  const groupEl = shell.querySelector<HTMLElement>(
    `[data-workspace-group="${target.groupId}"]`,
  )
  if (!groupEl) return null

  const shellRect = shell.getBoundingClientRect()
  const groupRect = groupEl.getBoundingClientRect()
  // Offsets relative to the shell root (the overlay's positioning
  // context). Avoids picking up the window's scroll position.
  const relLeft = groupRect.left - shellRect.left
  const relTop = groupRect.top - shellRect.top
  const w = groupRect.width
  const h = groupRect.height

  // Compute the overlay sub-rect based on the drop direction.
  let x = relLeft
  let y = relTop
  let width = w
  let height = h
  switch (target.direction) {
    case 'west':
      width = w / 2
      break
    case 'east':
      x = relLeft + w / 2
      width = w / 2
      break
    case 'north':
      height = h / 2
      break
    case 'south':
      y = relTop + h / 2
      height = h / 2
      break
    case 'center':
      // full group; x/y/width/height already set above
      break
  }

  return (
    <div
      data-workspace-guide-overlay={target.direction}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        zIndex: 20,
        pointerEvents: 'none',
        background: 'rgba(139,92,246,0.2)',
        border: '2px solid var(--accent)',
        borderRadius: 2,
        transition: 'left 60ms ease, top 60ms ease, width 60ms ease, height 60ms ease',
      }}
    />
  )
}

// Shared button styles — duplicated from the legacy EditorGroup's look
// without importing so the shell has zero dependencies on the old file.
const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--foreground-muted)',
  cursor: 'pointer',
  fontSize: 11,
  padding: '0 2px',
  lineHeight: 1,
}

const actionBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--foreground-muted)',
  cursor: 'pointer',
  fontSize: 11,
  padding: '2px 4px',
  lineHeight: 1,
  borderRadius: 2,
}

