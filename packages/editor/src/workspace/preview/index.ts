/**
 * @stave/editor — workspace/preview barrel.
 *
 * Phase 10.2 Task 06 surface. Re-exported by `workspace/index.ts` so the
 * single workspace barrel covers everything Tasks 01–08 produce, mirroring
 * the `workspace/runtime` barrel added in Task 05.
 */

export type { PreviewProvider, PreviewContext } from '../PreviewProvider'

export {
  previewProviderRegistry,
  registerPreviewProvider,
  getPreviewProviderForExtension,
  getPreviewProviderForLanguage,
  resetPreviewRegistryForTests,
} from './registry'

export { createCompiledVizProvider } from './compiledVizProvider'
export { HYDRA_VIZ } from './hydraViz'
export { P5_VIZ } from './p5Viz'
export { GLSL_VIZ } from './glslViz'
export { THREE_VIZ } from './threeViz'

export {
  seedFromPreset,
  seedFromPresetId,
  flushToPreset,
  workspaceFileIdForPreset,
  languageForPresetRenderer,
  getPresetIdForFile,
} from './vizPresetBridge'

export { registerPresetAsNamedViz } from './namedVizBridge'
