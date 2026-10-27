/**
 * laneLayout — the per-lane vertical layout for the canvas Song timeline
 * (expand + bind, #422 / canvas milestone #416, design §4.5).
 *
 * Before expand, every lane was a uniform `ROW_HEIGHT` row and three places
 * independently assumed that: the canvas draw (`drawTimeline` y-offsets), the
 * canvas host height, and the DOM lane labels. Click-to-expand makes a lane
 * taller (accordion) so its read-only note detail is legible — which means the
 * row height is no longer uniform. If each consumer recomputed y-offsets on its
 * own they would drift apart (PV116 — the shared transform must stay single-
 * sourced). So this module is the ONE place that turns `(lanes, expanded)` into
 * a `top`/`height` box per lane; the draw, the host height, the labels, AND the
 * hit-test all read the same `LaneLayout`.
 *
 * PURE — no React, no canvas, only the lane keys. Unit-tested directly.
 */

import { rowHeightForBandHeight } from './automationCaption'

/**
 * The shortest BAND an expanded lane may draw a stepped automation in (#1582).
 *
 * The band is where a level is drawn and where it is dragged, so its height IS
 * the resolution of the gesture: 19px of band makes one pixel worth 0.05 of
 * `gain`. A held modifier answers precision (`FINE_DRAG_RATIO`); this answers
 * the ordinary drag, by not letting a lane that is showing an automation be
 * shorter than the automation needs. 32px puts a plain drag at about 0.03 per
 * pixel, and the fine drag at 0.003.
 *
 * ⚠ ONLY WHERE A LANE DRAWS ONE AND IS EXPANDED. A collapsed row is a contour
 * view whose height belongs to the clip body, and a multi-voice expanded lane is
 * already taller than this floor by its voice count.
 */
export const AUTOMATION_MIN_DRAG_BAND_H = 32

/** The row height that leaves `AUTOMATION_MIN_DRAG_BAND_H` after the band's inset. */
export const AUTOMATION_MIN_ROW_H = rowHeightForBandHeight(AUTOMATION_MIN_DRAG_BAND_H)

/** Default per-voice sub-row height (px) when an expanded lane splits into voice
 *  sub-rows (#424). Each voice gets a fixed band (live-monitor parity — the lane
 *  grows with voice count rather than cramming a fixed height), as tall as a
 *  collapsed row so a busy drum track reads clearly. A single-voice/melodic
 *  expanded lane keeps the full `expandedHeight` single band instead. */
export const SUB_ROW_HEIGHT = 22

/** A lone MELODIC voice expands to a pitch band this many sub-rows tall (#647).
 *  A single melodic lane is a mini pianoroll — it needs vertical room for the
 *  pitch spread — so it stays taller than a single drum baseline. Expressed in
 *  sub-rows (not a fixed px) so it SCALES with the sub-row size setting like
 *  every multi-voice lane, instead of being pinned to a constant that ignored
 *  the setting. A lone percussive voice gets a single baseline row. */
export const MELODIC_SINGLE_VOICE_ROWS = 4

/** One voice sub-row inside an expanded multi-voice lane (#424). Absolute `top`
 *  in the SAME content space as `LaneBox.top`, so the draw, the gutter labels,
 *  and (future) hit-tests all read one geometry — no drift (PV120). */
export interface SubRowBox {
  /** Partition key (the sample name, or the `NO_VOICE` sentinel). */
  readonly voiceKey: string
  /** Gutter label for this voice. */
  readonly label: string
  /** True for a melodic voice (pitch-Y band); false for percussive (baseline). */
  readonly melodic: boolean
  /** Top edge (px from the layout top — absolute, like `LaneBox.top`). */
  readonly top: number
  /** Sub-row height (px). */
  readonly height: number
}

/** A minimal voice descriptor the layout needs (subset of `SceneVoice`). */
export interface LaneVoiceInput {
  readonly key: string
  readonly label: string
  readonly melodic: boolean
}

/** A lane the layout positions — its key plus (optionally) its voices, so an
 *  expanded lane with ≥2 voices can split into sub-rows. `SceneLane` satisfies
 *  this structurally. */
export interface LaneLayoutInput {
  readonly laneKey: string
  readonly voices?: readonly LaneVoiceInput[]
  /** The lane's stepped automations — only the COUNT is read, to decide whether
   *  this lane needs the automation floor (#1582). `SceneLane` satisfies it
   *  structurally, so the caller passes its lanes unchanged. */
  readonly stepped?: readonly unknown[]
}

/** One lane's vertical box in content space (CSS px, before DPR). */
export interface LaneBox {
  readonly laneKey: string
  /** Top edge (px from the canvas top). */
  readonly top: number
  /** Row height (px) — `expandedHeight` when expanded, else `rowHeight`. */
  readonly height: number
  /** True when this lane is accordion-expanded (drives the richer draw). */
  readonly expanded: boolean
  /** Per-voice sub-rows, present ONLY when this lane is expanded AND has ≥2
   *  voices (#424). Absent for collapsed lanes and single-voice/melodic expanded
   *  lanes (those draw one band). The boxes stack to fill
   *  `[top + headerHeight, top+height)`. */
  readonly subRows?: readonly SubRowBox[]
  /** #2226 — with `subRows`, the band above them that holds the track's header,
   *  so every voice gets a row and a label of its own (the first voice's name used
   *  to share the header's row and was cut off by the track name). One sub-row
   *  tall. Absent without `subRows`. */
  readonly headerHeight?: number
  /** #1744 — the sub-row height this expanded lane was laid out with (the
   *  Timeline sub-row setting). A single-band pitched lane sizes its bars from
   *  it, as a multi-voice lane's sub-rows do. Absent on collapsed lanes. */
  readonly subRowHeight?: number
}

/** The full vertical layout: one box per lane (in lane order) + the total. */
export interface LaneLayout {
  readonly boxes: readonly LaneBox[]
  /** Sum of all box heights — the canvas/grid content height. ≥ 0. */
  readonly totalHeight: number
}

/**
 * `height`, raised to the automation floor when this lane draws a stepped
 * automation (#1582).
 *
 * ⚠ SINGLE-BAND LANES ONLY, which is why this is called from those two branches
 * and not at the end. A multi-voice expanded lane's height is the sum of its
 * sub-rows, and the sub-rows are what fill it — raising the total there would
 * leave a strip below the last voice that nothing draws in, and every sub-row
 * hit-test would still answer for the old geometry.
 */
function withAutomationFloor(height: number, lane: LaneLayoutInput): number {
  return (lane.stepped?.length ?? 0) > 0 ? Math.max(height, AUTOMATION_MIN_ROW_H) : height
}

/**
 * Stack the lanes top-to-bottom, giving each its expanded or collapsed height.
 * Lane order is preserved (it must match `scene.lanes` and the DOM labels), so
 * the returned `boxes[i]` lines up with `lanes[i]`. Non-finite/negative heights
 * are floored to 0 so a bad input can't produce NaN geometry downstream.
 */
export function computeLaneLayout(
  lanes: readonly LaneLayoutInput[],
  expanded: ReadonlySet<string>,
  rowHeight: number,
  expandedHeight: number,
  subRowHeight: number = SUB_ROW_HEIGHT,
): LaneLayout {
  const base = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 0
  const big = Number.isFinite(expandedHeight) && expandedHeight > base ? expandedHeight : base
  const sub = Number.isFinite(subRowHeight) && subRowHeight > 0 ? subRowHeight : 0
  let top = 0
  const boxes: LaneBox[] = lanes.map((lane) => {
    const isExpanded = expanded.has(lane.laneKey)
    const voices = lane.voices ?? []
    // An expanded lane with ≥2 voices splits into per-voice sub-rows (#424)
    // under a header row of its own (#2226, a track stack: the track, then each
    // sound it plays); its height grows with the voice count.
    if (isExpanded && voices.length >= 2 && sub > 0) {
      const subRows: SubRowBox[] = voices.map((v, i) => ({
        voiceKey: v.key,
        label: v.label,
        melodic: v.melodic,
        top: top + sub + i * sub,
        height: sub,
      }))
      const height = (voices.length + 1) * sub
      const box: LaneBox = {
        laneKey: lane.laneKey,
        top,
        height,
        expanded: true,
        subRows,
        headerHeight: sub,
        subRowHeight: sub,
      }
      top += height
      return box
    }
    // A single-voice expanded lane stays ONE band (no per-voice sub-rows) but
    // its height now SCALES with the sub-row setting too (#647), instead of a
    // fixed `expandedHeight` constant that ignored it. Melodic → a tall pitch
    // band (MELODIC_SINGLE_VOICE_ROWS rows, for the pianoroll spread);
    // percussive → a single baseline row. So every expanded lane — 1 voice or
    // many — responds to the same density slider.
    if (isExpanded && voices.length === 1 && sub > 0) {
      const rows = voices[0].melodic ? MELODIC_SINGLE_VOICE_ROWS : 1
      const height = withAutomationFloor(rows * sub, lane)
      const box: LaneBox = { laneKey: lane.laneKey, top, height, expanded: true, subRowHeight: sub }
      top += height
      return box
    }
    // Collapsed lanes, and the degenerate no-voice / sub=0 expanded fallback,
    // use the plain row / `expandedHeight` band.
    const height = isExpanded ? withAutomationFloor(big, lane) : base
    const box: LaneBox = { laneKey: lane.laneKey, top, height, expanded: isExpanded }
    top += height
    return box
  })
  return { boxes, totalHeight: top }
}

/**
 * Which lane contains content-space `y` (px from the layout top), or null if
 * `y` is above the first box or below the last. Inclusive of the top edge,
 * exclusive of the bottom — adjacent boxes never both claim a pixel.
 */
export function laneAtY(layout: LaneLayout, y: number): string | null {
  if (!Number.isFinite(y) || y < 0) return null
  for (const box of layout.boxes) {
    if (y >= box.top && y < box.top + box.height) return box.laneKey
  }
  return null
}

/**
 * #1760 — the lanes any part of which shows in the grid's visible band
 * `[top, top + height)`, in lane order. A height of 0 (not measured yet) shows
 * nothing, so nothing is put first.
 */
export function lanesInView(layout: LaneLayout, top: number, height: number): string[] {
  if (!(height > 0)) return []
  const bottom = top + height
  return layout.boxes.filter((b) => b.height > 0 && b.top < bottom && b.top + b.height > top).map((b) => b.laneKey)
}
