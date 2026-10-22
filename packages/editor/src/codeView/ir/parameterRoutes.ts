/**
 * Which parameters of a track play a time a lane can draw, and what that time is —
 * the walk both automation readers share (#1590).
 *
 * A control's value is chosen by the time its pattern is queried at. `.slow(2)`,
 * `.fast(2)` and `.late(1)` hand it a scaled or shifted time (#1595); an arm of
 * `arrange`, `cat` or `slowcat` hands it the time its SECTION has played (#1585).
 * Both are arithmetic, so the walk records them on the route and a lane applies
 * them. What the walk cannot follow declines the parameter: an opaque call that
 * might move time, two routes that play the parameter at once (`jux(x =>
 * x.fast(2))`), or a same-key call above it that replaces its value outright. A
 * stepped parameter and a continuous curve fail the same way under each, so the
 * rule lives here once, and `steppedAutomation.ts` and `signalAutomation.ts` decide
 * only what a VALUE is and which times they can draw.
 *
 * Pure and structural, over the IR: no eval, no source scanning.
 */
import type { PatternIR } from './PatternIR'
import { STRUDEL_VIZ_METHODS } from '../../engine/strudelVizMethods'

type ParamNode = PatternIR & { tag: 'Param' }

/** One arrangement section a parameter plays inside (#1585): an arm of `arrange`,
 *  `cat` or `slowcat`, as a span of one pass of that arrangement. */
export interface SectionWindow {
  /** The cycle, within one pass, at which the section begins — the weights before it. */
  readonly startCycle: number
  /** How many cycles the section lasts — its own weight. */
  readonly cycles: number
  /** How many cycles one pass of the arrangement spans — every weight, summed. */
  readonly total: number
}

/**
 * A whole-track time change a parameter sits under (#1595): the pattern below it is
 * handed `t · times / per + shift` when the pattern above is handed `t`.
 *
 * `@strudel/core@1.2.6` `pattern.mjs`: `fast(f)` queries its receiver at `t · f`
 * (`:1931`, and plays silence for 0), `slow(f)` is `fast(1 / f)` (`:1962`), and
 * `late(o)` is `early(−o)`, which queries at `t + (−o)` (`:2065`, `:2085`).
 */
export interface TimeWarp {
  readonly times: number
  readonly per: number
  readonly shift: number
}

/** One step of a route from a track to its parameter: a section, or a time warp. */
export type TimeStep = SectionWindow | TimeWarp

export function isSectionWindow(step: TimeStep): step is SectionWindow {
  return 'total' in step
}

/** A parameter every route to which the walk can follow, with where it plays. */
export interface PlayableParameter {
  /** The lane it belongs to — the root `Track`'s id. */
  readonly trackId: string
  readonly param: ParamNode
  /**
   * One entry per route to the parameter: the sections and time warps that route
   * passes through, OUTERMOST FIRST. A parameter under neither has one route
   * through none — `[[]]` — and sees the song's time as its own. A binding
   * arranged twice has two routes, one per appearance.
   */
  readonly placements: readonly (readonly TimeStep[])[]
}

/**
 * The nodes a parameter may sit under and be handed the time above them unchanged
 * (#1584). A time warp (`timeWarpOf`) and an arrangement (`sectionWindows`) change
 * it by arithmetic the route records; anything else — a node the parser left
 * opaque, say — declines the parameter, with one exception checked beside this
 * list: an opaque call to one of Strudel's visualisers (`leavesTheCycle`, #1592).
 *
 * Every entry is an arm in `steppedAutomation.engine.test.ts`, which checks the
 * reader's prediction against what the engine plays; every time-changing shape it
 * declines is an arm there too, showing the engine really plays something else.
 * `Track` is the root the walk starts from, and a control (`Param`) sets a value
 * without moving an event.
 *
 * ⚠ BY TAG, NOT BY METHOD, AND THAT WAS MEASURED. `parseStrudel` builds these tags
 * from a short, known set of calls: `Stack` from `stack`, `layer`, `jux` and `off`;
 * `When` from `mask`; `Degrade` from `degrade` and `degradeBy`; `Every` from
 * `every`; `Choice` from `sometimes` and `sometimesBy`; `Struct`, `Chop` and `Ply`
 * from the call of the same name. Only `off` moves time, and it builds its shift
 * as a `Late` inside the stack, where the walk sees it. A per-method list was
 * written first and break-tested: opening any tag to every method turned nothing
 * red, because no parsed document can reach a method the list left out. So a NEW
 * producer of one of these tags has to be measured before it is trusted here — a
 * call that moved time without putting a node in the tree would pass silently.
 *
 * ⚠ A METHOD THAT TAKES A FUNCTION (`every`, `sometimesBy`, `layer`, `jux`) IS SAFE
 * ONLY BECAUSE THE FUNCTION'S BODY IS IN THE TREE. `jux(x => x.fast(2))` reaches the
 * parameter a second time through a `Fast`, and the two routes play it at once, so
 * it declines (`routesAreDisjoint`). A function the parser cannot model is an
 * opaque `Code`, which declines too.
 */
const LEAVES_THE_CYCLE: ReadonlySet<string> = new Set([
  'Track',
  'Param',
  'Stack',
  'When',
  'Struct',
  'Degrade',
  'Chop',
  'Ply',
  'Every',
  'Choice',
])

/**
 * Whether a node leaves the cycle alone: a tag in `LEAVES_THE_CYCLE`, or an opaque
 * call to one of Strudel's visualisers (#1592).
 *
 * The parser has no node for `._pianoroll()`, `.scope()` and their kin, so each
 * arrives as a `Code` wrapper naming its method. Stave's engine installs every name
 * in `STRUDEL_VIZ_METHODS` itself, in both spellings, and each returns the pattern
 * it was called on (`StrudelEngine.ts`, the loop over that list) — a track ending in
 * `._pianoroll()` plays what it plays without it. `.viz(name)` is not one of them: it
 * chains to Strudel's own `.viz` when that is loaded, which nothing here can see.
 */
function leavesTheCycle(node: PatternIR): boolean {
  if (LEAVES_THE_CYCLE.has(node.tag)) return true
  if (node.tag !== 'Code' || !node.via || !('method' in node.via)) return false
  return Object.prototype.hasOwnProperty.call(STRUDEL_VIZ_METHODS, node.via.method.replace(/^_/, ''))
}

/**
 * The warp a `Fast`, `Slow` or `Late` node applies to its body, or null for any
 * other node — and for a factor of 0, which plays silence (#1595).
 *
 * The parser builds these three from a whole numeric literal only (`numericValue`,
 * #1480), so `.fast(8/7)` is an opaque call here, never `fast(8)`. A patterned
 * argument (`.slow("<2 4>")`) is opaque too.
 *
 * A fast by the inverse of a whole number is kept as a division (`fast(0.5)` is
 * `per: 2`), so a lane that floors the handed time is not left one float below a
 * cycle boundary.
 */
function timeWarpOf(node: PatternIR): TimeWarp | null {
  if (node.tag === 'Fast' && Number.isFinite(node.factor) && node.factor > 0) {
    const inverse = 1 / node.factor
    return Number.isInteger(inverse) ? { times: 1, per: inverse, shift: 0 } : { times: node.factor, per: 1, shift: 0 }
  }
  if (node.tag === 'Slow' && Number.isFinite(node.factor) && node.factor > 0) return { times: 1, per: node.factor, shift: 0 }
  if (node.tag === 'Late' && Number.isFinite(node.offset)) return { times: 1, per: 1, shift: 0 - node.offset }
  return null
}

const SKIP_KEYS: ReadonlySet<string> = new Set(['loc', 'keyLoc', 'callSiteRange'])

/** Every child IR node of `node`, found by reflection — the walk
 *  `signalAutomation.ts` uses, and its note says why reflection. */
function childNodes(node: PatternIR): PatternIR[] {
  const out: PatternIR[] = []
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 12) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (typeof (value as PatternIR).tag === 'string') {
      out.push(value as PatternIR)
      return
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SKIP_KEYS.has(key)) continue
      visit(child, depth + 1)
    }
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (SKIP_KEYS.has(key)) continue
    visit(value, 0)
  }
  return out
}

/**
 * Walk one track, recording for every `Param` it meets whether EVERY route to it
 * could be followed — no same-key call above it, and nothing above it that moves
 * time in a way the route cannot record — and the steps each route took.
 *
 * ⚠ EVERY ROUTE, NOT THE FIRST. A function-taking method puts one node in the tree
 * twice over: `jux(x => x.fast(2))` reaches the same `Param` once through the
 * plain channel and once through a `Fast`. Each route alone can be followed, and
 * the engine plays two different values in a cycle (engine test). So a node is
 * walked again whenever it is reached in a state it has not been walked in, and
 * `routesAreDisjoint` then asks whether the routes can play at once.
 *
 * ⚠ `overridden` IS THE LOAD-BEARING ARGUMENT. Strudel's controls SET a value, so
 * the last call in a chain wins: `.gain("<0.2 0.8>").gain(0.5)` plays 0.5 on every
 * event (measured). In the IR the later call is the OUTER node, so a parameter is
 * dead exactly when a same-key `Param` encloses it. That holds through structure
 * too — `stack(a.gain("<…>"), b).gain(0.5)` overrides the inner steps (measured,
 * engine test). Drawing them would show values nobody hears, and editing them would
 * change nothing, silently. Keys are canonical, so `.cutoff` over `.lpf` counts too.
 *
 * Every descendant of a Param inherits its key, not only its `body`. Only a
 * Param's VALUE could hold a Param the other way, and no document spells a
 * same-key control inside another control's argument — a distinction no input can
 * exercise is a branch no test can defend, so it is not drawn.
 */
function collect(
  node: PatternIR,
  overridden: ReadonlySet<string>,
  timeMoved: boolean,
  steps: readonly RouteStep[],
  found: Map<ParamNode, ParamRoutes>,
  seen: Map<PatternIR, Set<string>>,
  ids: Map<PatternIR, number>,
): void {
  if (!node || typeof node !== 'object') return
  // ⚠ THE ROUTE IS PART OF THE STATE (#1585). A binding arranged twice is ONE node
  // reached through two arms; walked once, its second appearance would never be
  // recorded and the lane would draw half the bars that play it.
  const route = routeKey(steps, ids)
  const state = `${timeMoved}|${[...overridden].sort().join(',')}|${route}`
  const states = seen.get(node) ?? new Set<string>()
  if (states.has(state)) return
  states.add(state)
  seen.set(node, states)

  let passDown = overridden
  if (node.tag === 'Param') {
    const entry = found.get(node) ?? { clean: true, routes: new Map<string, readonly RouteStep[]>() }
    entry.clean = entry.clean && !timeMoved && !overridden.has(node.key)
    entry.routes.set(route, steps)
    found.set(node, entry)
    passDown = new Set(overridden).add(node.key)
  }

  const visit = (child: PatternIR, childSteps: readonly RouteStep[], childTimeMoved: boolean): void => {
    // A nested Track declares its own lane; its parameters are not this one's.
    if (child.tag === 'Track') return
    collect(child, passDown, childTimeMoved, childSteps, found, seen, ids)
  }

  if (node.tag === 'Arrange') {
    // Each arm is a section, and what is inside it counts the section's own cycles
    // — which the route records. An arrangement that gives its arms no whole
    // cycles to count moves time like any other transform.
    const windows = sectionWindows(node)
    node.arms.forEach((arm, i) =>
      visit(
        arm.pattern,
        windows ? [...steps, { node, arm: i, step: windows[i] }] : steps,
        timeMoved || windows === null,
      ),
    )
    return
  }
  const warp = timeWarpOf(node)
  if (warp) {
    // A warp has one child, its receiver, and hands it the warped time (#1595).
    for (const child of childNodes(node)) visit(child, [...steps, { node, arm: -1, step: warp }], timeMoved)
    return
  }
  const childTimeMoved = timeMoved || !leavesTheCycle(node)
  for (const child of childNodes(node)) visit(child, steps, childTimeMoved)
}

/** One step a route takes: the node, which of its arms (−1 for a warp, which has
 *  one), and the time step that node applies. */
interface RouteStep {
  readonly node: PatternIR
  readonly arm: number
  readonly step: TimeStep
}

/** What the walk learned about one `Param`: whether every route to it could be
 *  followed, and the distinct step chains those routes took. */
interface ParamRoutes {
  clean: boolean
  readonly routes: Map<string, readonly RouteStep[]>
}

/** A route's identity — the nodes it passed through that change time, and the arm
 *  it took at each. Two routes through the same steps see the same time, so they
 *  are one placement. */
function routeKey(steps: readonly RouteStep[], ids: Map<PatternIR, number>): string {
  return steps
    .map((s) => {
      let id = ids.get(s.node)
      if (id === undefined) {
        id = ids.size
        ids.set(s.node, id)
      }
      return `${id}.${s.arm}`
    })
    .join('/')
}

/**
 * The window each arm of an arrangement opens, or null when the arrangement gives
 * its arms no whole cycles to count (#1585).
 *
 * `arrange` runs each section `fast(cycles)`, joins them with `stepcat` and slows
 * the join by the total (`@strudel/core@1.2.6` `pattern.mjs`, `arrange`), so at
 * song cycle `c` a section starting `start` cycles into a pass of `total` sees
 * `p·cycles + (q − start)`, with `p = floor(c / total)` and `q = c − p·total`.
 * `cat` and `slowcat` are the same with every weight 1: `slowcat` hands its i-th
 * pattern cycle `floor(c / n)`. Measured through the engine for each of the three,
 * a nested arrangement and one under `stack`.
 *
 * A fractional weight changes the value inside a cycle, a negative one silences its
 * neighbours too (`[-1, a], [3, b], [1, c]` plays only `c`), and weights summing to
 * 0 play nothing — each declines. A weight of 0 is skipped by the engine and moves
 * nothing else, so it needs no clause.
 */
function sectionWindows(node: PatternIR & { tag: 'Arrange' }): SectionWindow[] | null {
  const weights = node.arms.map((arm) => arm.weight)
  if (!weights.every((w) => Number.isInteger(w) && w >= 0)) return null
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total === 0) return null
  let at = 0
  return weights.map((cycles) => {
    const window = { startCycle: at, cycles, total }
    at += cycles
    return window
  })
}

/**
 * Whether no two routes to one parameter can play it at the same song time
 * (#1585).
 *
 * Two routes that part at DIFFERENT ARMS OF THE SAME ARRANGEMENT never overlap:
 * the arms of one pass are disjoint, and everything above the parting is shared.
 * Any other parting can play two values at once — a route that stays outside the
 * section another enters (`stack(a, arrange([1, a], [1, b]))` plays two gains in
 * a cycle, measured), two arrangements side by side under a `stack`, or one route
 * through a time warp the other skips (`jux(x => x.fast(2))`, `off`, #1595). Those
 * decline rather than being checked cycle by cycle: the conservative answer, and
 * the one whose failure is a missing lane rather than a wrong one.
 */
function routesAreDisjoint(routes: readonly (readonly RouteStep[])[]): boolean {
  const partAtAnArm = (a: readonly RouteStep[], b: readonly RouteStep[]): boolean => {
    for (let k = 0; k < Math.min(a.length, b.length); k++) {
      if (a[k].node !== b[k].node) return false
      if (a[k].arm !== b[k].arm) return true
    }
    return false
  }
  return routes.every((a, i) => routes.slice(i + 1).every((b) => partAtAnArm(a, b)))
}

/**
 * Every parameter of every track whose routes can all be followed and are
 * disjoint, with its placements, in the order the walk first met each one. A reader
 * then decides whether the parameter's VALUE is one it can draw, at the times its
 * placements hand it.
 */
export function playableParameters(ir: PatternIR | null | undefined): readonly PlayableParameter[] {
  if (!ir) return []
  const roots: readonly PatternIR[] = ir.tag === 'Stack' ? ir.tracks : [ir]
  const out: PlayableParameter[] = []
  for (const node of roots) {
    if (node?.tag !== 'Track') continue
    const trackId = node.trackId
    if (typeof trackId !== 'string' || trackId.length === 0) continue
    const found = new Map<ParamNode, ParamRoutes>()
    collect(node, new Set(), false, [], found, new Map(), new Map())
    for (const [param, { clean, routes }] of found) {
      if (!clean) continue
      const chains = [...routes.values()]
      if (!routesAreDisjoint(chains)) continue
      out.push({ trackId, param, placements: chains.map((chain) => chain.map((s) => s.step)) })
    }
  }
  return out
}

/**
 * The time a placement's parameter is handed at song time `time`, or null when one
 * of its sections is silent then (#1585, #1590, #1595) — each step in turn,
 * outermost first. A warp scales and shifts the time; a section applies
 * `arrange`'s own arithmetic (`sectionWindows` gives the formula and its
 * grounding) to the whole cycles and carries the fraction through unchanged, since
 * a section runs at the rate of whatever is above it.
 */
export function placementTimeAt(placement: readonly TimeStep[], time: number): number | null {
  let t = time
  for (const step of placement) {
    if (!isSectionWindow(step)) {
      t = (t * step.times) / step.per + step.shift
      continue
    }
    const { startCycle, cycles, total } = step
    const c = Math.floor(t)
    const pass = Math.floor(c / total)
    const q = c - pass * total
    if (q < startCycle || q >= startCycle + cycles) return null
    t = pass * cycles + (q - startCycle) + (t - c)
  }
  return t
}

/** The time a parameter is handed at song time `time` through whichever of its
 *  placements is playing then, or null when none is. Routes are disjoint, so at
 *  most one plays at a time. */
export function placementsTimeAt(placements: readonly (readonly TimeStep[])[], time: number): number | null {
  for (const placement of placements) {
    const own = placementTimeAt(placement, time)
    if (own !== null) return own
  }
  return null
}
