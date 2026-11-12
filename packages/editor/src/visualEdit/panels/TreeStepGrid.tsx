/**
 * TreeStepGrid — the step grid for a pattern with no column model, drawn from its own
 * divisions, look-only (#1834, epic #1832).
 *
 * `treeGrid.ts` lays the pattern out at exact positions; this only renders it. Every box,
 * line, ruler label, hit and the playhead sits at its exact share of the bar: a position
 * `t` (cycles from the pattern's start) is `x(t)` pixels, one multiplication and the bar
 * gaps. Nothing here can be clicked to edit — there are no columns to write through — and
 * the line above the rows says so, as the column grid's look-only view does (#1975).
 *
 * The zoom is the step grid's (`useGridZoom`): 1× fits the bars to the panel and opens
 * nothing; zooming in widens every bar and opens a step once each step inside it is
 * `OPEN_PX` wide.
 */
import * as React from 'react'

import { lookOnlyLine, sampleVoice } from '../../codeView'
import { readCurrentCycle } from '../../workspace/currentCycle'
import { OPEN_PX } from './gridZoom'
import { GridZoomControl, useGridZoom } from './gridZoomControl'
import { PatternTrackChip } from './PatternTrackChip'
import { usePhoneGrid } from './phoneGrid'
import { drawTreeRow, treePlayhead, treeRuler, type TreeGrid } from './treeGrid'

/** the gap between bars, as the column grid draws it */
const BAR_GAP = 8
/** the row names' column: the label and the space the column grid's remove button takes */
const NAME_PX = 96
const ROW_PX = 22

/** a step's outline, lighter the deeper it sits — the column grid's `stepOutline` */
function outline(depth: number): string {
  if (depth <= 1) return '1px solid var(--border, #3a3a42)'
  if (depth === 2) return '1px solid color-mix(in srgb, var(--border, #3a3a42) 60%, transparent)'
  return '1px dashed color-mix(in srgb, var(--border, #3a3a42) 50%, transparent)'
}

/** a step line, lighter the deeper it sits */
function lineColor(depth: number): string {
  if (depth <= 1) return 'var(--foreground-muted, #6a6a90)'
  if (depth === 2) return 'color-mix(in srgb, var(--foreground-muted, #6a6a90) 55%, transparent)'
  return 'color-mix(in srgb, var(--foreground-muted, #6a6a90) 30%, transparent)'
}

export interface TreeStepGridProps {
  grid: Extract<TreeGrid, { ok: true }>
  /** why the column grid has no model: the parser's own sentence */
  reason: string
  /** a sentence shown over the grid, as the column grid shows it */
  notice?: string | null
}

export function TreeStepGrid({ grid, reason, notice = null }: TreeStepGridProps): React.ReactElement {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const phone = usePhoneGrid().phone
  const zoom = useGridZoom(scrollRef, !phone, true)
  const bars = grid.bars
  // 1× fits the bars to the panel; each zoom step widens them
  const fit = zoom.avail !== null ? Math.max(40, (zoom.avail - BAR_GAP * (bars - 1)) / bars) : 320
  const barPx = fit * zoom.level
  const openPx = zoom.level > 1 ? OPEN_PX : Infinity
  const x = (t: number): number => {
    const b = Math.min(bars - 1, Math.max(0, Math.floor(t)))
    return b * (barPx + BAR_GAP) + (t - b) * barPx
  }
  const trackPx = bars * barPx + (bars - 1) * BAR_GAP

  const drawings = React.useMemo(
    () => grid.rows.map((r) => (r.bars ? drawTreeRow(r.bars, barPx, openPx) : null)),
    [grid, barPx, openPx],
  )
  // the ruler counts the steps of the first row that has them
  const rulerRow = grid.rows.find((r) => r.bars)
  const ruler = React.useMemo(
    () => (rulerRow?.bars ? treeRuler(rulerRow.bars, barPx, openPx) : Array.from({ length: bars }, (_, b) => ({ at: b, label: String(b + 1) }))),
    [rulerRow, barPx, openPx, bars],
  )

  // THE PLAYHEAD at the exact position the transport plays, moved each frame without a render
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
  return (
    <div
      ref={scrollRef}
      data-bottom-panel-tab="sequencer"
      data-look-only="tree"
      data-tree-grid
      data-tree-bars={bars}
      data-pattern-scroll
      style={{
        padding: 16,
        height: '100%',
        overflow: 'auto',
        boxSizing: 'border-box',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      {/* paddingRight: the room the column grid keeps past its last column, so both fit the same width */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: NAME_PX + 8 + trackPx + 28, paddingRight: 28, minWidth: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 4, position: 'sticky', left: 0, width: zoom.avail !== null ? zoom.avail + NAME_PX + 8 : undefined }}>
          <PatternTrackChip />
          {!phone && <GridZoomControl zoom={zoom} />}
        </div>
        {notice && (
          <div data-seq-notice style={{ fontSize: 11, color: muted, paddingBottom: 2 }}>
            {notice}
          </div>
        )}
        <div data-seq-look-only style={{ fontSize: 11, color: muted, paddingBottom: 2, position: 'sticky', left: 0 }}>
          {lookOnlyLine({ reason })}
        </div>
        <div role="table" aria-label="Step sequencer, look only" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* the ruler: each bar's number, and each drawn step named by its place in the pattern */}
          <div data-seq-ruler aria-hidden="true" style={{ display: 'flex', gap: 8, height: 12 }}>
            <div style={{ width: NAME_PX, flex: '0 0 auto' }} />
            <div style={{ position: 'relative', width: trackPx, flex: '0 0 auto', height: '100%' }}>
              {ruler.map(({ at, label }) => {
                const isBar = !label.includes('.')
                return (
                  <span
                    key={label}
                    data-seq-ruler-label={label}
                    data-ruler-bar={isBar ? '' : undefined}
                    data-tree-at={at.toFixed(6)}
                    style={{
                      position: 'absolute',
                      left: x(at),
                      bottom: 0,
                      fontSize: 9,
                      lineHeight: '10px',
                      whiteSpace: 'nowrap',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: isBar ? 600 : 400,
                      color: isBar ? 'var(--foreground, #e6e6ea)' : muted,
                    }}
                  >
                    {label}
                  </span>
                )
              })}
            </div>
          </div>
          {grid.rows.map((row, ri) => {
            const voice = sampleVoice(row.sound)
            const d = drawings[ri]
            return (
              <div key={`${row.sound}:${row.part}`} role="row" data-tree-row={row.sound} data-tree-part={row.part} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  role="rowheader"
                  data-seq-voice={row.sound}
                  title={row.sound}
                  style={{ width: NAME_PX - 24, marginRight: 24, flex: '0 0 auto', textAlign: 'right', fontSize: 11, color: 'var(--foreground, #e6e6ea)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {voice.label}
                </span>
                <div
                  role="cell"
                  aria-label={`${row.sound}: ${row.hits.length} ${row.hits.length === 1 ? 'hit' : 'hits'}, look only`}
                  data-tree-why={row.why ?? undefined}
                  title={lookOnlyLine({ reason })}
                  style={{ position: 'relative', width: trackPx, height: ROW_PX, flex: '0 0 auto' }}
                >
                  {/* each step that is not open: one box, at its exact share of the bar */}
                  {d?.steps.map((s) => (
                    <div
                      key={`s${s.begin}`}
                      data-tree-step={s.depth}
                      data-tree-begin={s.begin.toFixed(6)}
                      data-tree-end={s.end.toFixed(6)}
                      style={{
                        position: 'absolute',
                        left: x(s.begin) + 1,
                        width: Math.max(1, x(s.end) - x(s.begin) - 2),
                        top: 0,
                        bottom: 0,
                        boxSizing: 'border-box',
                        border: outline(s.depth),
                        borderRadius: 3,
                        background: 'var(--background, #1e1e24)',
                      }}
                    />
                  ))}
                  {/* inside a closed step, the steps it holds as small boxes */}
                  {d?.inner.map((s) => (
                    <div
                      key={`i${s.begin}`}
                      data-tree-inner={s.depth}
                      style={{
                        position: 'absolute',
                        left: x(s.begin) + 2,
                        width: Math.max(1, x(s.end) - x(s.begin) - 3),
                        top: 4,
                        bottom: 4,
                        boxSizing: 'border-box',
                        border: '1px solid var(--border, #3a3a42)',
                        borderRadius: 2,
                        background: 'var(--background-elevated, #26262c)',
                      }}
                    />
                  ))}
                  {/* where a step begins: a line, lighter the deeper the step */}
                  {d?.lines.map((l) => (
                    <div
                      key={`l${l.at}`}
                      data-tree-line={l.depth}
                      style={{ position: 'absolute', left: x(l.at) - 1, width: 2, top: 0, bottom: 0, background: lineColor(l.depth), pointerEvents: 'none' }}
                    />
                  ))}
                  {/* what the row plays, at its exact time and length */}
                  {row.hits.map((h, i) => (
                    <div
                      key={`h${i}`}
                      data-tree-hit={h.begin.toFixed(6)}
                      style={{
                        position: 'absolute',
                        left: x(h.begin) + 2,
                        width: Math.max(2, x(Math.min(h.end, bars)) - x(h.begin) - 3),
                        top: 5,
                        bottom: 5,
                        borderRadius: 2,
                        background: voice.color,
                        pointerEvents: 'none',
                      }}
                    />
                  ))}
                </div>
              </div>
            )
          })}
          {/* the playhead over every row, at the exact position playing */}
          <div style={{ position: 'relative', height: 0, marginLeft: NAME_PX + 8 }}>
            <div
              ref={headRef}
              aria-hidden="true"
              data-tree-playhead-line
              style={{
                display: 'none',
                position: 'absolute',
                left: 0,
                bottom: 0,
                width: 2,
                height: grid.rows.length * (ROW_PX + 4) + 16,
                background: 'var(--foreground, #e6e6ea)',
                opacity: 0.6,
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
