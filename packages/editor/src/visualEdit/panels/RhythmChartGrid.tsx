/**
 * RhythmChartGrid — the chord chart drawn on a rhythm line (#2120).
 *
 * Mounted for a cursor inside a `.struct("…")` rhythm line. A strip on top names the
 * chord sounding in each bar, as Logic's Chord track does, and each chord has a row lit
 * on the steps where the rhythm plays it. A step outside a chord's own time is greyed
 * on its row. Clicking a step turns it on or off in the rhythm line and nowhere else,
 * so the change shows in every bar that line plays. A hit a `.mask(…)` silences is
 * drawn hollow and is not clickable in that bar; the mask is edited in the code.
 *
 * What is drawn is asked of Strudel (`rhythmChart`); the write is the step grid's
 * (`toggleCell` on the line's own model). When there is no chart to draw (no chords
 * the line times, a line the step grid cannot read, a cycle past the grid's bars) this
 * is the plain step grid of the line, with the reason when there is one.
 */
import * as React from 'react'

import { stepGridCodec, opensStepGrid, rhythmChart, lookOnlyLine, sampleVoice, UNREFINED } from '../../codeView'
import { canToggleCell, isCellOn, toggleCell } from '../../codeView'
import type { StepGridModel } from '../../codeView'
import type { ResolutionControlProps } from './ResolutionControl'
import { useGridModel } from './useGridModel'
import { SequencerGrid } from './SequencerGrid'
import { PatternTrackChip } from './PatternTrackChip'
import { emitLog } from '../../engine/engineLog'
import { PHONE_STEP_MIN, usePhoneGrid } from './phoneGrid'

const parseChords = (mini: string) => stepGridCodec.parse(mini, UNREFINED)

export interface RhythmChartGridProps {
  onResolution?: (r: ResolutionControlProps | null) => void
}

export function RhythmChartGrid({ onResolution }: RhythmChartGridProps): React.ReactElement {
  const phone = usePhoneGrid().phone
  const { chunk, model, mutate } = useGridModel<StepGridModel>({
    ...stepGridCodec,
    source: 'seq',
    eligible: opensStepGrid,
  })
  const result = React.useMemo(
    () =>
      chunk?.structRhythm && chunk.miniString !== null
        ? rhythmChart(chunk.structOver?.miniString ?? null, chunk.miniString, model, parseChords, chunk.structOver?.masks)
        : ({ ok: false, reason: null } as const),
    [chunk, model],
  )

  // Can the line's step under each column be turned on or off? Asked of the writer, as
  // the step grid asks it for every cell it offers.
  const toggleable = React.useMemo(() => {
    if (!model || !result.ok || result.chart.lookOnly) return null
    return Array.from({ length: model.steps }, (_, m) => {
      const on = model.lanes.findIndex((l) => isCellOn(l.cells[m]))
      return on >= 0 ? canToggleCell(model, on, m, false) : canToggleCell(model, 0, m, true)
    })
  }, [model, result])

  // No Slots control here: the chart's columns are the line's own.
  const chartShown = result.ok
  React.useEffect(() => {
    if (chartShown) onResolution?.(null)
  }, [chartShown, onResolution])

  if (!result.ok) return <SequencerGrid onResolution={onResolution} notice={result.reason} />
  const chart = result.chart

  const toggle = (col: number): void => {
    let refused = false
    mutate((prev) => {
      const m = chart.rhythmCol(col)
      const on = prev.lanes.findIndex((l) => isCellOn(l.cells[m]))
      const next = on >= 0 ? toggleCell(prev, on, m, false) : toggleCell(prev, 0, m, true)
      refused = next === prev
      return next
    })
    if (refused) {
      emitLog({
        level: 'warn',
        runtime: 'stave',
        message: "Couldn't change that step — writing it would change the rhythm in ways you didn't ask for, so it was left unchanged.",
      })
    }
  }

  const cols = chart.bars * chart.colsPerBar
  // the strip's blocks, with a one-column spacer for every column no chord covers
  const stripCells: Array<{ value: string | null; start: number; end: number }> = []
  for (let c = 0, i = 0; c < cols; ) {
    const s = chart.strip[i]
    if (s && s.start === c) {
      stripCells.push(s)
      c = s.end
      i++
    } else {
      stripCells.push({ value: null, start: c, end: c + 1 })
      c++
    }
  }
  const barStart = (c: number): boolean => c > 0 && c % chart.colsPerBar === 0
  /** a step's narrowest width: finger-sized on a phone, as on the step grid */
  const stepMin = phone ? PHONE_STEP_MIN : 14
  const stepMax = Math.max(40, stepMin)
  /** one column's flex: equal widths, the 8px bar gap before a bar's first */
  const colStyle = (c: number): React.CSSProperties => ({
    flex: '1 1 0',
    minWidth: stepMin,
    maxWidth: stepMax,
    marginLeft: barStart(c) ? 8 : 0,
  })
  /** on a phone the row names stay put while the steps scroll under them */
  const pinned: React.CSSProperties = phone
    ? { position: 'sticky', left: 0, zIndex: 2, background: 'var(--background, #0f0f12)' }
    : {}
  const header: React.CSSProperties = {
    ...pinned,
    width: 72,
    flex: '0 0 auto',
    fontSize: 11,
    textAlign: 'right',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }
  const muted = 'var(--foreground-muted, #a0a0aa)'

  return (
    <div
      data-rhythm-chart
      data-look-only={chart.lookOnly ? 'true' : undefined}
      data-pattern-scroll
      style={{
        padding: 16,
        height: '100%',
        overflow: 'auto',
        boxSizing: 'border-box',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ marginBottom: 4 }}>
          <PatternTrackChip />
        </div>
        <div data-rhythm-chart-line style={{ fontSize: 11, color: muted, paddingBottom: 2 }}>
          {chart.lookOnly
            ? lookOnlyLine({ reason: chart.lookOnly })
            : 'This rhythm line plays the chords. A click turns a step on or off in this line, in every bar it plays.'}
          {chart.silenced.some((s) => s.length > 0) && ' Hollow steps are silenced by .mask(…) in that bar.'}
          {chart.maskUnread && ' This track’s .mask(…) isn’t drawn here: it isn’t written as a string.'}
        </div>
        {/* only the grid is as wide as its steps; the lines above wrap at the panel's width */}
        <div role="grid" aria-label="Chords on the rhythm" style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 'min-content' }}>
          {/* bar numbers */}
          <div aria-hidden="true" style={{ display: 'flex', gap: 8, height: 12 }}>
            <div style={{ width: 72, flex: '0 0 auto', ...pinned }} />
            <div style={{ display: 'flex', gap: 2, flex: 1 }}>
              {Array.from({ length: cols }, (_, c) => (
                <div key={c} style={{ ...colStyle(c), position: 'relative' }}>
                  {c % chart.colsPerBar === 0 && (
                    <span style={{ position: 'absolute', left: 0, bottom: 0, fontSize: 9, fontWeight: 600, lineHeight: '10px' }}>
                      {c / chart.colsPerBar + 1}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
          {/* the strip: which chord, when */}
          <div role="row" data-rhythm-chart-strip style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span role="rowheader" style={{ ...header, color: muted }}>
              Chords
            </span>
            <div style={{ display: 'flex', gap: 2, flex: 1 }}>
              {stripCells.map((s) => {
                const w = s.end - s.start
                return s.value === null ? (
                  // a column where the chords rest
                  <div key={s.start} style={colStyle(s.start)} />
                ) : (
                  <div
                    key={s.start}
                    role="gridcell"
                    data-rhythm-chord={s.value}
                    data-rhythm-chord-span={`${s.start}:${s.end}`}
                    style={{
                      // as wide as its columns and the gaps between them; a block never
                      // crosses a bar line, so the only bar gap is before it
                      flex: `${w} ${w} ${2 * (w - 1)}px`,
                      minWidth: stepMin * w + 2 * (w - 1),
                      maxWidth: stepMax * w + 2 * (w - 1),
                      marginLeft: barStart(s.start) ? 8 : 0,
                      height: 20,
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 6px',
                      boxSizing: 'border-box',
                      borderRadius: 3,
                      fontSize: 11,
                      fontWeight: 600,
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      color: 'var(--foreground, #e6e6ea)',
                      background: 'var(--background-elevated, #26262c)',
                      borderLeft: `3px solid ${sampleVoice(s.value).color}`,
                    }}
                    title={s.value}
                  >
                    {s.value}
                  </div>
                )
              })}
            </div>
          </div>
          {chart.rows.map((row, r) => {
            const color = sampleVoice(row).color
            return (
              <div key={row} role="row" data-rhythm-row={row} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span role="rowheader" data-seq-voice={row} style={{ ...header, color: 'var(--foreground, #e6e6ea)' }} title={row}>
                  {row}
                </span>
                <div role="none" style={{ display: 'flex', gap: 2, flex: 1 }}>
                  {Array.from({ length: cols }, (_, c) => {
                    const hit = chart.hits[c].includes(row)
                    const own = chart.sounding[c].includes(row)
                    // a hit a `.mask` silences here: the step plays in the bars it lets through
                    const hollow = chart.silenced[c].includes(row)
                    const canToggle = own && !hollow && (toggleable?.[chart.rhythmCol(c)] ?? false)
                    return (
                      <div key={c} role="gridcell" style={{ display: 'flex', ...colStyle(c) }}>
                        <button
                          type="button"
                          data-rhythm-cell={`${r}:${c}`}
                          data-rhythm-other={own ? undefined : 'true'}
                          data-rhythm-silenced={hollow ? 'true' : undefined}
                          aria-pressed={hit}
                          aria-disabled={canToggle ? undefined : true}
                          aria-label={`${row} bar ${Math.floor(c / chart.colsPerBar) + 1} step ${(c % chart.colsPerBar) + 1}${hollow ? ', silenced by .mask' : ''}`}
                          title={
                            !own
                              ? `${row} isn't playing here.`
                              : hollow
                                ? 'Silenced by .mask(…) in this bar. The step plays in the bars the mask lets through; change the mask in the code.'
                                : chart.lookOnly
                                ? lookOnlyLine({ reason: chart.lookOnly })
                                : undefined
                          }
                          onClick={() => {
                            if (canToggle) toggle(c)
                          }}
                          style={{
                            width: '100%',
                            height: 22,
                            padding: 0,
                            borderRadius: 3,
                            border: hollow ? `2px solid ${color}` : '1px solid var(--border, #3a3a42)',
                            background: hit && !hollow ? color : 'var(--background-elevated, #26262c)',
                            opacity: own ? 1 : 0.3,
                            cursor: canToggle ? 'pointer' : 'default',
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
