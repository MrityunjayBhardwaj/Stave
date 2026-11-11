/**
 * Vim's bar under one code editor (#2148): the mode on the left, the keys typed so far on
 * the right, and the `:` command line and short messages in between.
 *
 * monaco-vim draws its status into a class it is handed (`initVimMode`'s third argument);
 * this is that class, written for Stave from monaco-vim's own `StatusBar` (MIT, Brijesh
 * Bittu) so it can carry Stave's look and names that tests and people can find:
 *
 *   [data-vim-bar]        the whole bar          [data-vim-mode]     -- NORMAL --
 *   [data-vim-command]    the `:` line           [data-vim-message]  a message, for a few seconds
 *   [data-vim-keys]       keys typed so far      [data-vim-input]    the `:` line's input
 *
 * Two changes from monaco-vim's: the mode reads `-- NORMAL --` and is hidden while the `:`
 * line is open (as in Vim, the command line takes its place), and a new message replaces
 * the old one with its own timer, so an earlier message's timer can't clear a newer one.
 */
import type * as Monaco from 'monaco-editor'

/** How long a message stays in the bar. */
export const VIM_MESSAGE_MS = 4000

interface ModeChange {
  mode: string
  subMode?: string
}

interface InputOptions {
  selectValueOnOpen?: boolean
  value?: string
  onKeyUp?: (event: KeyboardEvent, value: string, close: () => void) => void
  onKeyDown?: (event: KeyboardEvent, value: string, close: () => void) => boolean | void
  onKeyInput?: (event: InputEvent, value: string, close: () => void) => void
  onBlur?: (event: FocusEvent, close: () => void) => void
  closeOnBlur?: boolean
  closeOnEnter?: boolean
}

interface OpenInput {
  callback?: (value: string) => void
  options?: InputOptions
  node: HTMLInputElement
}

/** The words the bar shows for a mode. */
export function modeLabel(ev: ModeChange): string {
  if (ev.mode === 'visual') {
    if (ev.subMode === 'linewise') return '-- VISUAL LINE --'
    if (ev.subMode === 'blockwise') return '-- VISUAL BLOCK --'
    return '-- VISUAL --'
  }
  return `-- ${String(ev.mode).toUpperCase()} --`
}

export class VimBar {
  private readonly mode: HTMLSpanElement
  private readonly command: HTMLSpanElement
  private readonly message: HTMLSpanElement
  private readonly keys: HTMLSpanElement
  private input: OpenInput | null = null
  private messageTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly node: HTMLElement,
    private readonly editor: Monaco.editor.IStandaloneCodeEditor | null,
    private readonly sanitizer: ((node: Node) => Node) | null = null,
  ) {
    const doc = node.ownerDocument
    const span = (attr: string, style: string) => {
      const el = doc.createElement('span')
      el.setAttribute(attr, '')
      el.setAttribute('style', style)
      node.appendChild(el)
      return el
    }
    this.mode = span('data-vim-mode', 'white-space: pre; font-weight: 600; color: var(--accent, #6ea8fe)')
    this.command = span('data-vim-command', 'white-space: pre; display: flex; align-items: center; min-width: 0')
    this.message = span('data-vim-message', 'white-space: pre; overflow: hidden; text-overflow: ellipsis; min-width: 0')
    const spacer = doc.createElement('span')
    spacer.setAttribute('style', 'flex: 1')
    node.appendChild(spacer)
    this.keys = span('data-vim-keys', 'white-space: pre; opacity: 0.8')
    this.toggleVisibility(false)
  }

  setMode(ev: ModeChange): void {
    this.setText(modeLabel(ev))
  }

  setText(text: string): void {
    this.mode.textContent = text
  }

  setKeyBuffer(keys: string): void {
    this.keys.textContent = keys
  }

  /** Open the `:` line (or another prompt), or show `text` there; returns how to close it. */
  setSec(text: Node | string | null | undefined, callback?: (value: string) => void, options?: InputOptions): () => void {
    this.message.textContent = ''
    if (text === undefined) return this.closeInput
    this.fill(this.command, text)
    const input = this.command.querySelector('input')
    if (input) {
      input.setAttribute('data-vim-input', '')
      input.setAttribute('aria-label', 'Vim command')
      input.setAttribute(
        'style',
        'background: transparent; border: none; outline: none; color: inherit; font: inherit; padding: 0; margin: 0; min-width: 12em',
      )
      this.mode.style.display = 'none'
      input.focus()
      this.input = { callback, options, node: input }
      if (options?.selectValueOnOpen) input.select()
      if (options?.value) input.value = options.value
      this.listen(true)
    }
    return this.closeInput
  }

  toggleVisibility(show: boolean): void {
    this.node.style.display = show ? 'flex' : 'none'
    if (this.input) this.listen(false)
    if (this.messageTimer) clearTimeout(this.messageTimer)
  }

  closeInput = (): void => {
    this.listen(false)
    this.input = null
    this.mode.style.display = ''
    this.fill(this.command, '')
    this.editor?.focus()
  }

  clear = (): void => {
    if (this.messageTimer) clearTimeout(this.messageTimer)
    this.fill(this.node, '')
  }

  /** A short message, shown for a few seconds. Vim's errors come as `.cm-vim-message`. */
  showNotification(text: Node | string): void {
    const holder = this.node.ownerDocument.createElement('span')
    this.fill(holder, text)
    const isError = !!(holder.querySelector('.cm-vim-message') || (holder.firstElementChild?.classList?.contains('cm-vim-message')))
    this.message.textContent = holder.textContent
    this.message.style.color = isError ? 'var(--error, #f87171)' : ''
    this.message.toggleAttribute('data-vim-error', isError)
    if (this.messageTimer) clearTimeout(this.messageTimer)
    this.messageTimer = setTimeout(() => {
      this.message.textContent = ''
      this.messageTimer = undefined
    }, VIM_MESSAGE_MS)
  }

  // ── the `:` line's input ───────────────────────────────────────────────────────────────

  private onKeyUp = (e: KeyboardEvent): void => {
    const o = this.input?.options
    o?.onKeyUp?.(e, (e.target as HTMLInputElement).value, this.closeInput)
  }

  private onInput = (e: Event): void => {
    const o = this.input?.options
    o?.onKeyInput?.(e as InputEvent, (e.target as HTMLInputElement).value, this.closeInput)
  }

  private onBlur = (e: FocusEvent): void => {
    const o = this.input?.options
    if (!this.input) return
    o?.onBlur?.(e, this.closeInput)
    if (o?.closeOnBlur) this.closeInput()
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.input) return
    const { options, callback } = this.input
    if (options?.onKeyDown?.(e, (e.target as HTMLInputElement).value, this.closeInput)) return
    const isEnter = e.key === 'Enter' || e.keyCode === 13
    const isEscape = e.key === 'Escape' || e.keyCode === 27
    if (isEscape || (options?.closeOnEnter !== false && isEnter)) {
      this.input.node.blur()
      e.stopPropagation()
      this.closeInput()
    }
    if (isEnter && callback) {
      e.stopPropagation()
      e.preventDefault()
      callback((e.target as HTMLInputElement).value)
    }
  }

  private listen(on: boolean): void {
    const node = this.input?.node
    if (!node) return
    const method = on ? 'addEventListener' : 'removeEventListener'
    node[method]('keyup', this.onKeyUp as EventListener)
    node[method]('keydown', this.onKeyDown as EventListener)
    node[method]('input', this.onInput)
    node[method]('blur', this.onBlur as EventListener)
  }

  private fill(el: HTMLElement, content: Node | string | null | undefined): void {
    while (el.firstChild) el.removeChild(el.firstChild)
    if (!content) return
    if (typeof content === 'string') {
      el.appendChild(el.ownerDocument.createTextNode(content))
      return
    }
    el.appendChild(this.sanitizer ? this.sanitizer(content) : content)
  }
}
