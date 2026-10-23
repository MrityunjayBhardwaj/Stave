/**
 * #2186 — every method a pattern doesn't have, not just the first one hit.
 *
 * A run stops at its first error, so `$: s("bd").gin(1)` above
 * `$: s("hh").fooo(2)` reports only `gin`; `fooo` waits for the next run. This
 * reads the code instead of running it, and lists each call to a method that
 * Strudel's patterns don't have, on a chain that is plainly a pattern:
 *
 *  - it starts from a mini-notation string (`"bd sd"`, `` `bd sd` ``), a global
 *    that IS a pattern (`sine`, `silence`), or a call to a global that builds
 *    one (`s(...)`, `note(...)`, `stack(...)`, `arrange(...)`), and
 *  - every method before the call is a pattern method.
 *
 * What counts as a pattern method is the runtime's own `Pattern.prototype`,
 * read when asked (`PatternRuntime`), so methods added by `register` or by
 * Stave are known. A `register('name', …)` in the code itself counts too:
 * when the run fails before it, it hasn't been added yet. A call on anything
 * else (your own objects, a name the code declares) is never listed.
 */
import { parse } from 'acorn'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PatternRuntime {
  /** is `name` a method of a pattern (`name in Pattern.prototype`)? */
  isMethod(name: string): boolean
  /** is the global `name` itself a pattern (`sine`, `silence`)? */
  isPatternValue(name: string): boolean
  /** does calling the global `name` build a pattern (`s`, `stack`, `arrange`)? */
  isPatternFunction(name: string): boolean
}

export interface MissingMethod {
  name: string
  /** the chain it is called on, written the way the browser's error would (`s(...)`) */
  receiver: string
  /** where the method's name is written, 1-based */
  line: number
  column: number
}

/**
 * Pattern methods whose result is not a pattern (haps, a string), so a chain
 * stops being one after them. From `@strudel/core` `pattern.mjs`.
 */
const NOT_PATTERN_RESULT = new Set(['queryArc', 'query', 'firstCycle', 'showFirstCycle', 'sortHapsByPart', 'toString', 'valueOf'])

/** Every node under `node`, depth first, in source order. */
function each(node: any, visit: (n: any) => void): void {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'loc') continue
    const child = node[key]
    if (Array.isArray(child)) child.forEach((c) => each(c, visit))
    else if (child && typeof child === 'object' && typeof child.type === 'string') each(child, visit)
  }
}

/** Names the code declares, so a call to its own `s` or `note` is not taken for Strudel's. */
function declaredNames(program: any): Set<string> {
  const names = new Set<string>()
  const bind = (pattern: any): void => {
    if (!pattern) return
    if (pattern.type === 'Identifier') names.add(pattern.name)
    else if (pattern.type === 'ObjectPattern') pattern.properties.forEach((p: any) => bind(p.value ?? p.argument))
    else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(bind)
    else if (pattern.type === 'AssignmentPattern') bind(pattern.left)
    else if (pattern.type === 'RestElement') bind(pattern.argument)
  }
  each(program, (n) => {
    if (n.type === 'VariableDeclarator') bind(n.id)
    else if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
      if (n.id) bind(n.id)
      n.params.forEach(bind)
    } else if (n.type === 'ClassDeclaration' && n.id) bind(n.id)
    else if (n.type === 'CatchClause') bind(n.param)
    else if (n.type === 'ImportSpecifier' || n.type === 'ImportDefaultSpecifier' || n.type === 'ImportNamespaceSpecifier') bind(n.local)
  })
  return names
}

/** `register('name', …)` calls in the code: methods it adds when it runs. */
function registeredNames(program: any): Set<string> {
  const names = new Set<string>()
  each(program, (n) => {
    const [first] = n.type === 'CallExpression' ? n.arguments : []
    if (n.callee?.type === 'Identifier' && n.callee.name === 'register' && first?.type === 'Literal' && typeof first.value === 'string') {
      names.add(first.value)
    }
  })
  return names
}

const methodName = (callee: any): string | null =>
  callee?.type === 'MemberExpression' && !callee.computed && !callee.optional && callee.property.type === 'Identifier'
    ? callee.property.name
    : null

export function findMissingPatternMethods(code: string, runtime: PatternRuntime): MissingMethod[] {
  let program: any
  try {
    program = parse(code, { ecmaVersion: 'latest', allowAwaitOutsideFunction: true, locations: true })
  } catch {
    return [] // code that doesn't parse has its own error, at its own place
  }
  const declared = declaredNames(program)
  const registered = registeredNames(program)
  const known = (name: string): boolean => registered.has(name) || runtime.isMethod(name)

  const isPattern = (e: any): boolean => {
    if (e.type === 'Literal') return typeof e.value === 'string' && e.raw.startsWith('"')
    if (e.type === 'TemplateLiteral') return e.expressions.length === 0
    if (e.type === 'Identifier') return !declared.has(e.name) && runtime.isPatternValue(e.name)
    if (e.type !== 'CallExpression' || e.optional) return false
    if (e.callee.type === 'Identifier') return !declared.has(e.callee.name) && runtime.isPatternFunction(e.callee.name)
    const name = methodName(e.callee)
    return name !== null && known(name) && !NOT_PATTERN_RESULT.has(name) && isPattern(e.callee.object)
  }

  const written = (e: any): string => {
    if (e.type === 'Identifier') return e.name
    if (e.type === 'CallExpression') return `${written(e.callee)}(...)`
    if (e.type === 'MemberExpression') return `${written(e.object)}.${e.property.name}`
    return code.slice(e.start, e.end)
  }

  const missing: MissingMethod[] = []
  each(program, (n) => {
    if (n.type !== 'CallExpression' || n.optional) return
    const name = methodName(n.callee)
    if (name === null || known(name) || !isPattern(n.callee.object)) return
    const { line, column } = n.callee.property.loc.start
    missing.push({ name, receiver: written(n.callee.object), line, column: column + 1 })
  })
  // a chain is visited from its outer call in, so put them back in reading order
  return missing.sort((a, b) => a.line - b.line || a.column - b.column)
}

/**
 * Globals that build a pattern without being a pattern method too, so the
 * prototype alone doesn't say so. Measured on `@strudel/core` 1.2.6: `s`,
 * `note`, `stack`, `cat`, `seq`, `fast` are both; these are only globals.
 */
const PATTERN_BUILDERS = new Set(['mini', 'm', 'arrange', 'pure', 'run', 'irand', 'chooseCycles', 'randcat', 'wrandcat', 'polymeter', 'timecat', 'fastcat', 'slowcat', 'sequence'])

/** The runtime as it is now: its `Pattern` class and the scope the code runs in. */
export function patternRuntimeOf(
  Pattern: { prototype: object },
  scope: Record<string, unknown> = globalThis as Record<string, unknown>,
): PatternRuntime {
  return {
    isMethod: (name) => name in Pattern.prototype,
    isPatternValue: (name) => scope[name] instanceof (Pattern as unknown as new () => object),
    isPatternFunction: (name) =>
      typeof scope[name] === 'function' && (name in Pattern.prototype || PATTERN_BUILDERS.has(name)),
  }
}
