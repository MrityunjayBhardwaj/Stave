/**
 * @stave/editor — workspace module barrel.
 *
 * Phase 10.2 public surface. Grows task by task.
 *
 * Task 01:
 * - Types: WorkspaceFile, WorkspaceLanguage
 * - Store:  createWorkspaceFile, getFile, setContent, subscribe
 * - Hook:   useWorkspaceFile
 *
 * Task 02:
 * - Types: AudioSourceRef, AudioPayload, AudioSourceListing,
 *          WorkspaceAudioBus
 * - Bus:   workspaceAudioBus (singleton)
 *
 * Task 03:
 * - Types: EditorViewProps, PreviewViewProps, WorkspaceTheme,
 *          PreviewProvider, PreviewContext, PreviewReloadPolicy
 * - Views: EditorView, PreviewView
 * - Util:  ensureWorkspaceLanguages, toMonacoLanguage
 *
 * Task 04:
 * - Types: WorkspaceTab, WorkspaceGroupState, WorkspaceShellProps,
 *          ChromeForTab, LiveCodingRuntimeProviderStub
 * - Shell: WorkspaceShell
 *
 * Task 05:
 * - Types:    LiveCodingRuntime, LiveCodingRuntimeProvider, ChromeContext
 * - Class:    LiveCodingRuntime (in runtime/)
 * - Registry: liveCodingRuntimeRegistry, register/get* helpers
 * - Built-ins: STRUDEL_RUNTIME, SONICPI_RUNTIME
 *
 * Task 06:
 * - Registry:   previewProviderRegistry, register/get* helpers
 * - Built-ins:  HYDRA_VIZ, P5_VIZ (MARKDOWN_HTML deferred per U7)
 * - Bridge:     seedFromPreset, seedFromPresetId, flushToPreset
 *               (viz preset ↔ workspace file, per S6)
 *
 * Task 08:
 * - Types:    WorkspaceCommand, CommandContext, WorkspaceShellActions
 * - Registry: registerCommand, getCommand, executeCommand
 * - Hook:     useKeyboardCommands (Cmd+K V/B/W chord detection)
 * - Built-ins: workspace.openPreviewToSide, workspace.toggleBackgroundPreview,
 *              workspace.openPreviewInWindow
 */

export type { WorkspaceFile, WorkspaceLanguage } from './types'
export type {
  AudioSourceRef,
  AudioPayload,
  AudioSourceListing,
  WorkspaceAudioBus,
} from './types'
export type {
  EditorViewProps,
  PreviewViewProps,
  WorkspaceTheme,
} from './types'
export type {
  WorkspaceTab,
  WorkspaceGroupState,
  WorkspaceShellProps,
  ChromeForTab,
  LiveCodingRuntimeProviderStub,
  AppTabState,
  AppTabLabel,
} from './types'
export type {
  LiveCodingRuntime as LiveCodingRuntimeInterface,
  LiveCodingRuntimeProvider,
  ChromeContext,
} from './types'
export {
  LiveCodingRuntime,
  extractBpmFromCode,
  liveCodingRuntimeRegistry,
  registerRuntimeProvider,
  getRuntimeProviderForExtension,
  getRuntimeProviderForLanguage,
  STRUDEL_RUNTIME,
  SONICPI_RUNTIME,
} from './runtime'
export {
  createWorkspaceFile,
  seedWorkspaceFile,
  getFile,
  setContent,
  subscribe,
  resetFileStore,
  listWorkspaceFiles,
  subscribeToFileList,
  deleteWorkspaceFile,
  renameWorkspaceFile,
} from './WorkspaceFile'
export {
  initProjectDoc,
  initProjectDocSync,
  switchProject,
  getActiveProjectId,
  isDocReady,
  IDB_SYNC_TIMEOUT_MS,
} from './projectDoc'
export type { ProjectDocInitResult } from './projectDoc'
export { warmMonaco } from './warmMonaco'
export {
  listProjects,
  getProject,
  getLastOpenedProject,
  createProject,
  touchProject,
  renameProject,
  duplicateProject,
  type ProjectMeta,
} from './projectRegistry'
export { deleteProject } from './projectDeletion'
export { useWorkspaceFile } from './useWorkspaceFile'
export type { UseWorkspaceFileResult } from './useWorkspaceFile'
// Phase 20-12 α-2/α-3 — track-chrome persistence (D-01/D-02). Re-exported so
// app-side chrome can read/write per-file track UI state without reaching
// into the editor internals.
export {
  getTrackMeta,
  setTrackMeta,
  subscribeToTrackMeta,
} from './WorkspaceFile'
export type { TrackMeta } from './WorkspaceFile'
export { workspaceAudioBus } from './WorkspaceAudioBus'
export { EditorView } from './EditorView'
export { PreviewView } from './PreviewView'
export { WorkspaceShell } from './WorkspaceShell'
export type { WorkspaceShellHandle } from './WorkspaceShell'
export type {
  PreviewProvider,
  PreviewContext,
  PreviewReloadPolicy,
} from './PreviewProvider'
export {
  previewProviderRegistry,
  registerPreviewProvider,
  getPreviewProviderForExtension,
  getPreviewProviderForLanguage,
  createCompiledVizProvider,
  HYDRA_VIZ,
  P5_VIZ,
  GLSL_VIZ,
  seedFromPreset,
  seedFromPresetId,
  flushToPreset,
  workspaceFileIdForPreset,
  languageForPresetRenderer,
  getPresetIdForFile,
} from './preview'
export {
  ensureWorkspaceLanguages,
  toMonacoLanguage,
} from './languages'
export {
  VIZ_LANGUAGES,
  isVizLanguage,
  rendererForLanguage,
  languageForRenderer,
} from './vizLanguages'
export type { VizRendererKind, VizLanguage } from './vizLanguages'

// Task 08 — Command registry + Cmd+K V/B/W
export type {
  WorkspaceCommand,
  CommandContext,
  WorkspaceShellActions,
} from './commands'
export {
  registerCommand,
  getCommand,
  executeCommand,
  resetCommandRegistryForTests,
} from './commands'
export {
  useKeyboardCommands,
  type UseKeyboardCommandsOptions,
} from './commands'
