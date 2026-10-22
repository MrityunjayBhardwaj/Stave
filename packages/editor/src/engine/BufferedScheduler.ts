import type { HapEvent } from './HapStream'
import type { HapStream } from './HapStream'
import type { IREvent } from '../codeView'
import type { IRPattern } from '../codeView'

/**
 * Engine-agnostic IRPattern built from a live HapStream.
 *
 * Accumulates HapEvents into a rolling buffer of IREvent[].
 * Any engine that provides streaming (HapStream) automatically gets
 * a synchronous queryable — no engine-specific code needed.
 */
export class BufferedScheduler implements IRPattern {
  private buffer: IREvent[] = []
  private head = 0 // index pointer for O(1) eviction (no shift)
  private audioCtx: AudioContext
  private maxAge: number
  private hapStream: HapStream
  private handler: (event: HapEvent) => void
  /** Last event per instrument — for same-instrument overlap clipping */
  private lastByInstrument = new Map<string, IREvent>()

  constructor(hapStream: HapStream, audioCtx: AudioContext, maxAge = 10) {
    this.hapStream = hapStream
    this.audioCtx = audioCtx
    this.maxAge = maxAge

    this.handler = (event: HapEvent) => {
      const begin = event.audioTime
      const end = event.audioTime + event.audioDuration
      const instrument = event.s ?? '_default'

      // Clip previous event of the SAME instrument — prevents overlap.
      // Only same-instrument clipping: drums and bass events are independent.
      const prev = this.lastByInstrument.get(instrument)
      if (prev && prev.end > begin) {
        prev.end = begin
        prev.endClipped = begin
      }

      const irEvent: IREvent = {
        begin,
        end,
        endClipped: end,
        note: event.midiNote,
        freq: typeof event.midiNote === 'number'
          ? 440 * Math.pow(2, (event.midiNote - 69) / 12)
          : null,
        s: event.s,
        gain: Math.min(1, Math.max(0, (event as any).gain ?? 1)),
        velocity: Math.min(1, Math.max(0, (event as any).velocity ?? 1)),
        color: event.color,
        loc: event.loc ?? undefined,
      }

      this.buffer.push(irEvent)
      this.lastByInstrument.set(instrument, irEvent)

      // Evict old events — O(1) via index pointer, no array.shift()
      const cutoff = this.audioCtx.currentTime - this.maxAge
      while (this.head < this.buffer.length && this.buffer[this.head].end < cutoff) {
        // Clear from lastByInstrument if this was the tracked event
        const old = this.buffer[this.head]
        const key = old.s ?? '_default'
        if (this.lastByInstrument.get(key) === old) {
          this.lastByInstrument.delete(key)
        }
        this.head++
      }

      // Compact when head is more than half the buffer — prevents unbounded growth
      if (this.head > this.buffer.length / 2 && this.head > 100) {
        this.buffer = this.buffer.slice(this.head)
        this.head = 0
      }
    }

    hapStream.on(this.handler)
  }

  now(): number {
    return this.audioCtx.currentTime
  }

  query(begin: number, end: number): IREvent[] {
    const result: IREvent[] = []
    for (let i = this.head; i < this.buffer.length; i++) {
      const h = this.buffer[i]
      if (h.begin < end && h.end > begin) result.push(h)
    }
    return result
  }

  clear(): void {
    this.buffer.length = 0
    this.head = 0
    this.lastByInstrument.clear()
  }

  dispose(): void {
    this.hapStream.off(this.handler)
    this.buffer.length = 0
    this.head = 0
    this.lastByInstrument.clear()
  }
}
