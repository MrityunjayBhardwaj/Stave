/**
 * A test-only extension for end-to-end runs (#2511): a Strudel sound, `s("e2etone")`, made
 * by an audio worklet, so a browser test can switch a real extension on and off through
 * the Extensions view and hear the difference, live and in a bounce.
 *
 * It is listed only when the page says it is an end-to-end run (`__STAVE_E2E__`, set by
 * the Playwright specs before any page script; see `listedExtensions` in `builtin.ts`).
 * A real user's page never sets it, so the list they see is `BUILTIN_EXTENSIONS` alone.
 *
 * Its code is the manifest's `load`, so like any extension nothing here runs until it is
 * switched on. The worklet is a `blob:` URL made the first time it is.
 */
import type { ExtensionHost, ExtensionManifest, ExtensionModule, ExtensionSetting, SoundTrigger } from './types'

export const E2E_TONE_ID = 'e2e-tone'
export const E2E_TONE_SOUND = 'e2etone'
const PROCESSOR = 'stave-e2e-tone'

/** The key it declares (#2545): Toggle Sidebar's chord, taken inside the code. */
export const E2E_TONE_KEY = { key: 'mod+b', name: 'A test key that does nothing', where: 'code' } as const

/**
 * Its settings (#2556): one of each type, and all four used, by a label it can put in the
 * bar under each code editor, so a browser test can see a change reach the running
 * extension with no reload. Off by default, so nothing shows until a test turns it on.
 *
 * The label's default text can be set by the page before any script runs
 * (`__STAVE_E2E_TONE_LABEL_DEFAULT__`), so a test can reload as if a new version had
 * changed the default, and see an unchanged value follow it.
 */
const LABEL_DEFAULT =
  typeof (globalThis as { __STAVE_E2E_TONE_LABEL_DEFAULT__?: unknown }).__STAVE_E2E_TONE_LABEL_DEFAULT__ === 'string'
    ? ((globalThis as { __STAVE_E2E_TONE_LABEL_DEFAULT__?: string }).__STAVE_E2E_TONE_LABEL_DEFAULT__ as string)
    : 'Test tone is on'

export const E2E_TONE_SETTINGS: readonly ExtensionSetting[] = [
  { id: 'showLabel', label: 'Show a label', description: 'Put a line of text in the bar under each code editor.', type: 'boolean', default: false },
  { id: 'labelText', label: 'Label text', description: 'What the label says.', type: 'text', default: LABEL_DEFAULT },
  {
    id: 'labelCase',
    label: 'Label case',
    description: 'Whether the label is shown as typed or in capitals.',
    type: 'choice',
    options: [
      { value: 'asTyped', label: 'As typed' },
      { value: 'upper', label: 'Capitals' },
    ],
    default: 'asTyped',
  },
  { id: 'labelSize', label: 'Label size', description: 'The size of the label’s letters, in pixels.', type: 'number', default: 12, min: 8, max: 32, step: 1 },
]

/** The common part: the label, redrawn whenever one of its settings changes. */
function showLabel(host: ExtensionHost): void {
  const draws = new Set<() => void>()
  host.onEditor((code) => {
    let el: HTMLElement | null = null
    const draw = () => {
      if (host.settings.get('showLabel') !== true) {
        el?.remove()
        el = null
        return
      }
      if (!el) {
        el = code.bar.ownerDocument.createElement('div')
        el.setAttribute('data-e2e-tone-label', '')
        el.style.cssText = 'padding:2px 10px;color:var(--text-secondary);font-family:system-ui,sans-serif'
        code.bar.appendChild(el)
      }
      const text = String(host.settings.get('labelText'))
      el.textContent = host.settings.get('labelCase') === 'upper' ? text.toUpperCase() : text
      el.style.fontSize = `${Number(host.settings.get('labelSize'))}px`
    }
    draw()
    draws.add(draw)
    return () => {
      draws.delete(draw)
      el?.remove()
    }
  })
  host.settings.onChange(() => {
    for (const draw of draws) draw()
  })
}

/** The worklet: a sine between `begin` and `end` (audio-clock seconds), then it ends itself. */
const PROCESSOR_SOURCE = `
class StaveE2ETone extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = (options && options.processorOptions) || {}
    this.begin = o.begin || 0
    this.end = o.end || 0
    this.step = (2 * Math.PI * (o.freq || 440)) / sampleRate
    this.phase = 0
  }
  process(_inputs, outputs) {
    const out = outputs[0]
    const t0 = currentTime
    for (let i = 0; i < out[0].length; i++) {
      const t = t0 + i / sampleRate
      const v = t >= this.begin && t < this.end ? 0.4 * Math.sin(this.phase) : 0
      this.phase += this.step
      for (const ch of out) ch[i] = v
    }
    if (t0 >= this.end) {
      this.port.postMessage('ended')
      return false
    }
    return true
  }
}
registerProcessor('${PROCESSOR}', StaveE2ETone)
`

function freqOf(value: Record<string, unknown>): number {
  if (typeof value.freq === 'number') return value.freq
  if (typeof value.note === 'number') return 440 * 2 ** ((value.note - 69) / 12)
  return 440
}

/**
 * One URL for the page: a context that has loaded the worklet once refuses a second module
 * registering the same processor name, so switching it on again must hand over the same URL.
 */
let workletUrl: string | null = null

async function load(): Promise<ExtensionModule> {
  workletUrl ??= URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: 'text/javascript' }))
  const url = workletUrl
  const trigger: SoundTrigger = (t: number, value: Record<string, unknown>, onEnded: () => void) => {
    // The context superdough is playing into right now: the live one, or a render's.
    // Strudel publishes `getAudioContext` as a global when it starts.
    const ac = (globalThis as { getAudioContext?: () => BaseAudioContext }).getAudioContext?.()
    if (!ac) return undefined
    const duration = typeof value.duration === 'number' ? value.duration : 0.25
    const node = new AudioWorkletNode(ac, PROCESSOR, {
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: { begin: t, end: t + duration, freq: freqOf(value) },
    })
    node.port.onmessage = () => {
      node.disconnect()
      onEnded()
    }
    return { node, stop: () => undefined }
  }
  return {
    activate: showLabel,
    strudel: {
      worklets: [url],
      activate(host) {
        host.registerSound(E2E_TONE_SOUND, trigger, { type: 'synth' })
      },
    },
  }
}

export const E2E_TONE: ExtensionManifest = {
  id: E2E_TONE_ID,
  name: 'Test tone',
  description: 'A sine tone for end-to-end tests',
  languages: ['strudel'],
  provides: {
    strudel: { sounds: [E2E_TONE_SOUND] },
    // #2545 — one key on a Stave command's chord (Toggle Sidebar, on every platform), so a
    // browser test can see Keyboard Shortcuts mark the clash and hand the key back. The
    // extension does nothing with it: while it is taken, the key simply runs no Stave
    // command inside the code.
    keys: [E2E_TONE_KEY],
    // #2556 — one setting of each type, all used by the label (`showLabel` above)
    settings: E2E_TONE_SETTINGS,
  },
  load,
  about: {
    version: '0.0.1',
    experimental: true,
    icon: '∿',
    tint: 'linear-gradient(135deg, #0f766e, #4f46e5)',
    summary: 'A plain sine tone, made by an audio worklet. It exists only in end-to-end test runs, to check that switching an extension on and off works.',
    readme: [
      {
        heading: 'Play it like any sound',
        text: 'Switch it on, then use it as a sound name. It plays live and in bounces.',
        code: 'note("c4 e4 g4").s("e2etone")',
      },
      {
        heading: 'Settings',
        text: 'It has one setting of each kind, all for a label it can show under the code. They are there to test how Settings shows an extension’s settings.',
      },
      {
        heading: 'Keys',
        text: 'It takes one key inside the code, the one Stave uses to toggle the sidebar, and does nothing with it. It is there to test how Keyboard Shortcuts shows an extension’s keys.',
      },
    ],
    changes: [{ version: '0.0.1', note: 'First version.' }],
    worklets: ['the tone itself, in live playback, bounces and stems'],
  },
}
