/**
 * The live code editors, for extensions (#2513).
 *
 * The code editor is unmounted and remounted on every tab switch, when a split opens, and
 * when a commit is viewed; the history view makes its own. The registry that maps a file
 * to its editor (`workspace/editorRegistry.ts`) is keyed by file, so two editors of one
 * file overwrite each other there. An extension that follows editors needs every one, once
 * each, so this list is keyed by the editor itself and follows each editor's OWN dispose
 * event.
 *
 * Who offers: `EditorView` and `HistoryViewOverlay`, from their Monaco mount handlers
 * (`offerCodeEditor`). The side-by-side diff does not. Who watches: each extension's
 * `host.onEditor` (`host.ts`), through `watch`.
 *
 * The rule, pinned by tests: for every (watcher, editor) pair, the watcher's callback runs
 * once and its cleanup runs once, when the editor goes or the watcher stops, whichever is
 * first. Never a cleanup without a call, never a second of either.
 *
 * Nothing here imports the rest of the editor: the editor and the Monaco namespace are
 * handed in by whoever offers them.
 */
import type { CodeEditor, ExtensionLanguage } from './types'

/** An editor as it is offered: what `CodeEditor` holds, but the bar is the whole bar. */
export interface CodeEditorSite {
  readonly editor: CodeEditor['editor']
  readonly monaco: CodeEditor['monaco']
  /** the Stave language of the file shown now */
  language(): ExtensionLanguage | null
  readonly readOnly: boolean
  /** the bar under the editor; each extension gets its own strip inside it */
  readonly bar: HTMLElement
  /** close this editor's tab through the workspace's tab-close path (#2148), if it can be */
  close?(): void
}

/** What a watcher gets for each editor; returns how to undo it, or nothing. */
export type EditorWatcher = (site: CodeEditorSite) => (() => void) | void

/** The list of live code editors, and who follows them. */
export interface CodeEditorList {
  /**
   * An editor is live. Returns the withdraw, which `offer` also runs on the editor's own
   * dispose event; running it more than once is harmless.
   */
  offer(site: CodeEditorSite): () => void
  /** Follow every live editor, now and later. Returns the stop, which undoes every one. */
  watch(fn: EditorWatcher): () => void
  /** how many editors are live now */
  size(): number
}

export function createCodeEditorList(opts: {
  /** where a watcher that throws is reported; the other watchers and editors go on */
  onError?: (error: unknown) => void
} = {}): CodeEditorList {
  /** for each live editor, the cleanup each watcher left on it */
  const live = new Map<CodeEditorSite, Map<EditorWatcher, () => void>>()
  const watchers = new Set<EditorWatcher>()
  const withdraws = new Map<CodeEditorSite, () => void>()
  const report = (e: unknown) => {
    try {
      opts.onError?.(e)
    } catch {
      /* a broken reporter must not stop the rest */
    }
  }

  function start(fn: EditorWatcher, site: CodeEditorSite) {
    const undos = live.get(site)
    if (!undos || undos.has(fn)) return
    let undo: (() => void) | void
    try {
      undo = fn(site)
    } catch (e) {
      report(e)
      return
    }
    undos.set(fn, typeof undo === 'function' ? undo : () => undefined)
  }

  function stop(fn: EditorWatcher, site: CodeEditorSite) {
    const undos = live.get(site)
    const undo = undos?.get(fn)
    if (!undo) return
    undos!.delete(fn)
    try {
      undo()
    } catch (e) {
      report(e)
    }
  }

  return {
    offer(site) {
      const already = withdraws.get(site)
      if (already) return already
      live.set(site, new Map())
      let sub: { dispose?(): void } | undefined
      const withdraw = () => {
        if (!withdraws.delete(site)) return
        // the watchers that followed it, newest first
        for (const fn of [...(live.get(site)?.keys() ?? [])].reverse()) stop(fn, site)
        live.delete(site)
        sub?.dispose?.()
      }
      withdraws.set(site, withdraw)
      // The editor's OWN dispose event: a tab switch, a closed split, the history view
      // closing. Hooked before any watcher sees it, so no watcher can outlive the editor.
      sub = site.editor.onDidDispose?.(withdraw) as { dispose?(): void } | undefined
      for (const fn of [...watchers]) start(fn, site)
      return withdraw
    },
    watch(fn) {
      // a watcher is one function; wrap it so the same function given twice is two watchers
      const own: EditorWatcher = (site) => fn(site)
      watchers.add(own)
      for (const site of [...live.keys()]) start(own, site)
      return () => {
        if (!watchers.delete(own)) return
        for (const site of [...live.keys()]) stop(own, site)
      }
    },
    size: () => live.size,
  }
}

let page: CodeEditorList | null = null
let pageReport: ((error: unknown) => void) | null = null

/** Where a watcher's throw is reported on this page (set by the runtime when it starts). */
export function setCodeEditorErrorReport(fn: ((error: unknown) => void) | null): void {
  pageReport = fn
}

/** The page's one list of live code editors. */
export function pageCodeEditors(): CodeEditorList {
  page ??= createCodeEditorList({
    onError: (e) => {
      if (pageReport) pageReport(e)
      else console.error(e)
    },
  })
  return page
}

/**
 * The workspace's door for closing every code editor's tab (#2148: Vim's `:qa`). The
 * workspace shell hands it in while it is mounted (this directory imports nothing from
 * the workspace), and takes it away when it goes.
 */
let closeAll: (() => void) | null = null

/** Hand in (or, with null, take away) how to close every code editor's tab. */
export function setCloseAllCodeEditors(fn: (() => void) | null): void {
  closeAll = fn
}

/** Close every code editor's tab, if a workspace has handed in how. */
export function closeAllCodeEditors(): void {
  closeAll?.()
}

/**
 * A code editor is live on this page (#2513): every switched-on extension that follows
 * editors gets it now, and every one switched on later. Call it from the editor's Monaco
 * mount handler. The returned withdraw runs by itself on the editor's dispose event; call
 * it yourself too if the component can go first.
 */
export function offerCodeEditor(site: CodeEditorSite): () => void {
  return pageCodeEditors().offer(site)
}
