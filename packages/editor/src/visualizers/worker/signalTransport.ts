/**
 * SignalTransport — how a `SignalFrame` crosses main → worker each frame
 * (Phase B / B-2). Two interchangeable implementations behind one interface so
 * B-3 can render against the de-risked transport and B-4 can swap in SAB as the
 * measured optimization without touching the renderer:
 *
 *   - postMessage-transferable (THIS file) — the de-risked default + the required
 *     fallback for non-isolated browsers (Safari). Zero-copy for the analyser
 *     bytes via `transfer`; the small JSON envelope is structured-cloned.
 *   - SAB (B-2b) — zero-copy ring + double-buffer, gated on `crossOriginIsolated`.
 *
 * Structural over the channel (no `lib.dom` `Worker`/`Transferable` dependency —
 * the bus stays DOM-free, P12): a `FrameChannel` is anything with
 * postMessage/addEventListener, i.e. a `Worker` on main or `self`/`MessagePort`
 * in the worker.
 */

import { frameTransferables, type SignalFrame } from './signalFrame'

/** Envelope tag so signal frames are distinguishable from B-3 control messages
 *  sharing the same channel. */
const SIGNAL_FRAME_TAG = '__staveSignalFrame'

interface FrameEnvelope {
  [SIGNAL_FRAME_TAG]: true
  frame: SignalFrame
}

/** A signal frame's envelope (as opposed to a control message on the same channel). */
export function isSignalFrameEnvelope(data: unknown): boolean {
  return isFrameEnvelope(data)
}

function isFrameEnvelope(data: unknown): data is FrameEnvelope {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>)[SIGNAL_FRAME_TAG] === true
  )
}

/** The minimal channel surface a postMessage transport needs (structural — a
 *  `Worker` on main, `self`/`MessagePort` on the worker). */
export interface FrameChannel {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void
  addEventListener(
    type: 'message',
    handler: (ev: { data: unknown }) => void,
  ): void
  removeEventListener(
    type: 'message',
    handler: (ev: { data: unknown }) => void,
  ): void
}

/** MAIN side — ships frames into the worker. */
export interface SignalTransportWriter {
  /** Send one frame. The analyser byte buffers are TRANSFERRED (zero-copy), so
   *  the frame is unusable on the sender afterwards (the sampler mints fresh
   *  arrays each frame — safe). */
  writeFrame(frame: SignalFrame): void
  dispose(): void
}

/** WORKER side — delivers frames to a consumer (e.g. `WorkerBusFeed.applyFrame`). */
export interface SignalTransportReader {
  /** Register the per-frame consumer. Replaces any previous one. */
  onFrame(cb: (frame: SignalFrame) => void): void
  dispose(): void
}

/** Build the MAIN-side writer over a channel (the `Worker`). */
export function createPostMessageWriter(
  channel: Pick<FrameChannel, 'postMessage'>,
): SignalTransportWriter {
  let disposed = false
  return {
    writeFrame(frame) {
      if (disposed) return
      const envelope: FrameEnvelope = { [SIGNAL_FRAME_TAG]: true, frame }
      channel.postMessage(envelope, frameTransferables(frame))
    },
    dispose() {
      disposed = true
    },
  }
}

/** Build the WORKER-side reader over a channel (`self`/`MessagePort`). Ignores
 *  non-frame messages (B-3 control messages share the channel). */
export function createPostMessageReader(
  channel: Pick<FrameChannel, 'addEventListener' | 'removeEventListener'>,
): SignalTransportReader {
  let consumer: ((frame: SignalFrame) => void) | null = null
  const handler = (ev: { data: unknown }): void => {
    if (consumer && isFrameEnvelope(ev.data)) consumer(ev.data.frame)
  }
  channel.addEventListener('message', handler)
  return {
    onFrame(cb) {
      consumer = cb
    },
    dispose() {
      consumer = null
      channel.removeEventListener('message', handler)
    },
  }
}
