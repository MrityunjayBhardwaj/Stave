# struCode — Architecture & Design Specification

> A professional-grade open-source editor for Strudel.js with full visual feedback,
> built as a React component library + standalone web app.
> Status: **Future project — not yet started.**

---

## 1. What It Is

struCode is the editor that strudel.cc should have had. It replaces the strudel-editor
web component with a Monaco-based editor that has:

- Active note/character highlighting synchronized to the audio scheduler
- Inline pianoroll embedded between code lines (Monaco view zones)
- Full-panel pianoroll, oscilloscope, spectrum, spiral, pitchwheel
- Direct integration with @strudel/core + @strudel/webaudio (no iframe boundary)
- Strudel-aware Monaco language features (autocomplete, hover docs, error squiggles)
- **First-class track export**: live capture, offline fast-render (OfflineAudioContext),
  and parallel multi-stem export — all built into the engine with upload hooks for CDN integration
- Publishable as a React component library

The target user is anyone writing Strudel patterns — from beginners to advanced livecode
performers. The target integrator is any app that wants to embed a Strudel editor (Composr,
strudel.cc itself, educational platforms, etc.).

struCode has no knowledge of any specific application, CDN, or upload mechanism.
It exposes clean engine primitives and upload hooks — integrators wire them up.

---

## 2. Repo Structure

```
struCode/
├── packages/
│   ├── editor/                  # The React component library (npm: @strucode/editor)
│   │   ├── src/
│   │   │   ├── StrudelEditor.tsx       # Root export component
│   │   │   ├── engine/
│   │   │   │   ├── StrudelEngine.ts    # Wraps @strudel/core + @strudel/webaudio
│   │   │   │   ├── Scheduler.ts        # Wraps @strudel/webaudio scheduler
│   │   │   │   ├── HapStream.ts        # Event bus: emits Hap objects as they're scheduled
│   │   │   │   ├── renderPatternOffline.ts  # Real superdough graph into an OfflineAudioContext
│   │   │   │   ├── LiveRecorder.ts     # ScriptProcessorNode live capture → WAV Blob
│   │   │   │   ├── WavEncoder.ts       # AudioBuffer → WAV Blob (pure TS, no deps)
│   │   │   │   └── noteToMidi.ts       # Note name → MIDI conversion
│   │   │   ├── monaco/
│   │   │   │   ├── language.ts         # Strudel Monaco language definition (tokens, syntax)
│   │   │   │   ├── completions.ts      # Autocomplete: note names, functions, mini-notation
│   │   │   │   ├── hover.ts            # Hover docs for Strudel functions
│   │   │   │   ├── highlight.ts        # Active note highlight via deltaDecorations
│   │   │   │   └── viewzones.ts        # Inline pianoroll via Monaco view zones
│   │   │   ├── visualizers/
│   │   │   │   ├── Pianoroll.tsx       # Full-panel rolling pianoroll canvas
│   │   │   │   ├── InlinePianoroll.tsx # Compact pianoroll for Monaco view zone
│   │   │   │   ├── Scope.tsx           # Oscilloscope (time-domain AnalyserNode)
│   │   │   │   ├── Spectrum.tsx        # Spectrum analyzer (freq-domain AnalyserNode)
│   │   │   │   ├── Spiral.tsx          # Spiral visualization
│   │   │   │   ├── Pitchwheel.tsx      # Pitchwheel (notes within one octave)
│   │   │   │   └── useAnimationFrame.ts
│   │   │   ├── toolbar/
│   │   │   │   ├── Toolbar.tsx         # Play/stop/mute, BPM display, error badge
│   │   │   │   └── VizPicker.tsx       # Visualizer selector
│   │   │   ├── theme/
│   │   │   │   ├── tokens.ts           # Design tokens (colors, radii, fonts)
│   │   │   │   └── monacoTheme.ts      # Monaco theme definition
│   │   │   └── index.ts                # Public API exports
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── app/                     # Standalone demo web app (Next.js 15)
│       ├── src/
│       │   ├── app/
│       │   │   ├── page.tsx            # Landing / editor demo
│       │   │   ├── docs/               # Usage docs
│       │   │   └── examples/           # Example patterns gallery
│       └── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

---

## 3. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Fast, standard, good caching |
| Editor | Monaco Editor (`@monaco-editor/react`) | Best-in-class code editor, view zones, decorations API |
| Audio engine | `@strudel/core` + `@strudel/webaudio` | Direct import, no iframe boundary — full Hap/AudioContext access |
| Framework (app) | Next.js 15 App Router | SSR, fast cold start, easy deployment |
| Styling | Tailwind CSS 4 + CSS custom properties | Utility-first, themeable |
| State | Zustand | Minimal, works across components without prop drilling |
| Canvas | native Canvas 2D API | No library needed for visualizers |
| Build (library) | tsup | Zero-config ESM + CJS bundle |
| Types | TypeScript strict | Full type safety on Hap, Pattern, AudioContext |
| Testing | Vitest + Testing Library | Fast unit + component tests |

---

## 4. Core Architecture

### 4.1 StrudelEngine

The engine is the single source of truth for audio. It wraps `@strudel/core` and
`@strudel/webaudio` and exposes a clean async API + event emitter.

```ts
// packages/editor/src/engine/StrudelEngine.ts

import { evaluate } from '@strudel/core'
import { getAudioContext, webaudioOutput, initAudio } from '@strudel/webaudio'
import { Scheduler } from '@strudel/webaudio'

export class StrudelEngine extends EventEmitter {
  private scheduler: Scheduler
  private audioCtx: AudioContext
  private analyserNode: AnalyserNode
  private pattern: Pattern | null = null

  async init() {
    await initAudio()
    this.audioCtx = getAudioContext()
    this.analyserNode = this.audioCtx.createAnalyser()
    this.analyserNode.fftSize = 2048
    // Connect analyser to destination for scope/spectrum
    this.analyserNode.connect(this.audioCtx.destination)

    this.scheduler = new Scheduler({
      audioContext: this.audioCtx,
      onTrigger: (hap, time, cps, endTime) => {
        this.emit('hap', { hap, time, cps, endTime })
      },
    })
  }

  async evaluate(code: string): Promise<{ error?: Error }> {
    try {
      const result = await evaluate(code)
      this.pattern = result.pattern
      this.scheduler.setPattern(this.pattern)
      return {}
    } catch (err) {
      return { error: err as Error }
    }
  }

  play() { this.scheduler.start() }
  stop() { this.scheduler.stop(); this.pattern = null }

  getAnalyser(): AnalyserNode { return this.analyserNode }
  getAudioContext(): AudioContext { return this.audioCtx }

  // ── Export API ──────────────────────────────────────────────────────────────

  /**
   * Live capture: records N seconds of real-time audio output.
   * Taps the AnalyserNode output via ScriptProcessorNode.
   * Returns a WAV Blob encoded in memory (no disk I/O).
   * Code must already be playing when called.
   */
  async record(durationSeconds: number): Promise<Blob> {
    return LiveRecorder.capture(this.analyserNode, this.audioCtx, durationSeconds)
  }

  /**
   * Offline render: evaluates `code` and renders it faster than real time into
   * an OfflineAudioContext, through the same superdough graph the live engine
   * plays (§4.2). `renderOfflineReport` also returns what could not play.
   *
   * ⚠ Not safe while the transport plays: the render borrows superdough's
   * module globals, so live notes in that window land in the file (#1627).
   * ⚠ `code` is evaluated outside the engine's own evaluate, so a document
   * using setcps, $: or .viz does not render yet (#1344).
   *
   * @param code      Strudel program
   * @param duration  Seconds to render
   * @param sampleRate Defaults to live AudioContext sampleRate (44100 or 48000)
   */
  async renderOffline(
    code: string,
    duration: number,
    sampleRate?: number
  ): Promise<Blob> {
    return (await this.renderOfflineReport(code, duration, sampleRate)).blob
  }

  /**
   * Multi-stem export. Renders each stem's standalone Strudel program through
   * the real superdough graph, ONE AT A TIME — the render borrows superdough's
   * module globals, so two at once would corrupt each other (#1409).
   * Returns a map of stemName → outcome; a stem that fails costs no other stem.
   *
   * @param stems    { drums: "s(\"bd*4\")", bass: "...", ... }
   * @param duration Seconds to render per stem
   * @param onProgress Called after each stem settles, in order: (stemName, index, total)
   */
  async renderStems(
    stems: Record<string, string>,
    duration: number,
    onProgress?: (stem: string, i: number, total: number) => void
  ): Promise<Record<string, StemOutcome<{ blob: Blob; haps: number; played: number; skipped: SkippedSounds[] }>>> {
    const sampleRate = this.audioCtx.sampleRate
    return renderStemsInOrder(
      stems,
      (code) => this.renderOfflineReport(code, duration, sampleRate),
      onProgress
    )
  }
}
```

Key: `onTrigger` fires for every scheduled Hap with full timing data. This is the
single event source for ALL visual feedback — highlights, pianoroll, scope/spectrum all
derive from this one stream.

### 4.2 Offline render (`renderPatternOffline`)

Renders a pattern faster than real time into an `OfflineAudioContext`, through the
same superdough graph the live engine plays, so samples, soundfonts and effects sound
in a bounce as they do live (#1353). `OfflineAudioContext.startRendering()` has no
real-time constraint, which is what makes it faster than a live capture.

It is upstream's `renderPatternAudio` (`@strudel/webaudio`) with three changes, each
explained in the header of `engine/renderPatternOffline.ts`:

- A hap that fails to sound is counted and reported, not swallowed.
- It returns the `AudioBuffer`, so `WavEncoder` can refuse a silent take (#1402).
- It never closes the live context (#1400).

`superdough()` takes no context argument, so for the length of a render its module
globals point at the offline context and are restored afterwards. Two consequences:
renders run one at a time (`renderStems` goes stem by stem, #1409), and a render
while the transport plays pulls live notes into the file (#1627).

Known gap: `renderOffline` evaluates code outside the engine's own evaluate, so a
document using `setcps`, `$:` or `.viz` does not render yet (#1344).

The first version was a hand-rolled `OfflineRenderer` that drew each note with
oscillators and skipped every sample. It was removed in #1630.

### 4.3 LiveRecorder

For real-time capture (when you want to record exactly what the user hears, including
any live tweaks they made during playback):

```ts
// engine/LiveRecorder.ts
export class LiveRecorder {
  static capture(analyser: AnalyserNode, ctx: AudioContext, duration: number): Promise<Blob> {
    return new Promise((resolve) => {
      const bufferSize = 4096
      const processor = ctx.createScriptProcessor(bufferSize, 2, 2)
      const chunksL: Float32Array[] = []
      const chunksR: Float32Array[] = []

      processor.onaudioprocess = (e) => {
        chunksL.push(new Float32Array(e.inputBuffer.getChannelData(0)))
        chunksR.push(new Float32Array(e.inputBuffer.getChannelData(1)))
        // Pass through to speakers (recording doesn't interrupt playback)
        e.outputBuffer.getChannelData(0).set(e.inputBuffer.getChannelData(0))
        e.outputBuffer.getChannelData(1).set(e.inputBuffer.getChannelData(1))
      }

      analyser.connect(processor)
      processor.connect(ctx.destination)

      setTimeout(() => {
        processor.disconnect()
        analyser.disconnect(processor)
        resolve(WavEncoder.encodeChunks(chunksL, chunksR, ctx.sampleRate))
      }, duration * 1000)
    })
  }
}
```

### 4.4 WavEncoder

Pure TypeScript RIFF WAV encoder. No dependencies, works in any browser.
Encodes stereo Float32 PCM samples into a standard 16-bit WAV Blob.

```ts
// engine/WavEncoder.ts
export class WavEncoder {
  static encode(buffer: AudioBuffer): Blob {
    const L = buffer.getChannelData(0)
    const R = buffer.getChannelData(1) ?? L   // mono fallback
    return this.encodeChunks([L], [R], buffer.sampleRate)
  }

  static encodeChunks(
    chunksL: Float32Array[],
    chunksR: Float32Array[],
    sampleRate: number
  ): Blob {
    const total = chunksL.reduce((n, c) => n + c.length, 0)
    const ab = new ArrayBuffer(44 + total * 4)  // 16-bit stereo = 4 bytes/sample
    const view = new DataView(ab)
    // ... standard RIFF WAV header + interleaved PCM samples
    return new Blob([ab], { type: 'audio/wav' })
  }
}
```

### 4.5 HapStream

A lightweight event bus that the engine feeds into. All visualizers subscribe here
instead of directly to the engine, making them independently testable.

```ts
// HapStream.ts
export interface HapEvent {
  hap: Hap                  // Full Strudel Hap object
  audioTime: number         // AudioContext.currentTime when note fires
  audioDuration: number     // Duration in AudioContext seconds
  scheduledAheadMs: number  // Lookahead offset (for display timing)
  midiNote: number | null   // Computed MIDI note (null for percussion)
  s: string | null          // Instrument/sample name
  color: string | null      // From .color() in pattern
  loc: Array<{start: number, end: number}> | null  // Source char range
}
```

### 4.6 Active Note Highlighting

**How Strudel's loc system works:**
When the mini-notation parser parses `"c3 e3 g3"`, each resulting Hap carries
`.context.loc` — an array of `{start, end}` character offsets pointing back into
the original source code string. When a Hap fires, those characters are the ones
that "generated" this note.

**Our implementation:**

```
Hap fires → HapStream emits HapEvent
  → highlight.ts receives loc + scheduledAheadMs
  → setTimeout(applyDecoration, scheduledAheadMs)  ← fires exactly when note plays
  → Monaco deltaDecorations with class 'strudel-active-hap'
  → setTimeout(clearDecoration, audioDuration * 1000)
```

The `scheduledAheadMs` delay is critical: Strudel schedules notes ~100-300ms ahead
of actual playback. Without the delay, characters would light up before you hear the note.

Monaco decoration CSS:
```css
.strudel-active-hap {
  background: rgba(var(--accent-rgb), 0.25);
  border-radius: 2px;
  outline: 1px solid rgba(var(--accent-rgb), 0.6);
  box-shadow: 0 0 8px rgba(var(--accent-rgb), 0.3);
  transition: opacity 80ms ease;
}
```

Multiple simultaneous haps (chords, stack voices) each get their own decoration
applied independently. Decorations are stored in a `Map<decorationId, timeoutId>`
to allow precise individual cleanup.

### 4.7 Inline Pianoroll (Monaco View Zones)

Monaco view zones insert arbitrary DOM elements between editor lines. We use this
to embed a pianoroll canvas directly below the pattern line.

```ts
// viewzones.ts
export function addInlinePianoroll(
  editor: monaco.editor.IStandaloneCodeEditor,
  lineNumber: number,           // line where $: stack(...) or the pattern starts
  hapStream: HapStream,
  options: InlinePianorollOptions
): () => void {                 // returns cleanup fn

  let zoneId: string
  const canvasContainer = document.createElement('div')
  canvasContainer.style.cssText = 'width:100%;height:100px;background:#090912'

  editor.changeViewZones(accessor => {
    zoneId = accessor.addZone({
      afterLineNumber: lineNumber,
      heightInPx: 100,
      domNode: canvasContainer,
    })
  })

  // Mount React pianoroll into the container
  const root = createRoot(canvasContainer)
  root.render(<InlinePianoroll hapStream={hapStream} height={100} />)

  return () => {
    root.unmount()
    editor.changeViewZones(accessor => accessor.removeZone(zoneId))
  }
}
```

For multi-stem code (`$: stack(...)`), detect the stack line and insert one view zone
for the whole combined view. For per-stem code (separate `$:` lines), optionally insert
one view zone per `$:` line with per-voice filtering by loc character range.

### 4.8 Pianoroll Panel (Full Width Canvas)

A rolling 6-second window canvas component. Receives HapEvents, buffers them, renders
at 60fps via requestAnimationFrame.

**Coordinate system:**
- X: time axis. Right edge = now (playhead). Left edge = 6s ago.
- Y: MIDI pitch. Bottom = MIDI 24 (C1). Top = MIDI 96 (C7).
- Percussion (bd, sd, hh): fixed MIDI positions (36, 38, 42 etc.), shown below the pitch area.

**Note block position:**
```ts
const xRight = W * (1 - (now - endMs) / (VIEW_SECONDS * 1000))
const xLeft  = W * (1 - (now - startMs) / (VIEW_SECONDS * 1000))
```
Notes grow rightward as they play, then scroll left after they end.
Clamp both to [0, W] — notes extend to playhead while still sounding.

**Color strategy:**
1. If `hap.value.color` is set (from `.color("cyan magenta")` in pattern) → use it
2. Else: map by `s` field:
   - bd/sd/hh/rim → drums orange
   - sawtooth/square → bass cyan
   - sine → melody violet
   - triangle → pad emerald
   - default → accent purple

### 4.9 Oscilloscope (Scope)

Reads time-domain data from the AnalyserNode at 60fps.

```ts
function drawScope(ctx, analyser, W, H) {
  const buf = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(buf)

  ctx.clearRect(0, 0, W, H)
  ctx.strokeStyle = 'var(--accent)'
  ctx.lineWidth = 1.5
  ctx.beginPath()

  for (let i = 0; i < buf.length; i++) {
    const x = (i / buf.length) * W
    const y = (0.5 + buf[i] * 0.5) * H
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.stroke()
}
```

Optional zero-crossing trigger (like a real oscilloscope) for stable waveform display:
find the first sample that crosses zero going upward, start rendering from there.

### 4.10 Spectrum Analyzer

Reads frequency-domain data from the AnalyserNode.

```ts
function drawSpectrum(ctx, analyser, W, H) {
  const buf = new Float32Array(analyser.frequencyBinCount)  // 1024 bins
  analyser.getFloatFrequencyData(buf)  // values in dB (-Infinity to 0)

  const MIN_DB = -80, MAX_DB = -10
  const barW = W / buf.length * 2.5

  for (let i = 0; i < buf.length; i++) {
    const norm = (buf[i] - MIN_DB) / (MAX_DB - MIN_DB)
    const barH = Math.max(0, norm * H)
    const hue = 260 + (i / buf.length) * 60  // purple to blue gradient
    ctx.fillStyle = `hsl(${hue}, 70%, 60%)`
    ctx.fillRect(i * barW, H - barH, barW - 1, barH)
  }
}
```

### 4.11 Spiral Visualizer

Maps each note event to a position on a rotating spiral. Each full rotation = 1 cycle.

```ts
// Angle = (note.begin % 1) * 2π (position within cycle)
// Radius = base + (midiNote / 127) * maxRadius (pitch = radius)
// A dot is drawn at (cx + r*cos(θ), cy + r*sin(θ))
// Active notes: full opacity, larger dot
// Past notes: fade out over ~2 cycles
```

### 4.12 Pitchwheel

All 12 pitch classes arranged around a circle. Active notes glow.

```ts
// Each of 12 semitones at angle = (semitone / 12) * 2π
// Highlight arc when that pitch class is active
// Multiple octaves shown as concentric rings
```

---

## 5. Monaco Language Features

### 5.1 Strudel Language Definition

Register a Monaco language `strudel` that extends JavaScript with:
- Mini-notation string highlighting (different color inside `"..."` when it's a pattern string)
- Strudel function names tokenized as keywords
- Note names (c3, eb4, etc.) highlighted distinctly
- `$:` and `setcps` recognized as special tokens

```ts
monaco.languages.register({ id: 'strudel' })
monaco.languages.setMonarchTokensProvider('strudel', {
  tokenizer: {
    root: [
      // Strudel-specific
      [/\$:/, 'strudel.pattern-start'],
      [/setcps/, 'strudel.tempo'],
      [/\b(note|s|gain|release|sustain|cutoff|resonance|stack|mask|speed|room|delay|distort|fm|swing|struct|every|sometimes|jux|off|fast|slow|rev|palindrome|chunk|iter|euclid|euclidRot)\b/, 'strudel.function'],
      [/\b([a-g][b#]?\d)\b/, 'strudel.note'],          // note names: c3, eb4, f#2
      [/\b\d+(\.\d+)?\b/, 'number'],
      // Mini-notation patterns (content inside quoted strings gets sub-tokenized)
      [/"/, 'string', '@mini_string'],
      // Standard JS fallthrough
      [/\/\/.*$/, 'comment'],
      ...
    ],
    mini_string: [
      [/[~*!%?@<>\[\]{}|,_]/, 'strudel.mini.operator'],
      [/[a-g][b#]?\d?/, 'strudel.mini.note'],
      [/\d+(\.\d+)?/, 'strudel.mini.number'],
      [/"/, 'string', '@pop'],
    ],
  }
})
```

### 5.2 Autocomplete

Trigger completions for:
- After `.` → all chainable Strudel functions with signatures
- Inside `note("...")` → note names (c3, eb4, ...) + mini-notation operators
- Inside `s("...")` → sample bank names (bd, sd, hh, ...) + oscillator names
- `setcps(` → BPM/240 formula suggestion

```ts
monaco.languages.registerCompletionItemProvider('strudel', {
  triggerCharacters: ['.', '"', '('],
  provideCompletionItems(model, position) {
    // Analyze context: inside string? after dot? inside s()?
    // Return appropriate completions from the function reference
  }
})
```

### 5.3 Hover Documentation

When hovering any Strudel function name, show its documentation + example:

```ts
monaco.languages.registerHoverProvider('strudel', {
  provideHover(model, position) {
    const word = model.getWordAtPosition(position)
    const doc = FUNCTION_DOCS[word?.word ?? '']
    if (!doc) return null
    return {
      contents: [
        { value: `**${word.word}**` },
        { value: '```strudel\n' + doc.example + '\n```' },
        { value: doc.description },
      ]
    }
  }
})
```

### 5.4 Error Squiggles

On evaluate error (from StrudelEngine.evaluate returning `{ error }`):
- Parse the error message for line/column info
- Apply Monaco `editor.setModelMarkers` with severity Error
- Display inline error message via Monaco inline decoration

---

## 6. Public API (Component Library)

### 6.1 StrudelEditor Props

```ts
export interface StrudelEditorProps {
  // Content
  code?: string                          // Initial code
  defaultCode?: string                   // Uncontrolled default
  onChange?: (code: string) => void      // Code change callback

  // Playback
  autoPlay?: boolean                     // Start playing on mount
  onPlay?: () => void
  onStop?: () => void
  onError?: (error: Error) => void

  // Visual
  visualizer?: 'pianoroll' | 'scope' | 'spectrum' | 'spiral' | 'pitchwheel' | 'off'
  inlinePianoroll?: boolean              // Show pianoroll as Monaco view zone
  activeHighlight?: boolean              // Active char highlighting (default: true)
  theme?: 'dark' | 'light' | StrudelTheme

  // Layout
  height?: number | string               // Editor height
  vizHeight?: number | string            // Visualizer panel height
  showToolbar?: boolean                  // Show play/stop toolbar (default: true)
  readOnly?: boolean

  // Export
  onExport?: (blob: Blob, stemName?: string) => Promise<string>
  // Integrator-provided upload function. Receives a WAV Blob (and optionally
  // which stem it is), returns a public URL. struCode calls this automatically
  // after renderOffline/renderStems. If omitted, export triggers a local download.

  // Advanced
  engineRef?: React.MutableRefObject<StrudelEngine>  // Access the engine directly
}
```

### 6.2 Usage Examples

**Minimal embed:**
```tsx
import { StrudelEditor } from '@strucode/editor'

<StrudelEditor code={`setcps(120/240)\n$: note("c3 e3 g3").s("sine")`} />
```

**Full config:**
```tsx
<StrudelEditor
  code={strudelCode}
  onChange={setCode}
  visualizer="pianoroll"
  inlinePianoroll={true}
  activeHighlight={true}
  theme="dark"
  height="400px"
  vizHeight="200px"
  onError={(e) => console.error(e)}
/>
```

**Access engine directly:**
```tsx
const engineRef = useRef<StrudelEngine>(null)

<StrudelEditor
  engineRef={engineRef}
  onPlay={() => engineRef.current?.getAnalyser()}  // tap audio graph directly
/>
```

### 6.3 Stem-Level Export

`renderStems()` is the key primitive for any app that needs isolated per-instrument audio.
Because each stem is an independent Strudel program evaluated in its own `OfflineAudioContext`,
the output blobs are **mathematically isolated** — no mixing, no bleed between instruments.

This is true stem separation by construction, not post-hoc source separation (like Demucs).
Any app that generates per-stem Strudel code gets isolated WAV files for free.

```ts
// An app with per-stem Strudel code gets isolated stems:
const stems = {
  drums:  'setcps(120/240)\n$: stack(note("c1*4").s("bd"), ...)',
  bass:   'setcps(120/240)\n$: note("c2 eb2 g2").s("sawtooth")...',
  melody: 'setcps(120/240)\n$: note("c4 eb4 g4").s("sine")...',
  pad:    'setcps(120/240)\n$: note("<[c3,eb3]>").s("triangle")...',
}

const out = await engine.renderStems(stems, 30)
// out.drums  → { ok: true, blob, haps, played, skipped } — WAV containing ONLY drum audio
// out.bass   → the same shape, ONLY bass audio
// A stem that fails — silent, or nothing in it could play — is { ok: false, error }
// and costs no other stem. A silent stem's error is a SilentCaptureError whose
// `refused` still holds the take.

// Each blob is a standalone WAV — download, upload to CDN, feed to AI, anything.
```

The integrating app decides what to do with the blobs — upload to a CDN, feed them
to an AI audio model, mix them server-side, download as a ZIP. struCode doesn't care.

### 6.4 Standalone Export (no integrator upload)

When `onExport` is not provided, the toolbar's download button triggers a local file download:

```ts
// Inside StrudelEditor toolbar "Export" button handler:
async function handleExport() {
  const blob = await engineRef.current.renderOffline(code, exportDuration)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'pattern.wav'
  a.click()
  URL.revokeObjectURL(url)
}
```

For multi-stem export from the standalone app, the toolbar shows a "Export stems" button
that calls `renderStems()` and downloads a ZIP (using `fflate` for in-browser ZIP):

```ts
import { zipSync } from 'fflate'

const out = await engine.renderStems(stems, 30)
const files: Record<string, Uint8Array> = {}
for (const [name, stem] of Object.entries(out)) {
  // A stem that failed (silent, or nothing in it could play) is left out of
  // the ZIP; the others are unaffected.
  if (stem.ok) files[`${name}.wav`] = new Uint8Array(await stem.blob.arrayBuffer())
}
const zip = zipSync(files)
downloadBlob(new Blob([zip], { type: 'application/zip' }), 'stems.zip')
```

---

## 7. Design System

### 7.1 Color Tokens

```ts
// tokens.ts — all colors as CSS custom properties
export const DARK_THEME = {
  '--background':       '#090912',   // near-black with blue tint
  '--surface':          '#0f0f1a',   // cards, panels
  '--surface-elevated': '#14141f',   // code editor bg
  '--border':           'rgba(255,255,255,0.08)',
  '--foreground':       '#e2e8f0',   // primary text
  '--foreground-muted': 'rgba(255,255,255,0.4)',  // secondary text
  '--accent':           '#8b5cf6',   // violet-500 — primary accent
  '--accent-rgb':       '139, 92, 246',
  '--accent-dim':       'rgba(139,92,246,0.15)',

  // Stem colors
  '--stem-drums':       '#f97316',   // orange-500
  '--stem-bass':        '#06b6d4',   // cyan-500
  '--stem-melody':      '#a78bfa',   // violet-400
  '--stem-pad':         '#10b981',   // emerald-500

  // Code editor
  '--code-bg':          '#090912',
  '--code-foreground':  '#c4b5fd',   // violet-300 — default code color
  '--code-caret':       '#8b5cf6',
  '--code-selection':   'rgba(139,92,246,0.25)',
  '--code-line-highlight': 'rgba(139,92,246,0.05)',
  '--code-note':        '#86efac',   // green-300 — note names (c3, eb4)
  '--code-function':    '#93c5fd',   // blue-300 — function names
  '--code-string':      '#fcd34d',   // amber-300 — mini-notation strings
  '--code-number':      '#fb923c',   // orange-400 — numbers
  '--code-comment':     'rgba(255,255,255,0.25)',
  '--code-active-hap':  'rgba(139,92,246,0.3)',  // active note highlight bg
}
```

### 7.2 Typography

```ts
// Monospace stack for code
'--font-mono': '"JetBrains Mono", "Fira Code", "Cascadia Code", "Menlo", monospace'
// Font size in editor: 13px / line-height 1.7
// Font size in toolbar/labels: 11-12px
```

### 7.3 Layout Structure

```
┌─────────────────────────────────────────────────┐
│  TOOLBAR                                        │  32px
│  [▶ Play] [■ Stop]  120 BPM  C minor  [error?] │
│  [Piano Roll ▾] [Scope] [Spectrum] [Spiral] [Off]│
├─────────────────────────────────────────────────┤
│                                                 │
│  MONACO EDITOR (code + active highlighting)     │  flex-grow
│                                                 │
│  ─── Inline pianoroll view zone (optional) ─── │  100px
│                                                 │
├─────────────────────────────────────────────────┤
│  VISUALIZER PANEL                               │  180-240px
│  (pianoroll canvas / scope / spectrum / spiral) │
└─────────────────────────────────────────────────┘
```

### 7.4 Visualizer Design Language

**Pianoroll:**
- Background: `--background` (#090912)
- Note blocks: stem colors, 85% opacity, 2px border-radius
- Playhead: 2px vertical line, `--accent` color, 40% opacity glow
- Grid lines: horizontal at each octave boundary, 4% white opacity
- Percussion: shown in bottom 20% of canvas at fixed positions

**Scope:**
- Background: transparent (overlaid on dark bg)
- Waveform line: `--accent`, 1.5px stroke, subtle glow
- Center line (0): 4% white opacity
- Grid: none (cleaner)

**Spectrum:**
- Background: transparent
- Bars: gradient from `--stem-melody` (violet) to `--stem-bass` (cyan) across freq
- Bar width: auto-scaled to canvas width / bins * 2.5
- Smoothed with `analyser.smoothingTimeConstant = 0.8`

**Spiral:**
- Background: `--background`
- Active note dots: `--accent`, radius = 6px, full opacity + glow
- Inactive/decaying dots: 10% opacity, shrinking
- Cycle ring: subtle white 5% opacity circle

**Active highlight in Monaco:**
- Background: `rgba(--accent-rgb, 0.25)` soft purple glow
- Outline: `1px solid rgba(--accent-rgb, 0.5)`
- Border radius: 2px
- Box shadow: `0 0 8px rgba(--accent-rgb, 0.3)`
- Transition: opacity 80ms ease (appears sharp, fades gently)

### 7.5 Animation Principles

- Note highlight: appears instantly (0ms), fades out over 80ms after note ends
- Pianoroll: 60fps requestAnimationFrame, no additional easing needed
- Scope/spectrum: 60fps requestAnimationFrame, `smoothingTimeConstant` does the easing
- Toolbar transitions: 150ms ease (play→stop button swap)
- View zone appearance: 200ms height transition via `heightInPx` animation
- Panel expand/collapse: 300ms cubic-bezier(0.4, 0, 0.2, 1)

---

## 8. Strudel Package Integration

### 8.1 Packages to Import

```json
{
  "dependencies": {
    "@strudel/core":     "latest",
    "@strudel/webaudio": "latest",
    "@strudel/mini":     "latest",
    "@strudel/tonal":    "latest",
    "@strudel/draw":     "latest"
  }
}
```

- `@strudel/core` — Pattern, Hap, evaluate(), register()
- `@strudel/webaudio` — initAudio(), getAudioContext(), Scheduler, webaudioOutput
- `@strudel/mini` — mini-notation parser (registers mini() globally)
- `@strudel/tonal` — note(), scale(), chord() (registers note functions globally)
- `@strudel/draw` — optional: can import pianoroll drawing utils directly instead of reimplementing

### 8.2 Initialization Sequence

```ts
// Must happen after user gesture (browser autoplay policy)
async function initEngine(): Promise<StrudelEngine> {
  // 1. Init audio (creates/resumes AudioContext)
  await initAudio()

  // 2. Register all pattern functions globally (strudel's side effects)
  // @strudel/mini registers mini(), silence(), etc.
  // @strudel/tonal registers note(), s(), gain(), etc.
  // These registrations happen on import — just importing the package is enough

  // 3. Create engine
  const engine = new StrudelEngine()
  await engine.init()
  return engine
}
```

The engine MUST be initialized after a user gesture. The component handles this with a
"Click to enable audio" splash if AudioContext is suspended.

### 8.3 Hap Event Data

Every Hap object received in `onTrigger(hap, time, cps, endTime)` has:

```ts
interface Hap {
  value: {
    note?: string | number   // "c3" | 60 | undefined
    n?: number               // scale degree
    s?: string               // "bd" | "sawtooth" | "sine" etc.
    gain?: number
    release?: number
    cutoff?: number
    color?: string           // from .color() in pattern
    loc?: Array<{start: number, end: number}>  // source char ranges
    // + all other pattern values (room, delay, fm, distort, ...)
  }
  begin: Fraction    // cycle fraction when event starts
  end: Fraction      // cycle fraction when event ends
  whole: { begin: Fraction, end: Fraction }  // "whole" event span
  context: {
    loc?: Array<{start: number, end: number}>  // same as value.loc usually
    color?: string
  }
}
// time: AudioContext time when note fires (absolute)
// endTime: AudioContext time when note ends
// cps: cycles per second at time of event (from setcps())
```

---

## 9. Build & Publishing

### 9.1 Library Build (tsup)

```ts
// packages/editor/tsup.config.ts
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  external: ['react', 'react-dom', '@monaco-editor/react', 'monaco-editor'],
  // @strudel/* are bundled in (users shouldn't need to install separately)
})
```

### 9.2 What Gets Exported

```ts
// packages/editor/src/index.ts
export { StrudelEditor } from './StrudelEditor'
export { StrudelEngine } from './engine/StrudelEngine'
export type { StrudelEditorProps, StrudelTheme, HapEvent } from './types'

// Individual visualizers (for custom layouts)
export { Pianoroll } from './visualizers/Pianoroll'
export { Scope } from './visualizers/Scope'
export { Spectrum } from './visualizers/Spectrum'
export { Spiral } from './visualizers/Spiral'
export { Pitchwheel } from './visualizers/Pitchwheel'
```

---

## 10. Development Phases

### Phase 1 — Foundation + Export Core
- [ ] Monorepo setup (pnpm + turborepo)
- [ ] `@strudel/core` + `@strudel/webaudio` direct import working
- [ ] StrudelEngine class (evaluate, play, stop, onTrigger)
- [ ] WavEncoder (pure TS, no deps, stereo 16-bit WAV)
- [ ] `renderOffline` — single pattern, OfflineAudioContext, real superdough graph
- [ ] LiveRecorder (`record` — ScriptProcessorNode tap)
- [ ] `renderStems` — multi-stem offline render, one stem at a time
- [ ] `onExport` hook wired to toolbar download button
- [ ] Monaco editor with basic Strudel syntax highlighting
- [ ] Toolbar (play/stop, export, BPM display, error badge)

### Phase 2 — Active Highlighting
- [ ] HapStream event bus
- [ ] noteToMidi conversion (handles note names + numbers)
- [ ] `hap.context.loc` → Monaco deltaDecorations (timed with scheduledAheadMs delay)
- [ ] CSS glow animation for active chars
- [ ] Multi-hap simultaneous highlight (chords, stack voices)

### Phase 3 — Pianoroll
- [ ] Full-panel rolling pianoroll canvas (60fps rAF)
- [ ] Stem color mapping from s field
- [ ] Percussion at fixed MIDI positions
- [ ] Auto-ranging MIDI axis (clamp to 10th percentile - 90th percentile of events)
- [ ] Inline pianoroll as Monaco view zone (auto-detects $: lines)

### Phase 4 — Audio Visualizers
- [ ] Oscilloscope (scope) with zero-crossing trigger
- [ ] Spectrum analyzer with frequency gradient
- [ ] Spiral visualizer
- [ ] Pitchwheel
- [ ] VizPicker toolbar UI

### Phase 5 — Monaco Intelligence
- [ ] Strudel language definition (full tokenizer)
- [ ] Autocomplete (functions, note names, sample names)
- [ ] Hover documentation
- [ ] Error squiggles with line mapping

### Phase 6 — Library Polish
- [ ] tsup build config
- [ ] npm publish workflow
- [ ] Storybook for component docs
- [ ] Test suite (Vitest + Testing Library)
- [ ] Standalone demo app (Next.js) deployed to strucode.dev or similar

---

## 11. Key Technical Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `@strudel/core` registers globals on import — may conflict with multiple instances | High | Ensure single engine instance per page. Document constraint. |
| AudioContext suspended until user gesture | Medium | Detect `ctx.state === 'suspended'`, show "enable audio" prompt |
| `hap.context.loc` may be undefined for some patterns | Medium | Graceful null checks everywhere; loc is best-effort |
| Monaco view zones reset on code change (editor re-layout) | Medium | Re-add view zones after each evaluate() in a useEffect |
| `@strudel/webaudio` Scheduler API may change across versions | Low | Pin strudel versions, add integration tests |
| AnalyserNode ← audio graph connection varies by strudel version | Medium | Test connection point, document which node to tap |
| OfflineAudioContext: webaudioOutput may not accept custom context | High | Test during Phase 1. Fallback: patch the output function to accept ctx param. |
| OfflineAudioContext: AudioWorklets (SuperDirt samples) may not load | High | Offline render works for oscillators (sine/saw/square). Sample-based sounds require pre-loading AudioWorklet in offline ctx — document limitation. |
| ScriptProcessorNode deprecated (LiveRecorder) | Low | Use AudioWorkletNode with SharedArrayBuffer if available, fall back to ScriptProcessorNode. Note: SAB requires COOP/COEP headers. |
| fflate ZIP for stem export adds bundle weight | Low | Lazy-import fflate only when "Export stems" is triggered. |

---

## 12. Reference Links

- Strudel source: https://github.com/tidalcycles/strudel
- Strudel docs: https://strudel.cc/learn/
- Monaco view zones API: https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.IViewZone.html
- Monaco decorations API: https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.IModelDecorationOptions.html
- Web Audio AnalyserNode: https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode
- tsup: https://tsup.egoist.dev/
- Turborepo: https://turbo.build/

---

- fflate (in-browser ZIP for stem export): https://github.com/101arrowz/fflate
- OfflineAudioContext MDN: https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext

---

*Created: 2026-03-21 | Status: Pre-build specification | Do not start until Composr v1 ships.*
