import { barBeatTick, cpsToBpm, type DisplayMeter } from "../lib/meter";

/**
 * What the transport reads, as text (#857, #1725) — the position, the pass and the
 * tempo, in cycles or in bars.
 *
 * One place for it because two things draw it: the desktop's LCD in the menu bar and
 * the line under the file name in the phone's top bar (#2001). They must never
 * disagree about where the song is.
 */

const DASH = "—";

/** `042.3` — three integer digits, one fractional. */
function fmtCycle(c: number): string {
  const [a, b] = c.toFixed(1).split(".");
  return `${a.padStart(3, "0")}.${b}`;
}

/** `011.3.1` — bar·beat·tick, counted in the app's display meter (#1565/#1568). */
function fmtBar(c: number, meter: DisplayMeter): string {
  const { bar, beat, tick } = barBeatTick(c, meter);
  return `${String(bar).padStart(3, "0")}.${beat}.${tick}`;
}

export interface TransportReadout {
  /** `CYC` or `BAR` */
  readonly positionLabel: string;
  /** the position, or dashes when stopped */
  readonly position: string;
  /** which time through the song, or a dash when there is no drawn loop to count */
  readonly pass: string;
  /** the tempo, or dashes when there is none */
  readonly tempo: string;
  /** `CPS` or `BPM` */
  readonly tempoLabel: string;
}

/**
 * @param pos the position as the playhead is drawn (`positionAsDrawn`), or null when stopped
 * @param cps the tempo the scheduler is running at, or null
 */
export function transportReadout(
  pos: { cycle: number; pass: number | null } | null,
  cps: number | null,
  cycleMode: boolean,
  meter: DisplayMeter,
): TransportReadout {
  return {
    positionLabel: cycleMode ? "CYC" : "BAR",
    position: pos === null ? `${DASH} ${DASH}` : cycleMode ? fmtCycle(pos.cycle) : fmtBar(pos.cycle, meter),
    pass: pos?.pass == null ? DASH : String(pos.pass),
    tempo:
      cps === null
        ? `${DASH}${DASH}`
        : cycleMode
          ? cps.toFixed(2)
          : // `cpsToBpm` is null only for a non-finite tempo, which the dash already
            // describes better than `NaN` did.
            (cpsToBpm(cps, meter)?.toString() ?? `${DASH}${DASH}`),
    tempoLabel: cycleMode ? "CPS" : "BPM",
  };
}
