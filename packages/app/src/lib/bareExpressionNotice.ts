/**
 * Saying, once per song, that it plays a bare expression (#2067).
 *
 * A bare expression is a statement with no `$:` in front. Strudel plays one only
 * while it is the last statement and no live `$:` label exists, so adding a `$:`
 * line, or another bare line below it, silences it without a word. Stave also
 * shows and edits a `$:` track best: its own lane, Mixer strip and edits.
 *
 * The notice only advises; nothing is rewritten. Its condition is the one its
 * advice turns off: put `$:` in front, and the song plays labels, not a bare
 * expression. Which line plays is `playsBareExpression`'s to say, the same check
 * the Library's Insert uses, so the two never disagree.
 *
 * Once per song: a song that has been told is remembered by its file id, in this
 * browser. When storage is unavailable, it is remembered until the page reloads.
 */
import { playsBareExpression } from '@stave/editor'

const STORAGE_KEY = 'stave.notice.bareExpression'

export interface BareExpressionNoticeDeps {
  /** Show the notice; `line` is the 1-based line the bare expression starts on. */
  show(message: string, line: number): void
  /** The file ids already told, and a way to add one. */
  told: { has(fileId: string): boolean; add(fileId: string): void }
}

export function bareExpressionMessage(line: number): string {
  return `Line ${line} is a bare expression: it plays only while it is the last line and no $: line exists. Put $: in front to make it a track, which Stave shows and edits best.`
}

/**
 * After a song plays `code`: if it plays a bare expression and this song has not
 * been told, tell it. Returns whether the notice was shown.
 */
export function noticeBareExpression(fileId: string, code: string, deps: BareExpressionNoticeDeps): boolean {
  if (deps.told.has(fileId)) return false
  const start = playsBareExpression(code)
  if (start === null) return false
  deps.told.add(fileId)
  const line = code.slice(0, start).split('\n').length
  deps.show(bareExpressionMessage(line), line)
  return true
}

/** The songs already told, kept in this browser's storage when it is there. */
export function storedTold(): BareExpressionNoticeDeps['told'] {
  const memory = new Set<string>()
  const read = (): string[] => {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }
  return {
    has: (fileId) => memory.has(fileId) || read().includes(fileId),
    add: (fileId) => {
      memory.add(fileId)
      try {
        const ids = read()
        if (!ids.includes(fileId)) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...ids, fileId]))
      } catch {
        // storage full or blocked: remembered in memory until the page reloads
      }
    },
  }
}
