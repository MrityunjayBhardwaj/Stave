/**
 * Bundled p5 viz source code — single source of truth.
 *
 * These strings power both:
 *   - `DEFAULT_VIZ_DESCRIPTORS` (the viz picker / demo / standalone
 *     embedders), compiled via `compileP5Code`.
 *   - The bundled `preset/viz/*.p5` workspace files seeded by the app
 *     template, which re-export these constants for backwards-compat.
 *
 * Until #184 (PR retiring the 7 TS sketch classes that previously powered
 * the picker), the picker rendered a different — richer or poorer — copy
 * of each viz than what users edited in the preset file. PV56 demands the
 * picker code path === the preset file code path; this module is that path.
 */

export const PIANOROLL_P5_CODE = `// Stave p5 viz — Piano Roll
// stave.scheduler, stave.analyser, stave.hapStream, stave.options are injected
// globals. Fold-by-pitch lanes: each distinct pitch (or unpitched sound) gets
// its own lane, sorted low→high, so notes never overlap and the melodic
// contour reads as a staircase. Notes scroll across a 4-cycle window; the
// playhead sits at the half mark.
//
// Honours a subset of @strudel/draw's .pianoroll(options) vocabulary via
// stave.options — defaults (no options) reproduce Stave's classic look:
//   cycles, playhead, vertical, labels, flipTime, flipValues, fold,
//   minMidi, maxMidi, autorange, fill, fillActive, strokeActive,
//   active, inactive, background, playheadColor.

// Drum/percussion sound-name prefixes for color classification.
const DRUM_PREFIXES = ['bd', 'sd', 'hh', 'rim', 'cp', 'cy', 'lt', 'mt', 'ht', 'oh', 'cl']

function isDrum(s) {
  return DRUM_PREFIXES.some(p => s === p || (s.startsWith(p) && /\\d/.test(s[p.length] || '')))
}

// Fold-grouping key: a MIDI number for pitched haps, a "_sound" string for
// unpitched ones. Priority mirrors Strudel's piano roll: a written freq, then the
// note. A note NAME's pitch is h.midi, read by the engine with Strudel's own
// grammar (cs3, g, ef3 included) — a sketch runs sandboxed and cannot import a
// parser, so it never reads names itself (#1929). A name that is not a note folds
// onto its own string lane.
function valueOf(h) {
  if (typeof h.freq === 'number') return Math.round(12 * Math.log2(h.freq / 440) + 69)
  if (typeof h.note === 'number') return h.note
  if (typeof h.note === 'string') return typeof h.midi === 'number' ? h.midi : '_' + h.note
  if (h.s) return '_' + h.s
  return 0
}

// Default label text for a hap (note name, else sound[:n]).
function labelOf(h) {
  if (typeof h.note === 'string') return h.note
  if (typeof h.note === 'number') return String(h.note)
  if (h.s) return h.s + (h.n != null ? ':' + h.n : '')
  return ''
}

function parseHex(hex) {
  const s = String(hex).replace('#', '')
  if (s.length === 6) return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
  if (s.length === 3) return [parseInt(s[0] + s[0], 16), parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16)]
  return null
}

// Explicit hap color wins; else classify by sound family.
function colorOf(h) {
  if (h.color) { const c = parseHex(h.color); if (c) return c }
  const s = h.s || ''
  if (isDrum(s)) return [249, 115, 22]        // drums  — orange
  if (s.startsWith('bass')) return [6, 182, 212]   // bass  — cyan
  if (s.startsWith('pad')) return [16, 185, 129]   // pad   — green
  return [139, 92, 246]                        // melody — purple
}

const num = (v, d) => (typeof v === 'number' && !isNaN(v) ? v : d)

function setup() {
  createCanvas(stave.width, stave.height)
  noStroke()
}

function draw() {
  const W = width, H = height
  const O = (stave.options && typeof stave.options === 'object') ? stave.options : {}

  // ── options (defaults match @strudel/draw's pianoroll). fold defaults ON
  // (strudel.cc's real default, __pianoroll fold=1): distinct pitches pack into
  // CONTIGUOUS adjacent lanes — no empty rows between non-adjacent semitones.
  // The landscape note look comes from the wide/short native surface (#214),
  // NOT from fold:0. fold:0 (opt-in) spaces notes by absolute MIDI, which shows
  // gaps at the missing semitones (use with autorange for a tight range). ──
  const CYCLES = num(O.cycles, 4)
  const PLAYHEAD = num(O.playhead, 0.5)
  const vertical = !!O.vertical
  const labels = !!O.labels
  const flipTime = !!O.flipTime
  const flipValues = !!O.flipValues
  const useFold = O.fold == null ? true : !!O.fold
  const autorange = !!O.autorange
  const inactiveFilled = O.fill == null ? true : !!O.fill
  const activeFilled = O.fillActive == null ? true : !!O.fillActive   // Stave default: filled glow
  const activeStroked = O.strokeActive == null ? true : !!O.strokeActive
  const activeOverride = typeof O.active === 'string' ? parseHex(O.active) : null
  const inactiveOverride = typeof O.inactive === 'string' ? parseHex(O.inactive) : null
  const bg = typeof O.background === 'string' ? parseHex(O.background) : null
  const playheadCol = typeof O.playheadColor === 'string' ? parseHex(O.playheadColor) : null

  if (bg) background(bg[0], bg[1], bg[2]); else clear()

  const sched = stave.scheduler
  if (!sched) return
  let now
  try { now = sched.now() } catch (e) { return }

  const from = now - CYCLES * PLAYHEAD
  const to = now + CYCLES * (1 - PLAYHEAD)
  const ext = to - from
  let haps
  try { haps = sched.query(from, to) } catch (e) { haps = [] }

  // Distinct values (for fold lanes / autorange), sorted low→high.
  const seen = new Set(), vals = []
  for (const h of haps) { const v = valueOf(h); if (!seen.has(v)) { seen.add(v); vals.push(v) } }
  vals.sort((a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b
    if (typeof a === 'number') return -1
    if (typeof b === 'number') return 1
    return String(a).localeCompare(String(b))
  })

  // Value-axis slotting: fold (one slot per distinct value) OR absolute MIDI
  // range (minMidi..maxMidi, optionally autoranged from the numeric values).
  const numericVals = vals.filter(v => typeof v === 'number')
  let minMidi = num(O.minMidi, 10), maxMidi = num(O.maxMidi, 90)
  if (autorange && numericVals.length) { minMidi = Math.min(...numericVals); maxMidi = Math.max(...numericVals) }
  const foldCount = Math.max(1, vals.length)
  const absExtent = Math.max(1, maxMidi - minMidi + 1)
  const slotCount = useFold ? foldCount : absExtent

  // slotFromTop: 0 = top of the value axis (high pitch up).
  const slotFromTop = (h) => {
    const v = valueOf(h)
    let s
    if (useFold) { const lane = vals.indexOf(v); s = lane < 0 ? -1 : foldCount - 1 - lane }
    else if (typeof v === 'number') s = maxMidi - v
    else s = absExtent - 1 // unpitched sounds sit at the bottom in absolute mode
    if (s < 0 || s >= slotCount) return -1
    return flipValues ? slotCount - 1 - s : s
  }

  const timeAxis = vertical ? H : W
  const valueAxis = vertical ? W : H
  const barSize = valueAxis / slotCount

  noStroke()
  for (const h of haps) {
    const sft = slotFromTop(h)
    if (sft < 0) continue
    let tp = (h.begin - from) / ext            // 0..1 along the time axis
    if (flipTime) tp = 1 - tp
    const tPx = tp * timeAxis
    const durPx = Math.max(2, ((h.end - h.begin) / ext) * timeAxis)
    const vPx = (sft / slotCount) * valueAxis
    const endC = h.endClipped != null ? h.endClipped : h.end
    const active = h.begin <= now && endC > now
    const gain = Math.min(1, Math.max(0.1, h.gain == null ? 1 : h.gain))
    const vel = Math.min(1, Math.max(0.1, h.velocity == null ? 1 : h.velocity))
    const alpha = gain * vel
    let col = colorOf(h)
    if (active && activeOverride) col = activeOverride
    else if (!active && inactiveOverride) col = inactiveOverride
    const [r, g, b] = col

    // rect coords — horizontal: time→x, value→y; vertical: time→y, value→x.
    const rx = vertical ? vPx : tPx - (flipTime ? durPx : 0)
    const ry = vertical ? tPx - (flipTime ? 0 : durPx) : vPx
    const rw = vertical ? barSize : durPx
    const rh = vertical ? durPx : barSize

    if (active) {
      if (activeFilled) {
        // Brightened toward white unless an explicit active color was given.
        if (activeOverride) fill(r, g, b, alpha * 255)
        else fill(min(255, r + 60), min(255, g + 60), min(255, b + 60), alpha * 255)
        rect(rx, ry + 1, rw - 2, rh - 2)
      }
      if (activeStroked) {
        noFill(); stroke(255, 255, 255, 220); strokeWeight(1)
        rect(rx, ry + 1, rw - 2, rh - 2); noStroke()
      }
    } else if (inactiveFilled) {
      fill(r, g, b, alpha * 180)
      rect(rx, ry + 1, rw - 2, rh - 2)
    }

    if (labels) {
      const txt = labelOf(h)
      if (txt) {
        const fs = Math.min(14, Math.max(7, rh * 0.7))
        noStroke(); fill(active ? 255 : 230); textSize(fs); textAlign(LEFT, TOP)
        text(txt, rx + 2, ry + 1)
      }
    }
  }

  // Playhead line at the PLAYHEAD mark of the time axis.
  const phc = playheadCol || [255, 255, 255]
  stroke(phc[0], phc[1], phc[2], 128); strokeWeight(1)
  if (vertical) line(0, PLAYHEAD * H, W, PLAYHEAD * H)
  else line(PLAYHEAD * W, 0, PLAYHEAD * W, H)
  noStroke()
}`;

export const SCOPE_P5_CODE = `// Stave p5 viz — Scope (oscilloscope / event pulses)
// PERF: one reused buffer (re-alloc only on size change) — never allocate per draw().
let _wave = null
function setup() {
  createCanvas(stave.width, stave.height)
  noFill()
}
function draw() {
  clear()
  stroke(40, 50, 70); strokeWeight(0.5)
  line(0, height * 0.5, width, height * 0.5)
  if (stave.analyser) {
    const buf = stave.analyser.frequencyBinCount
    if (!_wave || _wave.length !== buf) _wave = new Float32Array(buf)
    const data = _wave
    stave.analyser.getFloatTimeDomainData(data)
    let trig = 0
    for (let i = 1; i < buf; i++) { if (data[i-1] > 0 && data[i] <= 0) { trig = i; break } }
    stroke('#75baff'); strokeWeight(2); beginShape()
    for (let i = trig; i < buf; i++) vertex((i - trig) * width / (buf - trig), (0.5 - 0.25 * data[i]) * height)
    endShape()
  } else if (stave.scheduler) {
    const now = stave.scheduler.now()
    const haps = stave.scheduler.query(now - 4, now + 0.1)
    noStroke()
    for (const h of haps) {
      const age = now - h.begin, decay = max(0, 1 - age / 4)
      const x = ((h.begin - now + 4) / 4) * width
      const w = max(3, ((h.end - h.begin) / 4) * width)
      const pH = height * 0.6 * decay * (h.gain ?? 1)
      fill(117, 186, 255, decay * 200)
      rect(x, height * 0.5 - pH / 2, w, pH, 2)
    }
  }
}`;

export const FSCOPE_P5_CODE = `// Stave p5 viz — Frequency Scope (FFT bars / note bars)
// PERF: one reused buffer (re-alloc only on size change) — never allocate per draw().
let _freq = null
function setup() {
  createCanvas(stave.width, stave.height)
  noStroke()
}
// Hz from a hap: a written freq, else the pitch the engine read from the note
// (h.midi, Strudel's own note grammar — a sketch cannot import a parser, #1929).
function hapFreq(h) {
  if (typeof h.freq === 'number') return h.freq
  if (typeof h.midi === 'number') return 440 * pow(2, (h.midi - 69) / 12)
  return null
}
function draw() {
  clear()
  stroke(40, 50, 70); strokeWeight(0.5); noFill()
  line(0, height * 0.75, width, height * 0.75); noStroke()
  if (stave.analyser) {
    const buf = stave.analyser.frequencyBinCount
    if (!_freq || _freq.length !== buf) _freq = new Float32Array(buf)
    const data = _freq
    stave.analyser.getFloatFrequencyData(data)
    fill('#75baff')
    const sw = width / buf
    for (let i = 0; i < buf; i++) {
      const n = constrain((data[i] + 100) / 100, 0, 1), v = n * 0.25
      rect(i * sw, (0.75 - v * 0.5) * height, max(sw, 1), v * height)
    }
  } else if (stave.scheduler) {
    const now = stave.scheduler.now()
    const haps = stave.scheduler.query(now - 0.2, now + 0.05)
    const bins = new Float32Array(64)
    for (const h of haps) {
      const freq = hapFreq(h)
      if (freq == null) continue
      if (freq < 30) continue
      const idx = constrain(floor(log(freq / 30) / log(4000 / 30) * 64), 0, 63)
      bins[idx] = max(bins[idx], max(0, 1 - (now - h.begin) / 0.5) * (h.gain ?? 1))
    }
    const sw = width / 64
    for (let i = 0; i < 64; i++) {
      if (bins[i] <= 0) continue
      const v = bins[i] * 0.25
      fill(117, 186, 255, bins[i] * 220)
      rect(i * sw, (0.75 - v * 0.5) * height, max(sw - 1, 1), v * height)
    }
  }
}`;

export const SPECTRUM_P5_CODE = `// Stave p5 viz — Spectrum (scrolling waterfall)
// The waterfall scrolls by reading back the PREVIOUS frame (getImageData →
// putImageData(-2,0)). That needs the drawing surface to PERSIST across frames —
// but in the worker the Tier-2 present transferToImageBitmap()s (and CLEARS) the
// main canvas every frame, so reading the MAIN canvas back yields nothing (#306).
// Own a persistent OffscreenCanvas buffer (_wf) instead: scroll it (cheap, one
// column/frame), then blit it to the main canvas each frame. _wf is never
// transferred, so history accumulates. OffscreenCanvas is native in the worker AND
// on the main thread, so this renders identically on both (no p5.Graphics, whose
// HTMLCanvasElement instanceof checks are undefined in the worker shim).
let _freq = null
let _wf = null, _wctx = null
function _ensureBuf(w, h) {
  if (_wf && _wf.width === w && _wf.height === h) return
  const old = _wf
  _wf = new OffscreenCanvas(max(1, w), max(1, h))
  _wctx = _wf.getContext('2d')
  if (old && _wctx) { try { _wctx.drawImage(old, 0, 0) } catch (e) {} }
}
function setup() {
  createCanvas(stave.width, stave.height)
  pixelDensity(1); noStroke()
  _ensureBuf(width, height)
}
// Hz from a hap: a written freq, else the pitch the engine read from the note
// (h.midi, Strudel's own note grammar — a sketch cannot import a parser, #1929).
function hapFreq(h) {
  if (typeof h.freq === 'number') return h.freq
  if (typeof h.midi === 'number') return 440 * pow(2, (h.midi - 69) / 12)
  return null
}
function draw() {
  _ensureBuf(width, height)
  const ctx = _wctx
  if (!ctx) { clear(); return }
  if (stave.analyser) {
    const buf = stave.analyser.frequencyBinCount
    if (!_freq || _freq.length !== buf) _freq = new Float32Array(buf)
    const data = _freq
    stave.analyser.getFloatFrequencyData(data)
    const img = ctx.getImageData(0, 0, width, height)
    ctx.clearRect(0, 0, width, height)
    ctx.putImageData(img, -2, 0)
    ctx.fillStyle = '#75baff'
    for (let i = 0; i < buf; i++) {
      const n = constrain((data[i] + 80) / 80, 0, 1)
      if (n <= 0) continue
      ctx.globalAlpha = n
      const yEnd = (log(i + 1) / log(buf)) * height
      const yStart = i > 0 ? (log(i) / log(buf)) * height : 0
      ctx.fillRect(width - 2, height - yEnd, 2, max(2, yEnd - yStart))
    }
    ctx.globalAlpha = 1
  } else if (stave.scheduler) {
    const now = stave.scheduler.now()
    const img = ctx.getImageData(0, 0, width, height)
    ctx.clearRect(0, 0, width, height)
    ctx.putImageData(img, -2, 0)
    const haps = stave.scheduler.query(now - 0.3, now + 0.05)
    for (const h of haps) {
      const freq = hapFreq(h)
      if (freq == null) continue
      if (freq < 20) continue
      const logPos = log(freq / 20) / log(4000 / 20)
      const y = height - logPos * height
      const alpha = max(0.1, 1 - (now - h.begin) / 0.5) * (h.gain ?? 1)
      ctx.fillStyle = h.color ?? '#75baff'
      ctx.globalAlpha = alpha
      ctx.fillRect(width - 2, y - 2, 2, max(4, height * 0.03))
    }
    ctx.globalAlpha = 1
  } else { ctx.clearRect(0, 0, width, height) }
  // Present the persistent buffer to the main canvas (which the worker clears
  // every frame via transferToImageBitmap). drawImage accepts an OffscreenCanvas
  // source on both the worker and the main-thread 2D context.
  clear()
  drawingContext.drawImage(_wf, 0, 0)
}`;

export const SPIRAL_P5_CODE = `// Stave p5 viz — Spiral
function setup() {
  createCanvas(stave.width, stave.height)
  pixelDensity(window.devicePixelRatio || 1)
  noFill()
}
function xySpiral(rot, margin, cx, cy, rotate) {
  const a = ((rot + rotate) * 360 - 90) * PI / 180
  return [cx + cos(a) * margin * rot, cy + sin(a) * margin * rot]
}
function draw() {
  clear()
  if (!stave.scheduler) return
  const now = stave.scheduler.now()
  const haps = stave.scheduler.query(now - 2, now + 1)
  const cx = width / 2, cy = height / 2
  const sz = min(width, height) * 0.38, mg = sz / 3
  for (const h of haps) {
    const active = h.begin <= now && h.end > now
    const from = h.begin - now + 3, to = h.end - now + 3 - 0.005
    const op = max(0, 1 - abs((h.begin - now) / 2))
    const c = color(h.color ?? (active ? '#75baff' : '#8a919966'))
    c.setAlpha(op * 255)
    stroke(c); strokeWeight(mg / 2); strokeCap(ROUND)
    beginShape()
    for (let a = from; a <= to; a += 1/60) {
      const [x, y] = xySpiral(a, mg, cx, cy, now)
      vertex(x, y)
    }
    endShape()
  }
  stroke(255); strokeWeight(mg / 2)
  beginShape()
  for (let a = 2.98; a <= 3; a += 1/60) {
    const [x, y] = xySpiral(a, mg, cx, cy, now)
    vertex(x, y)
  }
  endShape()
}`;

export const PITCHWHEEL_P5_CODE = `// Stave p5 viz — Pitchwheel
const ROOT_FREQ = 440 * pow(2, (36 - 69) / 12)
function setup() {
  createCanvas(stave.width, stave.height)
  pixelDensity(window.devicePixelRatio || 1)
}
function freq2angle(f) { return 0.5 - (log(f / ROOT_FREQ) / log(2) % 1) }
function circPos(cx, cy, r, a) {
  const rad = a * TWO_PI
  return [sin(rad) * r + cx, cos(rad) * r + cy]
}
// Hz from a hap: a written freq, else the pitch the engine read from the note
// (h.midi, Strudel's own note grammar — a sketch cannot import a parser, #1929).
function hapFreq(h) {
  if (typeof h.freq === 'number') return h.freq
  if (typeof h.midi === 'number') return 440 * pow(2, (h.midi - 69) / 12)
  return null
}
function draw() {
  clear()
  if (!stave.scheduler) return
  const now = stave.scheduler.now()
  let haps = stave.scheduler.query(now - 0.01, now + 0.01)
  haps = haps.filter(h => h.begin <= now && h.end > now)
  // u: one unit of the wheel's own size, so marks keep their proportion at any size
  const sz = min(width, height), u = sz / 200, r = sz / 2 - 12 * u
  const cx = width / 2, cy = height / 2
  noStroke(); fill(117, 186, 255, 64)
  for (let i = 0; i < 12; i++) {
    const a = freq2angle(ROOT_FREQ * pow(2, i / 12))
    const [x, y] = circPos(cx, cy, r, a)
    circle(x, y, 7 * u)
  }
  noFill(); stroke(117, 186, 255, 48); strokeWeight(u)
  circle(cx, cy, r * 2)
  for (const h of haps) {
    const freq = hapFreq(h)
    if (freq == null) continue
    const a = freq2angle(freq)
    const [x, y] = circPos(cx, cy, r, a)
    const c = h.color ?? '#75baff'
    stroke(c); strokeWeight(2 * u)
    line(cx, cy, x, y)
    fill(c); noStroke()
    circle(x, y, 12 * u)
  }
}`;

export const WORDFALL_P5_CODE = `// Stave p5 viz — Wordfall (vertical pianoroll with labels)
function setup() {
  createCanvas(stave.width, stave.height)
  pixelDensity(window.devicePixelRatio || 1)
}
function draw() {
  clear()
  if (!stave.scheduler) return
  const now = stave.scheduler.now()
  const CYCLES = 4, PH = 0.5
  const haps = stave.scheduler.query(now - CYCLES * PH, now + CYCLES * (1 - PH))
  const vals = [...new Set(haps.map(h => h.note ?? h.s ?? 0))].sort()
  if (!vals.length) return
  const bw = width / vals.length
  for (const h of haps) {
    const active = h.begin <= now && h.end > now
    const dur = h.end - h.begin
    const yOff = h.begin - now
    const y = height * PH - (yOff / CYCLES) * height
    const dH = (dur / CYCLES) * height
    const v = h.note ?? h.s ?? 0
    const x = vals.indexOf(v) * bw
    noStroke()
    if (active) fill(255)
    else { const c = color(h.color ?? '#75baff'); c.setAlpha(160); fill(c) }
    rect(x + 1, y + 1, bw - 2, dH - 2)
    if (dH > 10 && bw > 16) {
      const label = h.note != null ? String(h.note) : (h.s ?? '')
      textSize(min(bw * 0.55, dH * 0.7, 11))
      textAlign(LEFT, TOP); fill(active ? 0 : 255); noStroke()
      text(label, x + 3, y + 3)
    }
  }
  stroke(255, 255, 255, 128); strokeWeight(1)
  line(0, height * PH, width, height * PH)
}`;

// ── Signal-bus example sketches (Phase 21) ───────────────────────────────────
// Living documentation for the named musical-signal bus. Each sketch names and
// explains the API in comments. Run them over a simple drum pattern, e.g.
//   $: s("bd*4 hh*8").viz("Signals (Spectrum)")
// In p5 every signal lives on `sig` as LIVE NUMBERS/ARRAYS read fresh each draw:
//   sig.kick / sig.snare / …     — per-drum envelope numbers (0..1).
//   sig('bd')                    — a sound's live SignalReading.
//   sig('bd').rms                — a NUMBER (loudness of that sound's own analyser).
//   sig('bd').fft                — a number[] spectrum (32 buckets, each 0..1).
//   sig.fft / sig.bass / sig.rms — the MASTER mix (combined audio).
// (hydra uses the same names but as () => number THUNKS — see SIGNALS_BANDS.)

export const SIGNALS_SPECTRUM_P5_CODE = `// Stave p5 viz — Signals (Spectrum)
// Showcases the named musical-signal bus. Try it over:  s("bd*4 hh*8")
//
// Every signal lives on the 'sig' namespace in p5 — LIVE NUMBERS / ARRAYS,
// refreshed every draw():
//
//   sig('bd')      — the 'bd' (kick) sound's live signals (a SignalReading).
//   sig('bd').fft  — that sound's spectrum: a number[] of 32 buckets, each 0..1
//                    (real audio off the kick's OWN analyser/orbit). [] if muted.
//   sig('bd').rms  — that sound's loudness 0..1. .bass/.mid/.treble also exist.
//   sig.kick       — the kick ENVELOPE, 0..1, bumped on each hit, decaying ~0.92
//                    per frame. sig.snare / sig.hat / sig.clap / sig.tom … are siblings.
//   sig.fft        — the MASTER mix spectrum (combined audio), same shape.
//
// In hydra these same names are () => number THUNKS — see "Signals (Bands)".

function setup() {
  createCanvas(stave.width, stave.height)
  noStroke()
}

function draw() {
  clear()

  // ── Spectrum bars from the kick's own audio: sig('bd').fft is a number[] ────
  // Each bucket is 0..1. We fall back to the master mix (sig.fft) so the demo
  // still moves before any 'bd' has fired its analyser.
  const spectrum = (sig('bd').fft.length ? sig('bd').fft : sig.fft) || []
  const bw = width / Math.max(1, spectrum.length)
  for (let i = 0; i < spectrum.length; i++) {
    const v = spectrum[i]            // 0..1 magnitude for this band
    const h = v * height
    fill(117, 186, 255, 180 + v * 75)
    rect(i * bw, height - h, bw - 1, h)
  }

  // ── A circle pulsed by sig.kick (a live NUMBER 0..1 in p5) ──────────────────
  // sig.kick bumps to ~1 on each kick hit and decays each frame, so the circle
  // punches outward on the beat. (hydra would call it: sig.kick().)
  const base = min(width, height) * 0.18
  const r = base + sig.kick * base * 1.6
  noFill()
  stroke(255, 255, 255, 120 + sig.kick * 135)
  strokeWeight(2 + sig.kick * 4)
  circle(width / 2, height / 2, r * 2)

  // Inner dot brightens with overall loudness (master RMS, a number in p5).
  noStroke()
  fill(255, 255, 255, 60 + sig.rms * 195)
  circle(width / 2, height / 2, base * 0.5)
}`;

export const SIGNALS_BACKDROP_P5_CODE = `// Stave p5 viz — Signals (Backdrop)
// One color band per code block (track). Showcases the per-track side of the
// bus: sig.tracks enumerates the live track keys, and sig.track(id).color is the
// color that block declared in the music via .color() (e.g. in Strudel:
//   $: s("bd*4").color("#f97316")
//   $: s("hh*8").color("#06b6d4")
// ). Each band's brightness follows that track's loudness (rms).

function setup() {
  createCanvas(stave.width, stave.height)
  noStroke()
}

// Parse a "#rrggbb" / "#rgb" hap color into [r,g,b]; null if unparseable.
function parseHex(hex) {
  const s = String(hex).replace('#', '')
  if (s.length === 6) return [parseInt(s.slice(0,2),16), parseInt(s.slice(2,4),16), parseInt(s.slice(4,6),16)]
  if (s.length === 3) return [parseInt(s[0]+s[0],16), parseInt(s[1]+s[1],16), parseInt(s[2]+s[2],16)]
  return null
}

function draw() {
  clear()

  // sig.tracks — the live track keys ('$0','$1',… anonymous, or 'd1','drums'…).
  const tracks = sig.tracks || []
  if (!tracks.length) {
    fill(120); textAlign(CENTER, CENTER); textSize(13)
    text('play a multi-block pattern…', width / 2, height / 2)
    return
  }

  const bandH = height / tracks.length
  for (let i = 0; i < tracks.length; i++) {
    const id = tracks[i]
    const reading = sig.track(id)          // this track's live SignalReading
    // .color — the color this block set with .color() in the music. p5: a value
    // (string|null). Fall back to a neutral blue if the block set none.
    const rgb = parseHex(reading.color) || [117, 186, 255]
    // .rms — this track's loudness 0..1 (own analyser; 0 if silent). Drives the
    // band's brightness so the active block lights up.
    const lvl = reading.rms
    fill(rgb[0], rgb[1], rgb[2], 60 + lvl * 195)
    rect(0, i * bandH, width, bandH)
  }
}`;

