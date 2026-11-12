/**
 * TreeRollGrid — the piano roll for a melody with no roll model, drawn from its own
 * divisions, look-only (#1834, epic #1832).
 *
 * `rollTree.ts` lays the melody out; this only renders it, the way `TreeStepGrid` renders
 * the step grid's tree: every note at its exact time and length on its pitch row, the lines
 * of one part's steps (lighter with depth), the ruler naming steps by place, the playhead
 * at the exact position playing. The other parts' notes are dimmed, as the editable roll
 * dims them. Nothing here can be clicked to edit, and the line above says so.
 */
import * as React from 'react'

import { cLabel, isBlackKey, lookOnlyLine, noteDisplayName } from '../../codeView'
import { readCurrentCycle } from '../../workspace/currentCycle'
import { OPEN_PX } from './gridZoom'
import { GridZoomControl, useGridZoom } from './gridZoomControl'
import { PatternTrackChip } from './PatternTrackChip'
import { usePhoneGrid } from './phoneGrid'
import type { TreeRoll } from './rollTree'
import { drawTreeRow, treePlayhead, treeRuler } from './treeGrid'

const BAR_GAP = 8
const ROW_PX = 16
/** the key column and its gap; the zoom's measure assumes the step grid's row names (104) */
const KEY_PX = 98

function lineColor(depth: number): string {
  if (depth <= 1) return 'var(--foreground-muted, #6a6a90)'
  if (depth === 2) return 'color-mix(in srgb, var(--foreground-muted, #6a6a90) 55%, transparent)'
  return 'color-mix(in srgb, var(--foreground-muted, #6a6a90) 30%, transparent)'
}

export interface TreeRollGridProps {
  roll: TreeRoll
  /** why the roll has no model: the parser's own sentence */
  reason: string
}

export function TreeRollGrid({ roll, reason }: TreeRollGridProps): React.ReactElement {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const phone = usePhoneGrid().phone
  const zoom = useGridZoom(scrollRef, !phone, true)
  const { bars } = roll
  const fit = zoom.avail !== null ? Math.max(40, (zoom.avail - BAR_GAP * (bars - 1)) / bars) : 320
  const barPx = fit * zoom.level
  const openPx = zoom.level > 1 ? OPEN_PX : Infinity
  const x = (t: number): number => {
    const b = Math.min(bars - 1, Math.max(0, Math.floor(t)))
    return b * (barPx + BAR_GAP) + (t - b) * barPx
  }
  const trackPx = bars * barPx + (bars - 1) * BAR_GAP

  // the rows: every pitch from the lowest note to the highest, the highest on top
  const rows = React.useMemo(() => {
    const ms = roll.notes.map((n) => n.midi)
    const lo = Math.min(...ms)
    const hi = Math.max(...ms)
    return Array.from({ length: hi - lo + 1 }, (_, i) => hi - i)
  }, [roll])
  const rowOf = (midi: number): number => rows[0] - midi

  const drawing = React.useMemo(() => (roll.lines ? drawTreeRow(roll.lines, barPx, openPx) : null), [roll, barPx, openPx])
  const ruler = React.useMemo(
    () => (roll.lines ? treeRuler(roll.lines, barPx, openPx) : Array.from({ length: bars }, (_, b) => ({ at: b, label: String(b + 1) }))),
    [roll, barPx, openPx, bars],
  )

  const headRef = React.useRef<HTMLDivElement>(null)
  const xRef = React.useRef(x)
  xRef.current = x
  React.useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const el = headRef.current
      if (el) {
        const t = treePlayhead(readCurrentCycle(), bars)
        if (t === null) el.style.display = 'none'
        else {
          el.style.display = 'block'
          el.style.transform = `translateX(${xRef.current(t)}px)`
          el.dataset.treePlayhead = t.toFixed(4)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [bars])

  const muted = 'var(--foreground-muted, #a0a0aa)'
  const height = rows.length * (ROW_PX + 1)
  return (
    <div
      ref={scrollRef}
      data-bottom-panel-tab="piano-roll"
      data-look-only="tree"
      data-tree-roll
      data-tree-bars={bars}
      data-roll-lines-part={roll.linesPart}
      data-pattern-scroll
      style={{ padding: 16, height: '100%', overflow: 'auto', boxSizing: 'border-box', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: KEY_PX + 6 + trackPx + 28, paddingRight: 28, minWidth: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 4, position: 'sticky', left: 0, width: zoom.avail !== null ? zoom.avail + KEY_PX + 6 : undefined }}>
          <PatternTrackChip />
          {!phone && <GridZoomControl zoom={zoom} />}
        </div>
        <div data-roll-look-only style={{ fontSize: 11, color: muted, paddingBottom: 2, position: 'sticky', left: 0 }}>
          {lookOnlyLine({ reason })}
        </div>
        {/* the ruler: each bar's number, and the edited part's steps named by place */}
        <div data-roll-ruler aria-hidden="true" style={{ display: 'flex', gap: 6, height: 12 }}>
          <div style={{ width: KEY_PX, flex: '0 0 auto' }} />
          <div style={{ position: 'relative', width: trackPx, flex: '0 0 auto', height: '100%' }}>
            {ruler.map(({ at, label }) => {
              const isBar = !label.includes('.')
              return (
                <span
                  key={label}
                  data-roll-ruler-label={label}
                  data-ruler-bar={isBar ? '' : undefined}
                  data-tree-at={at.toFixed(6)}
                  style={{ position: 'absolute', left: x(at), bottom: 0, fontSize: 9, lineHeight: '10px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: isBar ? 600 : 400, color: isBar ? 'var(--foreground, #e6e6ea)' : muted }}
                >
                  {label}
                </span>
              )
            })}
          </div>
        </div>
        <div role="table" aria-label="Piano roll, look only" style={{ display: 'flex', gap: 6 }}>
          {/* the keys */}
          <div style={{ width: KEY_PX, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {rows.map((midi) => (
              <div
                key={midi}
                role="rowheader"
                data-roll-key={midi}
                style={{
                  height: ROW_PX,
                  fontSize: 9,
                  lineHeight: `${ROW_PX}px`,
                  textAlign: 'right',
                  paddingRight: 4,
                  color: muted,
                  background: !roll.numeric && isBlackKey(midi) ? 'var(--background, #1a1a20)' : 'var(--background-elevated, #26262c)',
                  borderRadius: 2,
                }}
              >
                {roll.numeric ? midi : cLabel(midi) ?? noteDisplayName(midi)}
              </div>
            ))}
          </div>
          {/* the notes, on their rows, over the edited part's lines */}
          <div role="cell" title={lookOnlyLine({ reason })} style={{ position: 'relative', width: trackPx, height, flex: '0 0 auto' }}>
            {rows.map((midi, i) => (
              <div
                key={midi}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: i * (ROW_PX + 1),
                  height: ROW_PX,
                  background: !roll.numeric && isBlackKey(midi) ? 'var(--background, #1a1a20)' : 'var(--background-elevated, #222228)',
                }}
              />
            ))}
            {Array.from({ length: bars - 1 }, (_, b) => (
              <div key={`gap${b}`} style={{ position: 'absolute', left: x(b + 1) - BAR_GAP, width: BAR_GAP, top: 0, bottom: 0, background: 'var(--background, #0f0f12)' }} />
            ))}
            {drawing?.lines.map((l) => (
              <div
                key={`l${l.at}`}
                data-tree-line={l.depth}
                style={{ position: 'absolute', left: x(l.at) - 1, width: 2, top: 0, bottom: 0, background: lineColor(l.depth), pointerEvents: 'none' }}
              />
            ))}
            {roll.notes.map((n, i) => {
              const dim = roll.parts > 1 && n.part !== roll.linesPart
              const w = Math.max(3, x(n.end) - x(n.begin) - 1)
              return (
                <div
                  key={i}
                  data-tree-note={n.midi}
                  data-tree-begin={n.begin.toFixed(6)}
                  data-tree-end={n.end.toFixed(6)}
                  data-roll-dim={dim ? '' : undefined}
                  title={roll.numeric ? String(n.midi) : noteDisplayName(n.midi)}
                  style={{
                    position: 'absolute',
                    left: x(n.begin) + 1,
                    width: w,
                    top: rowOf(n.midi) * (ROW_PX + 1) + 1,
                    height: ROW_PX - 2,
                    boxSizing: 'border-box',
                    borderRadius: 3,
                    background: 'var(--accent, #7c6cf0)',
                    opacity: dim ? 0.35 : 1,
                    fontSize: 9,
                    lineHeight: `${ROW_PX - 2}px`,
                    paddingLeft: 3,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    color: 'var(--background, #1c1c22)',
                    pointerEvents: 'none',
                  }}
                >
                  {w > 24 ? (roll.numeric ? String(n.midi) : noteDisplayName(n.midi)) : null}
                </div>
              )
            })}
            <div
              ref={headRef}
              aria-hidden="true"
              data-tree-playhead-line
              style={{ display: 'none', position: 'absolute', left: -1, top: 0, bottom: 0, width: 2, background: 'var(--foreground, #e6e6ea)', opacity: 0.6, pointerEvents: 'none' }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
