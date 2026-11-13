/**
 * A tiny extension for tests: its Strudel part registers one of every kind the Strudel
 * host records, so a test that switches it on and off exercises every undo. Its common
 * part only logs, so a test can see the order parts are undone in.
 */
import type { ExtensionManifest, ExtensionModule, StrudelPart } from '../types'

export const TEST_SOUND = 'zzext_sound'
export const TEST_CONTROL = 'zzextcontrol'
export const TEST_GLOBAL = 'zzextGlobal'

/** The Strudel part: one sound, one control, one global, and an `onDeactivate`. */
export function testPart(log: string[] = []): StrudelPart {
  return {
    activate(host) {
      host.registerSound(TEST_SOUND, () => undefined, { type: 'synth' })
      host.registerControl(TEST_CONTROL)
      host.setGlobal(TEST_GLOBAL, 42)
      host.onDeactivate(() => log.push('deactivated'))
    },
  }
}

/** The whole module: a common part that logs, and the Strudel part above. */
export function testModule(log: string[] = []): ExtensionModule {
  return {
    activate(host) {
      host.onDeactivate(() => log.push('common off'))
    },
    strudel: testPart(log),
  }
}

export function testManifest(over: Partial<ExtensionManifest> = {}, log: string[] = []): ExtensionManifest {
  return {
    id: 'zzext',
    name: 'Test extension',
    description: 'registers one of everything',
    languages: ['strudel'],
    provides: { strudel: { sounds: [TEST_SOUND], controls: [TEST_CONTROL] } },
    load: async () => testModule(log),
    ...over,
  }
}
