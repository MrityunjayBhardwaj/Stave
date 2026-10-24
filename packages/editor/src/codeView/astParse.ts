/**
 * astParse — the acorn wrapper, alone in a module so it can be shared without
 * creating a cycle.
 *
 * WHY IT IS NOT IN `chunkDetect.ts` ANY MORE (#1240). `spanRole.ts` has always
 * imported `parseTopLevel` from `chunkDetect`; when `chunkDetect` began calling
 * the resolver, that back-edge closed a cycle — chunkDetect → resolveMiniSource
 * → spanRole → chunkDetect. TypeScript is perfectly happy with it (both package
 * typechecks stayed at their exact baselines) and so is the app bundle, but the
 * circular initialisation reordered module evaluation enough to break a
 * `vi.mock` factory four modules away: `StrudelEngine.test.ts` died at load with
 * `Cannot access 'MockPattern' before initialization`, taking a 37-test suite
 * with it. A cycle's cost is paid by whoever happens to be initialised first.
 *
 * Parsing a document has no dependency on what a chunk IS, so the dependency
 * was avoidable rather than intrinsic — the shared leaf goes at the bottom.
 * `chunkDetect` re-exports both names, so every existing import still resolves.
 */
import { parse } from 'acorn'

// acorn's node types are intentionally loose; we walk untyped nodes here.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Top-level statement nodes, or null when the doc doesn't parse
 * (mid-keystroke syntax error — the caller keeps the last good chunk). */
export function parseTopLevel(doc: string): any[] | null {
  try {
    const program = parse(doc, {
      ecmaVersion: 'latest',
      allowAwaitOutsideFunction: true,
    }) as any
    return program.body
  } catch {
    return null
  }
}

/**
 * Where `code` stops parsing, read as a function body (top-level `return` and
 * `await` allowed), the way the visual compilers run a sketch (#2220): acorn's
 * offset, and its line (1-based) and column (0-based). Null when it parses.
 */
export function syntaxErrorAt(code: string): { pos: number; line: number; column: number } | null {
  try {
    parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
    })
    return null
  } catch (e) {
    const { pos, loc } = e as { pos?: unknown; loc?: { line: number; column: number } }
    return typeof pos === 'number' && loc ? { pos, line: loc.line, column: loc.column } : null
  }
}

/** Does the doc parse at all? Distinguishes "no statement here" from "broken doc". */
export function docParses(doc: string): boolean {
  return parseTopLevel(doc) !== null
}
