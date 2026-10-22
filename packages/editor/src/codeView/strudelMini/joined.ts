/**
 * One joined tree: what was written, paired with what it plays (#1973, part of #1869,
 * epic #1007).
 *
 * `./shape.ts` says what is written and where; `./pattern.ts` says what plays and which
 * bits of text each hit names. This file joins the two for one cycle, once, so a view
 * can ask a node "which hits are yours" and a hit "which note wrote you" without
 * matching spans itself.
 *
 * THE RULE, measured rather than assumed (1,625 corpus patterns, 52,498 hits, 2026-10-08):
 *   - a hit names one location per atom that shaped it: the written note, and the
 *     atoms of any op argument on the way (`*2`'s `2`, a euclid's numbers, `:3`'s `3`,
 *     a range's far end, a polymeter's `%4`);
 *   - the written note is NOT always first — `sd:2`, `0 .. 3` and `{a b c}%4` report
 *     the argument first (2,192 hits);
 *   - Strudel takes SPACES off a location and nothing else, so a token followed by a
 *     newline or a tab has a location one longer than its text (1,024 locations).
 * So a location is matched with whitespace taken off both ends, against each atom's
 * tight span, and a hit's note is the ONE matched atom that sits in a sequence rather
 * than in an argument. On the corpus every hit has exactly one; a hit that has none or
 * several is handed back saying which, never dropped and never guessed.
 *
 * ⚠ Like `./pattern.ts` this is on the evaluator's side: it takes a `MiniPattern`. The
 * engine's import graph must not reach it; a test keeps it out.
 */
import type { MiniHit, MiniPattern } from './pattern'
import { miniShape, type MiniArg, type MiniAtom, type MiniElement, type MiniGroup, type MiniSpan } from './shape'

/** why a hit has no note: it names no place at all, no written note, or more than one */
export type Unpaired = 'no-location' | 'no-written-atom' | 'several-written-atoms'

export interface JoinedHit {
  hit: MiniHit
  /** the written note this hit came from; null when it could not be settled — see `why` */
  atom: MiniAtom | null
  why: Unpaired | null
  /** the op-argument atoms that shaped the hit, in Strudel's order */
  args: MiniAtom[]
  /** locations that name no node of the shape — none on the corpus; kept so it shows */
  strays: MiniSpan[]
}

export type MiniNode = MiniAtom | MiniElement | MiniGroup

export interface JoinedCycle {
  /** the shape of the string, the same nodes `of` is asked about */
  root: MiniGroup
  /** every hit of the cycle, in Strudel's order */
  hits: JoinedHit[]
  /**
   * The hits a node produces in this cycle: an atom's own, or those of every note
   * written inside an element or a group (its op arguments are not "inside" it).
   * Empty for a rest, for a branch another cycle plays, and for a node of another tree.
   */
  of(node: MiniNode): JoinedHit[]
}

interface Places {
  root: MiniGroup
  /** tight span → the atom there, and whether it is a written note or an op argument */
  at: Map<string, { atom: MiniAtom; written: boolean }>
}

const key = (start: number, end: number): string => `${start}:${end}`

function placesOf(mini: string): Places {
  const root = miniShape(mini)
  const at: Places['at'] = new Map()
  const group = (g: MiniGroup, written: boolean): void => {
    arg(g.steps)
    for (const c of g.children) c.kind === 'element' ? element(c, written) : group(c, written)
  }
  const element = (e: MiniElement, written: boolean): void => {
    if (e.content.kind === 'atom') at.set(key(e.content.span.start, e.content.span.end), { atom: e.content, written })
    else group(e.content, written)
    for (const op of e.ops) for (const a of Object.values(op.args)) arg(a)
  }
  /** everything under an op argument or a step count shapes hits; it writes none */
  const arg = (a: MiniArg | undefined): void => {
    if (!a || typeof a !== 'object') return
    if (a.kind === 'atom') at.set(key(a.span.start, a.span.end), { atom: a, written: false })
    else if (a.kind === 'element') element(a, false)
    else group(a, false)
  }
  group(root, true)
  return { root, at }
}

/** one shape per evaluated pattern, built the first time it is joined */
const PLACES = new WeakMap<MiniPattern, Places>()

function tight(mini: string, span: MiniSpan): string {
  let s = span.start
  let e = span.end
  while (s < e && /\s/.test(mini[s])) s++
  while (e > s && /\s/.test(mini[e - 1])) e--
  return key(s, e)
}

function joinHit(hit: MiniHit, mini: string, places: Places): JoinedHit {
  const written: MiniAtom[] = []
  const args: MiniAtom[] = []
  const strays: MiniSpan[] = []
  for (const loc of hit.locations) {
    // most locations are a token's own span already; the trim is for the rest
    const found = places.at.get(key(loc.start, loc.end)) ?? places.at.get(tight(mini, loc))
    if (!found) strays.push(loc)
    else if (found.written) written.push(found.atom)
    else args.push(found.atom)
  }
  if (written.length === 1) return { hit, atom: written[0], why: null, args, strays }
  const why: Unpaired =
    hit.locations.length === 0 ? 'no-location' : written.length === 0 ? 'no-written-atom' : 'several-written-atoms'
  return { hit, atom: null, why, args, strays }
}

function notesIn(node: MiniNode, out: MiniAtom[]): MiniAtom[] {
  if (node.kind === 'atom') out.push(node)
  else if (node.kind === 'element') notesIn(node.content, out)
  else for (const c of node.children) notesIn(c, out)
  return out
}

/**
 * Cycle `cyc` of `pat`, joined: its shape, its hits, and which note each hit came from.
 *
 * THROWS what Strudel throws when the pattern cannot be queried, like `pat.hits`, and
 * what krill throws if the string does not parse — the caller decides what each means.
 */
export function joinedCycle(pat: MiniPattern, cyc: number): JoinedCycle {
  let places = PLACES.get(pat)
  if (!places) PLACES.set(pat, (places = placesOf(pat.mini)))
  const hits = pat.hits(cyc).map((h) => joinHit(h, pat.mini, places))
  // built on the first `of`: the view readers take `hits` and never ask a node
  let byAtom: Map<MiniAtom, JoinedHit[]> | null = null
  const index = (): Map<MiniAtom, JoinedHit[]> => {
    if (byAtom) return byAtom
    byAtom = new Map()
    for (const j of hits) {
      if (!j.atom) continue
      const list = byAtom.get(j.atom)
      if (list) list.push(j)
      else byAtom.set(j.atom, [j])
    }
    return byAtom
  }
  return {
    root: places.root,
    hits,
    of(node) {
      if (node.kind === 'atom') return index().get(node) ?? []
      const mine = new Set(notesIn(node, []))
      return hits.filter((j) => j.atom !== null && mine.has(j.atom))
    },
  }
}
