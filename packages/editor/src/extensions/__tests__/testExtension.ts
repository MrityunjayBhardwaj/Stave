/**
 * A tiny extension for tests: it registers one of every kind the host records, so a test
 * that switches it on and off exercises every undo.
 */
import type { ExtensionManifest, ExtensionModule } from '../types'

export const TEST_SOUND = 'zzext_sound'
export const TEST_CONTROL = 'zzextcontrol'
export const TEST_GLOBAL = 'zzextGlobal'

export function testModule(log: string[] = []): ExtensionModule {
  return {
    activate(host) {
      host.registerSound(TEST_SOUND, () => undefined, { type: 'synth' })
      host.registerControl(TEST_CONTROL)
      host.setGlobal(TEST_GLOBAL, 42)
      host.onDeactivate(() => log.push('deactivated'))
    },
  }
}

export function testManifest(over: Partial<ExtensionManifest> = {}, log: string[] = []): ExtensionManifest {
  return {
    id: 'zzext',
    name: 'Test extension',
    description: 'registers one of everything',
    provides: { sounds: [TEST_SOUND], controls: [TEST_CONTROL] },
    load: async () => testModule(log),
    ...over,
  }
}
