/**
 * Extensions (#2507): features you switch on, instead of features built into the core.
 *
 * An extension comes in two halves, and the split is the point:
 *
 *  - Its MANIFEST is plain data, always present: who it is, and which Strudel names it
 *    provides. Stave can read it without loading anything, which is how a project that
 *    uses a switched-off extension can be told so by name (#2512) — the names a project
 *    uses are found by Stave's own runtime (a missing sound, a missing pattern method),
 *    never by a second reader of the code.
 *  - Its MODULE is the code, loaded by dynamic import only when it is switched on.
 *
 * An extension never touches Stave's registries directly. It registers through the
 * host it is given, which records each registration so that switching it off undoes
 * exactly what it did and nothing else (see `host.ts`).
 */

/** The data half: read freely, loads nothing. */
export interface ExtensionManifest {
  /** stable id, also the key in the on/off store (`voice`) */
  readonly id: string
  /** the name people see (`Voice`) */
  readonly name: string
  /** one line for Settings */
  readonly description: string
  /** the Strudel names it adds, so Stave can say which extension a project needs */
  readonly provides: {
    readonly sounds?: readonly string[]
    readonly controls?: readonly string[]
  }
  /** the code half, loaded when switched on */
  load(): Promise<ExtensionModule>
}

/** The code half. */
export interface ExtensionModule {
  /**
   * Audio worklet module URLs. Declared here, not registered by the extension (#2510):
   * before `activate`, Stave adds each one to the live audio context, and only once that
   * worked hands it to Strudel's `registerWorklet`, so every audio context made later
   * gets it too: bounce, stems, the disposable render frame. A URL that fails to load
   * stops the extension switching on, and is never handed on (Strudel loads its list
   * all together, so one bad URL would cut short every later context's wait).
   */
  readonly worklets?: readonly string[]
  /** Register everything through `host`. May be async; a throw leaves nothing behind. */
  activate(host: ExtensionHost): void | Promise<void>
}

/** A Strudel sound's trigger, as superdough calls it: `(t, value, onEnded, cps)`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SoundTrigger = (...args: any[]) => any

/** What an extension may do. Everything here is undone when it is switched off. */
export interface ExtensionHost {
  /** the extension this host belongs to */
  readonly id: string
  /** Add a Strudel sound (`s("voice")`). Refuses a name that already exists. */
  registerSound(name: string, onTrigger: SoundTrigger, data?: Record<string, unknown>): void
  /**
   * Add a Strudel control (`.lyric(...)` and the global `lyric(...)`). Refuses a name
   * that already exists, as a pattern method or as a global.
   */
  registerControl(name: string): void
  /** Publish a global for user code. Refuses a name that already exists. */
  setGlobal(name: string, value: unknown): void
  /** Run `fn` when the extension is switched off, before the host's own undo. */
  onDeactivate(fn: () => void): void
  /**
   * Get ready before sound starts (#2510): load a wasm, fetch a model. Stave calls every
   * active extension's `fn` before each Play and before each bounce, stem and waveform
   * render, and waits for it (up to a limit), so cache your own work: the second call
   * should return at once. A throw is reported under the extension's name and the rest
   * of the song still plays. Never load anything inside a sound's trigger instead: the
   * first notes would be lost, and an offline render would hold its memory for good.
   */
  onPrepare(fn: () => unknown): void
}
