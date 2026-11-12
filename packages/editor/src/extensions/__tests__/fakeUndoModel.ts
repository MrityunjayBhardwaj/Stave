import type { ContentChange } from '../vim/edges'

/**
 * A model with Monaco's undo stack, as far as Vim's undo can see it: steps (open until
 * `pushStackElement` closes them), and an alternative version id that comes back to the
 * same number when an edit is undone. Typing closes a step before a space, as Monaco does.
 */
export class FakeUndoModel {
  text = ''
  alt = 1
  private nextAlt = 2
  private past: { before: number; after: number; textBefore: string; textAfter: string }[] = []
  private future: typeof this.past = []
  private open = false
  listeners: ((e: ContentChange) => void)[] = []
  getAlternativeVersionId() {
    return this.alt
  }
  pushStackElement() {
    this.open = false
  }
  /** One edit at the end, as Monaco would make it (appended to the open step, or a new step). */
  edit(text: string) {
    this.set(this.text + text)
  }
  /** One edit that makes the text `next`. */
  set(next: string) {
    if (!this.open || !this.past.length) {
      this.past.push({ before: this.alt, after: this.alt, textBefore: this.text, textAfter: this.text })
      this.open = true
    }
    this.text = next
    this.alt = this.nextAlt++
    const step = this.past[this.past.length - 1]
    step.after = this.alt
    step.textAfter = this.text
    this.future = []
    this.emit({ isUndoing: false, isRedoing: false, isFlush: false })
  }
  /** Typing, with Monaco's own step at each space. */
  type(text: string) {
    for (const ch of text) {
      if (ch === ' ') this.pushStackElement()
      this.edit(ch)
    }
  }
  /** An edit bracketed as a step of its own (the code view's write-back). */
  bracketed(text: string) {
    this.pushStackElement()
    this.edit(text)
    this.pushStackElement()
  }
  undo() {
    const step = this.past.pop()
    if (!step) return
    this.future.push(step)
    this.alt = step.before
    this.text = step.textBefore
    this.open = false
    this.emit({ isUndoing: true, isRedoing: false, isFlush: false })
  }
  redo() {
    const step = this.future.pop()
    if (!step) return
    this.past.push(step)
    this.alt = step.after
    this.text = step.textAfter
    this.open = false
    this.emit({ isUndoing: false, isRedoing: true, isFlush: false })
  }
  get steps() {
    return this.past.length
  }
  private emit(e: ContentChange) {
    for (const fn of this.listeners) fn(e)
  }
}
