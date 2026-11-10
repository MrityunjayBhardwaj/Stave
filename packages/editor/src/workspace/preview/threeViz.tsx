/**
 * THREE_VIZ — preview provider for `.three` files (#2516).
 *
 * The mirror image of `glslViz.tsx`: all the machinery lives in
 * `createCompiledVizProvider`. A `.three` file is a plain three.js sketch, fed to
 * `compilePreset` → `makeThreeRenderer`.
 */

import { createCompiledVizProvider } from './compiledVizProvider'

export const THREE_VIZ = createCompiledVizProvider({
  extensions: ['three'],
  label: 'three.js Visualization',
  renderer: 'three',
})
