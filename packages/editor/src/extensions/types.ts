/**
 * Extensions (#2507): features you switch on, instead of features built into the core.
 *
 * An extension comes in two halves, and the split is the point:
 *
 *  - Its MANIFEST is plain data, always present: who it is, which languages it is for,
 *    and, per language, the names it provides. Stave can read it without loading
 *    anything, which is how a project that uses a switched-off extension can be told so
 *    by name (#2512) — the names a project uses are found by Stave's own runtime (a
 *    missing sound, a missing pattern method), never by a second reader of the code.
 *  - Its MODULE is the code, loaded by dynamic import only when it is switched on. It
 *    comes in PARTS (#2538): a common part that works in the editor whatever the
 *    language, and one part per language it declares (`strudel`, later `sonicpi`, …).
 *
 * WHEN EACH PART SWITCHES ON (#2538), the way VS Code activates an extension for a language:
 *  - the common part when the page starts the runtime, from the person's saved choice
 *    (`runtime.ts`: at page load once the app's call is wired, until then when the first
 *    engine starts);
 *  - a language part when that language's runtime starts (for Strudel: the engine's
 *    start-up), or at once if it is already running.
 * Switching off undoes the language parts first, newest first, then the common part.
 *
 * An extension never touches Stave's registries directly. Each part registers through the
 * host it is given, which records each registration so that switching it off undoes
 * exactly what it did and nothing else (see `host.ts`).
 */

/**
 * The languages an extension can be for: Stave's own language ids, the ones a workspace
 * file declares (`WorkspaceLanguage` in `workspace/types.ts`; a test keeps the two equal,
 * because this directory imports nothing from the rest of the editor).
 */
export type ExtensionLanguage = 'strudel' | 'sonicpi' | 'hydra' | 'p5js' | 'glsl' | 'three' | 'markdown'

/** The Strudel names an extension adds, so Stave can say which extension a project needs. */
export interface StrudelProvides {
  readonly sounds?: readonly string[]
  readonly controls?: readonly string[]
}

/**
 * What an extension provides, keyed by language. A key must be one of the manifest's
 * `languages`, listed by name (`'*'` does not count): a manifest that breaks this is
 * refused when the list of extensions is read. Later languages add their own key.
 */
export interface ExtensionProvides {
  readonly strudel?: StrudelProvides
}

/** The data half: read freely, loads nothing. */
export interface ExtensionManifest {
  /** stable id, also the key in the on/off store (`voice`) */
  readonly id: string
  /** the name people see (`Voice`) */
  readonly name: string
  /** one line for the Extensions view (#2511) */
  readonly description: string
  /**
   * The languages it is for. `'*'` means the editor as a whole, whatever the language
   * (Vim keybindings): such an extension has only a common part. An extension that adds
   * anything to a language (a Strudel sound) lists that language by name, even if it
   * also works everywhere.
   */
  readonly languages: '*' | readonly ExtensionLanguage[]
  /** the names it adds, per language (see `ExtensionProvides`) */
  readonly provides?: ExtensionProvides
  /** the code half, loaded when switched on */
  load(): Promise<ExtensionModule>
}

/** The Strudel part of an extension's code. */
export interface StrudelPart {
  /**
   * Audio worklet module URLs. Declared here, not registered by the extension (#2510):
   * before `activate`, Stave adds each one to the live audio context, and only once that
   * worked hands it to Strudel's `registerWorklet`, so every audio context made later
   * gets it too: bounce, stems, the disposable render frame. A URL that fails to load
   * stops the Strudel part switching on, and is never handed on (Strudel loads its list
   * all together, so one bad URL would cut short every later context's wait).
   */
  readonly worklets?: readonly string[]
  /** Register everything through `host`. May be async; a throw leaves nothing behind. */
  activate(host: StrudelHost): void | Promise<void>
}

/**
 * The code half, in parts. A language part is allowed only when the manifest lists that
 * language by name; one that does not is refused when the code is loaded.
 */
export interface ExtensionModule {
  /** The common part: switched on when the page starts the runtime (see above). May be async; a throw leaves nothing behind. */
  activate?(host: ExtensionHost): void | Promise<void>
  /** The Strudel part: switched on once the Strudel engine has started. */
  readonly strudel?: StrudelPart
}

/** A Strudel sound's trigger, as superdough calls it: `(t, value, onEnded, cps)`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SoundTrigger = (...args: any[]) => any

/**
 * What every extension's common part may do, whatever the language. Nothing here names a
 * language. (The editor hook, #2513, joins it.)
 */
export interface ExtensionHost {
  /** the extension this host belongs to */
  readonly id: string
  /** Run `fn` when the extension is switched off, after its language parts are undone. */
  onDeactivate(fn: () => void): void
}

/**
 * What an extension's Strudel part may do. Everything here is undone when it is switched
 * off. The sounds and controls it may add are the ones its manifest lists under
 * `provides.strudel`; anything else is refused.
 */
export interface StrudelHost {
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
  /** Run `fn` when this part is switched off, before the host's own undo. */
  onDeactivate(fn: () => void): void
  /**
   * Get ready before sound starts (#2510): load a wasm, fetch a model. Stave calls every
   * active Strudel part's `fn` before each Play and before each bounce, stem and waveform
   * render, and waits for it (up to a limit), so cache your own work: the second call
   * should return at once. A throw is reported under the extension's name and the rest
   * of the song still plays. Never load anything inside a sound's trigger instead: the
   * first notes would be lost, and an offline render would hold its memory for good.
   */
  onPrepare(fn: () => unknown): void
}
