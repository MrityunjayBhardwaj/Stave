/**
 * The extensions area (#2507). Code outside this directory imports from here.
 *
 * Nothing in this directory imports the rest of the editor: the engine, the workspace and
 * the package entry depend on it, never the other way round. Strudel's registries are
 * handed to the host (`fromStrudel`), not imported; the Console is reached through the
 * `report` the package entry and the engine hand in.
 */
export type {
  ExtensionAbout,
  CodeEditor,
  EditorCleanup,
  ExtensionKey,
  ExtensionLanguage,
  ExtensionManifest,
  ExtensionModule,
  ExtensionProvides,
  ExtensionHost,
  StrudelHost,
  StrudelPart,
  StrudelProvides,
  SoundTrigger,
} from './types'
export { createCommonHost, createRecordingHost, fromStrudel, isNameTaken, RESIDUE } from './host'
export type { HostRegistries, PartRecording, RecordingHost, NameTakenError } from './host'
export { createExtensionManager } from './manager'
export type { ExtensionManager, PartDriver, PartLanguage } from './manager'
export { enabledExtensionIds, isExtensionEnabled, setExtensionEnabled, onExtensionsEnabledChange } from './enablement'
export { BUILTIN_EXTENSIONS, listedExtensions } from './builtin'
export { E2E_TONE, E2E_TONE_ID, E2E_TONE_KEY, E2E_TONE_SOUND } from './e2eTone'
export { createStrudelDriver, prepareStrudelParts } from './strudel'
export type { ExtensionReport, ExtensionStrudelDoors } from './strudel'
export {
  createExtensionRuntime,
  pageExtensions,
  extensionKeysInCode,
  activeExtensionManifests,
  hasActiveExtensions,
  extensionFailure,
  onPageExtensionsChange,
} from './runtime'
export { createCodeEditorList, offerCodeEditor, pageCodeEditors, setCloseAllCodeEditors } from './editors'
export type { CodeEditorList, CodeEditorSite, EditorWatcher } from './editors'
export {
  checkExtensionKeys,
  keyId,
  isExtensionKeyGivenBack,
  setExtensionKeyGivenBack,
  onExtensionKeysChange,
  extensionKeys,
  keysTakenBy,
  setKeyEventMatcher,
  declaredKeyOf,
} from './keys'
export type { ExtensionKeyState, ExtensionKeyInCode, KeyEventMatcher } from './keys'
export { VIM, VIM_ID } from './vim/manifest'
export type { ExtensionRuntime } from './runtime'
