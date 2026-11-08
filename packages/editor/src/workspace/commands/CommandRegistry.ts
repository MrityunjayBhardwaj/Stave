/**
 * CommandRegistry -- Phase 10.2 Task 08.
 *
 * In-memory Map-backed command registry for workspace-level commands. Three
 * built-in commands ship with this module:
 *
 *   - `workspace.openPreviewToSide` (Cmd+K V)
 *   - `workspace.toggleBackgroundPreview` (Cmd+K B)
 *   - `workspace.openPreviewInWindow` (Cmd+K W)
 *
 * Each command checks for the existence of a `PreviewProvider` for the active
 * tab's language before executing. Pattern files (`.strudel`, `.sonicpi`) have
 * no preview provider and result in a silent no-op with a one-time
 * `console.warn` per command id (CONTEXT U5).
 *
 * The registry is module-level state (not React state). Commands are registered
 * at import time via `registerCommand`. The keyboard hook
 * (`useKeyboardCommands`) dispatches via `executeCommand`.
 */

import type { AudioSourceRef, WorkspaceTab, WorkspaceGroupState } from '../types'
import type { PreviewProvider } from '../PreviewProvider'
import { getFile } from '../WorkspaceFile'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Actions the command system can invoke on the shell. Passed as part of
 * `CommandContext` so commands stay decoupled from shell internals.
 */
export interface WorkspaceShellActions {
  /** Add a tab to a group. */
  addTab(groupId: string, tab: WorkspaceTab): void
  /** Create a sibling group to the right with a new tab inside it. */
  splitGroupWithTab(
    originGroupId: string,
    direction: 'right',
    newTab: WorkspaceTab,
  ): void
  /** Toggle the background decoration tab id on a group. */
  updateGroupBackground(groupId: string, backgroundFileId: string | null): void
  /**
   * Close a specific tab by id. Imperative counterpart to the tab's
   * ✕ button; commands can use this to close the preview for the
   * current file, close a backgrounded tab, etc. If the closed tab
   * was the last in its group, the group is preserved empty (shell
   * policy); the caller is responsible for closing empty groups if
   * that's the desired UX.
   */
  closeTab(tabId: string): void
  /**
   * Scan every group for the first tab with the given fileId AND kind.
   * Returns the group id + tab id if found. Used by the chrome's
   * idempotent "Open Preview" handler to check whether a preview tab
   * for the current file already exists before opening a new one.
   */
  findTabByFileId(
    fileId: string,
    kind: 'editor' | 'preview',
  ): { groupId: string; tabId: string } | null
  /** Open a preview in a popout window for a given file id. */
  openPopoutPreview?(fileId: string): void
}

/**
 * The context handed to every command's `execute` callback. Contains the
 * current active tab, the active group, and the shell's imperative API.
 */
export interface CommandContext {
  activeTab: WorkspaceTab | null
  activeGroupId: string | null
  activeGroup: WorkspaceGroupState | null
  shell: WorkspaceShellActions
  /** Look up a preview provider by workspace language string. */
  getPreviewProvider: (language: string) => PreviewProvider | undefined
}

/**
 * A workspace command registered in the in-memory registry.
 */
export interface WorkspaceCommand {
  readonly id: string
  readonly label: string
  /** Display-only keybinding hint for future menu UI (e.g., 'Cmd+K V'). */
  readonly keybinding?: string
  execute(ctx: CommandContext): void
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const commandRegistry = new Map<string, WorkspaceCommand>()

export function registerCommand(cmd: WorkspaceCommand): void {
  commandRegistry.set(cmd.id, cmd)
}

export function getCommand(id: string): WorkspaceCommand | undefined {
  return commandRegistry.get(id)
}

export function executeCommand(id: string, ctx: CommandContext): void {
  const cmd = commandRegistry.get(id)
  if (!cmd) return
  cmd.execute(ctx)
}

/**
 * TESTING ONLY -- clear the registry AND the warned-commands set.
 */
export function resetCommandRegistryForTests(): void {
  commandRegistry.clear()
  warnedCommands.clear()
  // Re-register built-ins so tests that rely on them don't need to manually
  // call registerBuiltinCommands.
  registerBuiltinCommands()
}

// ---------------------------------------------------------------------------
// One-time warn cache (U5)
// ---------------------------------------------------------------------------

const warnedCommands = new Set<string>()

function warnOnceDisabled(commandId: string, language: string): void {
  if (warnedCommands.has(commandId)) return
  warnedCommands.add(commandId)
  console.warn(
    `${commandId} not available for .${language} files`,
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let __nextTabSeq = 0
function generateTabId(prefix: string): string {
  __nextTabSeq += 1
  return `${prefix}-${__nextTabSeq}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Resolve the language for a tab by:
 * 1. Looking up the workspace file by id (authoritative).
 * 2. Falling back to extension parsing from fileId (e.g., 'pianoroll.hydra').
 */
function getLanguageFromTab(tab: WorkspaceTab): string | undefined {
  // #2471 — an app tab shows no file, so it has no language.
  if (tab.kind === 'app') return undefined
  // Primary: look up the WorkspaceFile store.
  const file = getFile(tab.fileId)
  if (file) return file.language

  // Fallback: extract from fileId string (for cases where the store
  // hasn't been seeded yet or the id itself has an extension).
  const dot = tab.fileId.lastIndexOf('.')
  if (dot === -1) return undefined
  const ext = tab.fileId.slice(dot + 1)
  switch (ext) {
    case 'hydra': return 'hydra'
    case 'p5': return 'p5js'
    case 'md': return 'markdown'
    case 'strudel': return 'strudel'
    case 'sonicpi': return 'sonicpi'
    default: return ext
  }
}

// ---------------------------------------------------------------------------
// Built-in commands
// ---------------------------------------------------------------------------

function registerBuiltinCommands(): void {
  // --- workspace.openPreviewToSide (Cmd+K V) ---
  registerCommand({
    id: 'workspace.openPreviewToSide',
    label: 'Open Preview to the Side',
    keybinding: 'Cmd+K V',
    execute(ctx) {
      const { activeTab, activeGroupId, shell, getPreviewProvider } = ctx
      if (!activeTab || !activeGroupId) return
      if (activeTab.kind === 'preview') return // can't preview a preview
      if (activeTab.kind === 'app') return // #2471 — no file to preview

      const language = getLanguageFromTab(activeTab)
      if (!language) return

      const provider = getPreviewProvider(language)
      if (!provider) {
        warnOnceDisabled('workspace.openPreviewToSide', language)
        return
      }

      const newTab: WorkspaceTab = {
        kind: 'preview',
        id: generateTabId('preview'),
        fileId: activeTab.fileId,
        sourceRef: { kind: 'default' } as AudioSourceRef,
      }
      shell.splitGroupWithTab(activeGroupId, 'right', newTab)
    },
  })

  // --- workspace.toggleBackgroundPreview (Cmd+K B) ---
  registerCommand({
    id: 'workspace.toggleBackgroundPreview',
    label: 'Toggle Background Preview',
    keybinding: 'Cmd+K B',
    execute(ctx) {
      const { activeTab, activeGroupId, activeGroup, shell, getPreviewProvider } = ctx
      if (!activeTab || !activeGroupId || !activeGroup) return
      if (activeTab.kind !== 'editor') return

      const language = getLanguageFromTab(activeTab)
      if (!language) return

      const provider = getPreviewProvider(language)
      if (!provider) {
        warnOnceDisabled('workspace.toggleBackgroundPreview', language)
        return
      }

      // Toggle: if background is already this file, clear it; otherwise
      // pin the active file. The field holds the FILE id directly — the
      // backdrop is durable across tab switches, unlike the old
      // mirror-active-editor model that derived from the active tab.
      if (activeGroup.backgroundFileId === activeTab.fileId) {
        shell.updateGroupBackground(activeGroupId, null)
      } else {
        shell.updateGroupBackground(activeGroupId, activeTab.fileId)
      }
    },
  })

  // --- workspace.openPreviewInWindow (Cmd+K W) ---
  registerCommand({
    id: 'workspace.openPreviewInWindow',
    label: 'Open Preview in New Window',
    keybinding: 'Cmd+K W',
    execute(ctx) {
      const { activeTab, shell, getPreviewProvider } = ctx
      if (!activeTab) return
      if (activeTab.kind !== 'editor') return

      const language = getLanguageFromTab(activeTab)
      if (!language) return

      const provider = getPreviewProvider(language)
      if (!provider) {
        warnOnceDisabled('workspace.openPreviewInWindow', language)
        return
      }

      shell.openPopoutPreview?.(activeTab.fileId)
    },
  })
}

// Register built-ins at module load time.
registerBuiltinCommands()
