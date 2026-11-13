import * as Monaco from 'monaco-editor';

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
 *  - the common part at page load, from the person's saved choice (`runtime.ts`;
 *    the app calls the entry's `startPageExtensions` as the editor package loads);
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
type ExtensionLanguage = 'strudel' | 'sonicpi' | 'hydra' | 'p5js' | 'glsl' | 'three' | 'markdown';
/** The Strudel names an extension adds, so Stave can say which extension a project needs. */
interface StrudelProvides {
    readonly sounds?: readonly string[];
    readonly controls?: readonly string[];
}
/**
 * A key an extension uses (#2513), declared up front the way a VS Code extension lists
 * `contributes.keybindings`: data, read without loading the extension, so Stave can show
 * it and the person can hand it back. An extension never writes the person's own
 * shortcuts (`stave:keybindings`).
 *
 * While the extension is on and the cursor is in a code editor, a declared key that is
 * not handed back runs no Stave command: the extension answers it inside the editor.
 * Who wins a key: the person's own rebind, then the extension's key, then Stave's
 * default. Outside the code, and for a key handed back, Stave behaves exactly as before.
 */
interface ExtensionKey {
    /**
     * One chord in Stave's vocabulary (`ctrl+r`, `mod+shift+p`): modifiers (`mod`, `ctrl`,
     * `shift`, `alt`, and their aliases `cmd`, `meta`, `control`, `option`) then one key.
     * `mod` is Cmd on a Mac and Ctrl elsewhere; on a Mac `ctrl` is the Control key.
     */
    readonly key: string;
    /** what it does, in the person's words (`Redo`) */
    readonly name: string;
    /** where the key is the extension's: `'code'` is "while the cursor is in a code editor", the only place for now */
    readonly where: 'code';
    /** true: the key goes to Stave unless the person gives it to the extension (VSCodeVim does this with Ctrl+Z) */
    readonly givenBack?: boolean;
}
/**
 * What an extension provides. Each language key (`strudel`, …) must be one of the
 * manifest's `languages`, listed by name (`'*'` does not count): a manifest that breaks
 * this is refused when the list of extensions is read. Later languages add their own key.
 * `keys` belongs to no language; it is checked when the list is read too (`keys.ts`).
 */
interface ExtensionProvides {
    readonly strudel?: StrudelProvides;
    /** the keys it uses in the code editor (#2513) */
    readonly keys?: readonly ExtensionKey[];
}
/** The data half: read freely, loads nothing. */
interface ExtensionManifest {
    /** stable id, also the key in the on/off store (`voice`) */
    readonly id: string;
    /** the name people see (`Voice`) */
    readonly name: string;
    /** one line for the Extensions view (#2511) */
    readonly description: string;
    /**
     * The languages it is for. `'*'` means the editor as a whole, whatever the language
     * (Vim keybindings): such an extension has only a common part. An extension that adds
     * anything to a language (a Strudel sound) lists that language by name, even if it
     * also works everywhere.
     */
    readonly languages: '*' | readonly ExtensionLanguage[];
    /** the names it adds, per language (see `ExtensionProvides`) */
    readonly provides?: ExtensionProvides;
    /** the code half, loaded when switched on */
    load(): Promise<ExtensionModule>;
    /** what the Extensions view shows about it (#2511): plain data, read while it is off */
    readonly about?: ExtensionAbout;
}
/** The Strudel part of an extension's code. */
interface StrudelPart {
    /**
     * Audio worklet module URLs. Declared here, not registered by the extension (#2510):
     * before `activate`, Stave adds each one to the live audio context, and only once that
     * worked hands it to Strudel's `registerWorklet`, so every audio context made later
     * gets it too: bounce, stems, the disposable render frame. A URL that fails to load
     * stops the Strudel part switching on, and is never handed on (Strudel loads its list
     * all together, so one bad URL would cut short every later context's wait).
     */
    readonly worklets?: readonly string[];
    /** Register everything through `host`. May be async; a throw leaves nothing behind. */
    activate(host: StrudelHost): void | Promise<void>;
}
/**
 * The code half, in parts. A language part is allowed only when the manifest lists that
 * language by name; one that does not is refused when the code is loaded.
 */
interface ExtensionModule {
    /** The common part: switched on when the page starts the runtime (see above). May be async; a throw leaves nothing behind. */
    activate?(host: ExtensionHost): void | Promise<void>;
    /** The Strudel part: switched on once the Strudel engine has started. */
    readonly strudel?: StrudelPart;
}
/** A Strudel sound's trigger, as superdough calls it: `(t, value, onEnded, cps)`. */
type SoundTrigger = (...args: any[]) => any;
/**
 * One live code editor, as an extension's `onEditor` callback gets it (#2513): the code
 * editor (`EditorView`) or the read-only history view. The side-by-side diff is not one.
 */
interface CodeEditor {
    /** the Monaco editor */
    readonly editor: Monaco.editor.IStandaloneCodeEditor;
    /** the Monaco namespace it was made with (`KeyCode`, `Range`, …) */
    readonly monaco: typeof Monaco;
    /**
     * The Stave language of the file it shows now, read when asked (the history view can
     * switch files in the same editor); null when it cannot be told.
     */
    readonly language: ExtensionLanguage | null;
    /** true for the history view, and for a commit being viewed in the code editor */
    readonly readOnly: boolean;
    /**
     * This extension's own strip in the bar under the editor, made the first time it is
     * read. The bar takes no space until an extension puts something in it. The strip is
     * removed when this editor closes or the extension is switched off, so put everything
     * the extension shows for this editor inside it.
     */
    readonly bar: HTMLElement;
    /**
     * Close this editor's tab the way the person would (#2148: Vim's `:q`): the code
     * editor's tab, or the history view's. Stave saves as you type, so nothing is lost.
     * Does nothing for an editor the workspace cannot close.
     */
    close(): void;
}
/**
 * What an `onEditor` callback may return: how to undo what it set up on that editor. It
 * runs once, when that editor's own dispose event fires or the extension is switched
 * off, whichever comes first.
 */
type EditorCleanup = void | (() => void) | {
    dispose(): void;
};
/** What every extension's common part may do, whatever the language. Nothing here names a language. */
interface ExtensionHost {
    /** the extension this host belongs to */
    readonly id: string;
    /** Run `fn` when the extension is switched off, after its language parts are undone. */
    onDeactivate(fn: () => void): void;
    /**
     * Call `fn` for every live code editor (#2513): each one open now, at once, and each one
     * opened while the extension is on. What `fn` returns is run when that editor closes or
     * the extension is switched off. A throw is reported under the extension's name and
     * leaves that editor as it was; the other editors still get `fn`.
     */
    onEditor(fn: (editor: CodeEditor) => EditorCleanup): void;
    /**
     * Is `key`, one of the keys this extension declares (`provides.keys`), its own right
     * now, that is, not handed back to Stave? Ask when the key is pressed: the person can
     * hand a key back, or give it again, at any time. An undeclared key is never the
     * extension's. A handed-back key must be left alone, so Stave and the editor answer it
     * as they would without the extension.
     */
    takesKey(key: string): boolean;
    /**
     * Which of this extension's declared keys (`provides.keys`) a keystroke is, spelled as
     * the manifest spells it, or null when it is none of them (#2148). With `takesKey`,
     * this is how an extension that answers keys inside the editor leaves a handed-back key
     * alone: `const k = host.keyOf(e); if (k && !host.takesKey(k)) return`. Matched by
     * Stave's own chord builder, on the page's platform.
     */
    keyOf(event: KeyboardEvent): string | null;
    /**
     * Close every code editor's tab, the way the person would (#2148: Vim's `:qa`): each
     * through the workspace's own tab-close path. Does nothing while no workspace is open.
     */
    closeAllEditors(): void;
}
/**
 * What an extension's Strudel part may do. Everything here is undone when it is switched
 * off. The sounds and controls it may add are the ones its manifest lists under
 * `provides.strudel`; anything else is refused.
 */
interface StrudelHost {
    /** the extension this host belongs to */
    readonly id: string;
    /** Add a Strudel sound (`s("voice")`). Refuses a name that already exists. */
    registerSound(name: string, onTrigger: SoundTrigger, data?: Record<string, unknown>): void;
    /**
     * Add a Strudel control (`.lyric(...)` and the global `lyric(...)`). Refuses a name
     * that already exists, as a pattern method or as a global.
     */
    registerControl(name: string): void;
    /** Publish a global for user code. Refuses a name that already exists. */
    setGlobal(name: string, value: unknown): void;
    /** Run `fn` when this part is switched off, before the host's own undo. */
    onDeactivate(fn: () => void): void;
    /**
     * Get ready before sound starts (#2510): load a wasm, fetch a model. Stave calls every
     * active Strudel part's `fn` before each Play and before each bounce, stem and waveform
     * render, and waits for it (up to a limit), so cache your own work: the second call
     * should return at once. A throw is reported under the extension's name and the rest
     * of the song still plays. Never load anything inside a sound's trigger instead: the
     * first notes would be lost, and an offline render would hold its memory for good.
     */
    onPrepare(fn: () => unknown): void;
}
/**
 * What the Extensions view (#2511) shows about an extension, beyond its names: its page's
 * header, readme and changes. Plain data, like the rest of the manifest, so an extension
 * that is off (its code never loaded) still has a full page.
 */
interface ExtensionAbout {
    /** its version (`0.1.0`) */
    readonly version: string;
    /** still settling: shown with an "experimental" badge */
    readonly experimental?: boolean;
    /** a glyph for its tile: one emoji or a letter or two */
    readonly icon?: string;
    /** its tile's colour, any CSS colour or gradient */
    readonly tint?: string;
    /** a sentence or two on what it is, for the top of its page */
    readonly summary?: string;
    /** the page's Details tab: short sections, each with optional example code */
    readonly readme?: readonly {
        readonly heading: string;
        readonly text: string;
        readonly code?: string;
    }[];
    /** the Changes tab, newest first */
    readonly changes?: readonly {
        readonly version: string;
        readonly note: string;
    }[];
    /**
     * What each of its audio worklets is for, one line each. The worklets themselves are
     * in its code (`StrudelPart.worklets`); a test holds the two to the same count.
     */
    readonly worklets?: readonly string[];
    /** what it gets ready before sound starts (its `onPrepare`), in one line */
    readonly prepares?: string;
}

export type { CodeEditor as C, ExtensionManifest as E, SoundTrigger as S, ExtensionModule as a, ExtensionLanguage as b, EditorCleanup as c, ExtensionAbout as d, ExtensionHost as e, ExtensionKey as f };
