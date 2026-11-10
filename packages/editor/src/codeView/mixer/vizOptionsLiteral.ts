/**
 * vizOptionsLiteral — read a `.viz(name, { … })` options object out of the CODE,
 * without running it.
 *
 * The background viz must follow the options written in the document at every
 * moment — before the first Play, while playing, and after Stop — not only what
 * the last evaluation captured (the bus payload that carries those is withdrawn
 * on Stop). So the options are read statically, and only what can be read
 * statically is: literal values (strings, numbers, booleans, null, and arrays /
 * plain objects made of those). Anything else — `delay: slider(0.8)`, a
 * variable, `levels: 0.1 * 3` — is a DYNAMIC key: its value is taken from the
 * last evaluation, the only place code runs. An object we cannot read as a whole
 * (a spread, a computed key, a variable in place of the object) is OPAQUE and
 * falls back to the last evaluation entirely.
 */
import { parseExpressionAt } from 'acorn'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** What the code says about a viz's options. */
export type CodeVizOptions =
  | {
      readonly kind: 'literal'
      /** keys whose values are literal, with those values */
      readonly values: Readonly<Record<string, unknown>>
      /** keys present in the code whose values only an evaluation can produce */
      readonly dynamic: readonly string[]
    }
  | { readonly kind: 'opaque' }

const NOT_LITERAL = Symbol('not-literal')

function literalValue(node: any): unknown {
  switch (node?.type) {
    case 'Literal':
      if (node.regex || typeof node.bigint === 'string') return NOT_LITERAL
      return node.value
    case 'TemplateLiteral':
      return node.expressions.length === 0 ? node.quasis.map((q: any) => q.value.cooked).join('') : NOT_LITERAL
    case 'UnaryExpression':
      if ((node.operator === '-' || node.operator === '+') && node.argument?.type === 'Literal' && typeof node.argument.value === 'number') {
        return node.operator === '-' ? -node.argument.value : node.argument.value
      }
      return NOT_LITERAL
    case 'ArrayExpression': {
      const out: unknown[] = []
      for (const el of node.elements) {
        if (!el || el.type === 'SpreadElement') return NOT_LITERAL
        const v = literalValue(el)
        if (v === NOT_LITERAL) return NOT_LITERAL
        out.push(v)
      }
      return out
    }
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {}
      for (const p of node.properties) {
        const key = propertyKey(p)
        if (key === null) return NOT_LITERAL
        const v = literalValue(p.value)
        if (v === NOT_LITERAL) return NOT_LITERAL
        out[key] = v
      }
      return out
    }
    default:
      return NOT_LITERAL
  }
}

/** A plain `key: value` property's key, or null (spread, computed, method, getter). */
function propertyKey(p: any): string | null {
  if (p.type !== 'Property' || p.computed || p.kind !== 'init' || p.method) return null
  if (p.key.type === 'Identifier') return p.key.name
  if (p.key.type === 'Literal' && (typeof p.key.value === 'string' || typeof p.key.value === 'number')) {
    return String(p.key.value)
  }
  return null
}

/**
 * Read the source text of a `.viz()` options argument. Never throws: text that
 * does not parse as one object expression is opaque.
 */
export function readVizOptionsLiteral(raw: string): CodeVizOptions {
  let node: any
  try {
    node = parseExpressionAt(raw, 0, { ecmaVersion: 'latest' })
  } catch {
    return { kind: 'opaque' }
  }
  if (node.type !== 'ObjectExpression' || raw.slice(node.end).trim() !== '') return { kind: 'opaque' }
  const values: Record<string, unknown> = {}
  const dynamic: string[] = []
  for (const p of node.properties) {
    const key = propertyKey(p)
    if (key === null) return { kind: 'opaque' }
    const v = literalValue(p.value)
    if (v === NOT_LITERAL) {
      delete values[key]
      if (!dynamic.includes(key)) dynamic.push(key)
    } else {
      values[key] = v
      const i = dynamic.indexOf(key)
      if (i >= 0) dynamic.splice(i, 1) // a later literal duplicate wins, as in JS
    }
  }
  return { kind: 'literal', values, dynamic }
}

/**
 * The options the background sketch should see: the code's, with every value
 * only an evaluation can produce taken from the last one.
 *
 *  - `code === null`  — the call has no options argument: `{}`.
 *  - opaque           — the last evaluated options, or `{}` before any.
 *  - literal          — the literal values, plus each dynamic key's last evaluated
 *                       value (a dynamic key with no evaluation yet is left out).
 */
export function resolveVizOptions(
  code: CodeVizOptions | null,
  evaluated: Readonly<Record<string, unknown>> | null,
): Record<string, unknown> {
  if (code === null) return {}
  if (code.kind === 'opaque') return { ...(evaluated ?? {}) }
  const out: Record<string, unknown> = { ...code.values }
  for (const key of code.dynamic) {
    if (evaluated && Object.prototype.hasOwnProperty.call(evaluated, key)) out[key] = evaluated[key]
  }
  return out
}
