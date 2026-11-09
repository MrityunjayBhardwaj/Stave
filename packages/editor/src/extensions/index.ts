/**
 * The extensions area (#2507). Code outside this directory imports from here.
 *
 * Nothing in this directory imports the rest of the editor: the engine, the workspace and
 * the package entry depend on it, never the other way round. Strudel's registries are
 * handed to the host (`fromStrudel`), not imported.
 */
export type { ExtensionManifest, ExtensionModule, ExtensionHost, SoundTrigger } from './types'
export { createRecordingHost, fromStrudel, isNameTaken, RESIDUE } from './host'
export type { HostRegistries, RecordingHost, NameTakenError } from './host'
export { createExtensionManager } from './manager'
export type { ExtensionManager } from './manager'
export { enabledExtensionIds, isExtensionEnabled, setExtensionEnabled, onExtensionsEnabledChange } from './enablement'
export { BUILTIN_EXTENSIONS } from './builtin'
export { createExtensionAudio, pageExtensionAudio } from './audio'
export type { ExtensionAudio, ExtensionAudioDoors } from './audio'
