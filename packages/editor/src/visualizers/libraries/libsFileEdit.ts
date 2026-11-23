/**
 * libsFileEdit — add or replace one entry in `stave.libs.json`'s text (#2643),
 * keeping everything else the person wrote: the other entries, their order,
 * the indentation, and any whitespace between them.
 *
 * Only the top-level object is scanned (strings are skipped whole, nested
 * values by bracket depth), then the new entry is spliced in as text. The
 * result is parsed back and compared with what it must mean; if a hand-made
 * layout ever defeats the splice, the file is rewritten as plain two-space JSON
 * instead, which still keeps every entry.
 */

import { LIBS_FILE, type LibraryDeclaration } from './declarations'

export type LibsFileEdit = { ok: true; text: string } | { ok: false; message: string }

/** An entry's value as written in the file: url first, then sha384. */
function declValue(decl: LibraryDeclaration): { url: string; sha384?: string } {
  return decl.sha384 === undefined ? { url: decl.url } : { url: decl.url, sha384: decl.sha384 }
}

interface Member {
  /** Where the key's opening quote is. */
  keyStart: number
  key: string
  valueStart: number
  /** One past the value's last character. */
  valueEnd: number
}

interface TopLevel {
  open: number
  close: number
  members: Member[]
}

/** Skip whitespace from `i`. */
function ws(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i])) i++
  return i
}

/** `i` is at a `"`; returns one past the closing quote. */
function skipString(text: string, i: number): number {
  i++
  while (i < text.length) {
    if (text[i] === '\\') i += 2
    else if (text[i] === '"') return i + 1
    else i++
  }
  throw new Error('unterminated string')
}

/** One past the end of the JSON value starting at `i`. */
function skipValue(text: string, i: number): number {
  if (text[i] === '"') return skipString(text, i)
  if (text[i] === '{' || text[i] === '[') {
    let depth = 0
    while (i < text.length) {
      const c = text[i]
      if (c === '"') {
        i = skipString(text, i)
        continue
      }
      if (c === '{' || c === '[') depth++
      else if (c === '}' || c === ']') {
        depth--
        if (depth === 0) return i + 1
      }
      i++
    }
    throw new Error('unbalanced brackets')
  }
  while (i < text.length && !/[\s,}\]]/.test(text[i])) i++
  return i
}

/** The top-level object's members, with where each sits. The text is already known to parse. */
function scanTopLevel(text: string): TopLevel {
  const open = ws(text, 0)
  if (text[open] !== '{') throw new Error('not an object')
  const members: Member[] = []
  let i = ws(text, open + 1)
  while (text[i] !== '}') {
    const keyStart = i
    const keyEnd = skipString(text, i)
    const key = JSON.parse(text.slice(keyStart, keyEnd)) as string
    i = ws(text, keyEnd)
    i = ws(text, i + 1) // past ':'
    const valueStart = i
    const valueEnd = skipValue(text, i)
    members.push({ keyStart, key, valueStart, valueEnd })
    i = ws(text, valueEnd)
    if (text[i] === ',') i = ws(text, i + 1)
  }
  return { open, close: i, members }
}

/** The whitespace at the start of the line holding `pos`. */
function lineIndent(text: string, pos: number): string {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  return /^[ \t]*/.exec(text.slice(lineStart))![0]
}

function plain(obj: Record<string, unknown>): string {
  return `${JSON.stringify(obj, null, 2)}\n`
}

function sameMeaning(text: string, want: Record<string, unknown>): boolean {
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(want)
  } catch {
    return false
  }
}

/**
 * `text` (the current `stave.libs.json`, or null when there is none) with
 * `name` declared as `decl`. An existing entry for `name` is replaced in place;
 * a new one goes last. Refuses — and changes nothing — when the current text
 * isn't a JSON object, since rewriting it would lose what the person wrote.
 */
export function withLibraryDeclaration(text: string | null | undefined, name: string, decl: LibraryDeclaration): LibsFileEdit {
  const value = declValue(decl)
  if (text == null || text.trim() === '') return { ok: true, text: plain({ [name]: value }) }

  let current: unknown
  try {
    current = JSON.parse(text)
  } catch (e) {
    return { ok: false, message: `${LIBS_FILE} isn't valid JSON (${e instanceof Error ? e.message : String(e)}), so it was left as it is. Fix it, then add the library again.` }
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    return { ok: false, message: `${LIBS_FILE} should hold one object, { "<import name>": { "url": "…", "sha384": "…" } }, so it was left as it is.` }
  }
  // What the file must mean afterwards: every entry as it was, this one set (a new key goes last).
  const want: Record<string, unknown> = { ...(current as Record<string, unknown>), [name]: value }

  let spliced: string
  try {
    spliced = splice(text, name, value)
  } catch {
    return { ok: true, text: plain(want) }
  }
  return { ok: true, text: sameMeaning(spliced, want) ? spliced : plain(want) }
}

function splice(text: string, name: string, value: { url: string; sha384?: string }): string {
  const top = scanTopLevel(text)
  const multiline = text.slice(top.open, top.close).includes('\n')
  const first = top.members[0]
  const memberIndent = first ? lineIndent(text, first.keyStart) : '  '
  const outerIndent = lineIndent(text, top.open)
  // The indent step the file uses, read off its first member (two spaces when it has none).
  const step = first && memberIndent.startsWith(outerIndent) && memberIndent.length > outerIndent.length ? memberIndent.slice(outerIndent.length) : '  '

  const render = (indent: string): string => {
    if (!multiline) return `{ ${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`
    return JSON.stringify(value, null, step).replace(/\n/g, `\n${indent}`)
  }

  const existing = top.members.filter((m) => m.key === name)
  if (existing.length > 0) {
    // Replace the last one: JSON.parse keeps the last duplicate, so that is the one in force.
    const m = existing[existing.length - 1]
    return text.slice(0, m.valueStart) + render(lineIndent(text, m.keyStart)) + text.slice(m.valueEnd)
  }

  const entry = `${JSON.stringify(name)}: ${render(memberIndent)}`
  if (top.members.length === 0) {
    const inner = multiline ? `\n${memberIndent}${entry}\n${outerIndent}` : ` ${entry} `
    return text.slice(0, top.open + 1) + inner + text.slice(top.close)
  }
  const last = top.members[top.members.length - 1]
  const sep = multiline ? `,\n${memberIndent}` : ', '
  return text.slice(0, last.valueEnd) + sep + entry + text.slice(last.valueEnd)
}
