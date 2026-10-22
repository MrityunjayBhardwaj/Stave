/**
 * Bundled sketches exactly as they shipped BEFORE a fix (#2021).
 *
 * A project carries its own copy of every bundled sketch, so fixing the bundled
 * source fixes nothing in a project that already exists. A project's copy that
 * still matches one of these BYTE FOR BYTE was never edited by its owner and can be
 * replaced with the fixed sketch; any other copy is somebody's work.
 *
 * ⚠ These are records, not code. Never tidy, reformat or "fix" them: a retired
 * source that no longer matches what shipped matches nobody's project.
 */

/** Pitchwheel until #2021: a fixed 300 x 200 canvas, and marks sized in canvas pixels. */
export const PITCHWHEEL_P5_UNTIL_2021 = `// Stave p5 viz — Pitchwheel
const ROOT_FREQ = 440 * pow(2, (36 - 69) / 12)
function setup() {
  createCanvas(300, 200)
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
  const sz = min(width, height), r = sz / 2 - 12
  const cx = width / 2, cy = height / 2
  noStroke(); fill(117, 186, 255, 64)
  for (let i = 0; i < 12; i++) {
    const a = freq2angle(ROOT_FREQ * pow(2, i / 12))
    const [x, y] = circPos(cx, cy, r, a)
    circle(x, y, 7)
  }
  noFill(); stroke(117, 186, 255, 48); strokeWeight(1)
  circle(cx, cy, r * 2)
  for (const h of haps) {
    const freq = hapFreq(h)
    if (freq == null) continue
    const a = freq2angle(freq)
    const [x, y] = circPos(cx, cy, r, a)
    const c = h.color ?? '#75baff'
    stroke(c); strokeWeight(2)
    line(cx, cy, x, y)
    fill(c); noStroke()
    circle(x, y, 12)
  }
}`;

/** Spiral until #2021: a fixed 300 x 200 canvas. */
export const SPIRAL_P5_UNTIL_2021 = `// Stave p5 viz — Spiral
function setup() {
  createCanvas(300, 200)
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

/** Pitchwheel until the note-pitch change (#1929): its own note-name parser, and the fixed canvas. */
export const PITCHWHEEL_P5_UNTIL_1929 = `// Stave p5 viz — Pitchwheel
const ROOT_FREQ = 440 * pow(2, (36 - 69) / 12)
function setup() {
  createCanvas(300, 200)
  pixelDensity(window.devicePixelRatio || 1)
}
function freq2angle(f) { return 0.5 - (log(f / ROOT_FREQ) / log(2) % 1) }
function circPos(cx, cy, r, a) {
  const rad = a * TWO_PI
  return [sin(rad) * r + cx, cos(rad) * r + cy]
}
// Hz from a hap. Strudel leaves note as a NAME string and freq null until
// superdough renders, so parse the note name to MIDI ourselves (h.freq is null
// here — relying on it leaves every note stuck at the default pitch).
function hapFreq(h) {
  if (typeof h.freq === 'number') return h.freq
  let n = h.note
  if (typeof n === 'string') {
    const m = n.toLowerCase().match(/^([a-g])(b|#)?(-?\\d+)$/)
    if (!m) return null
    const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1]]
    n = (parseInt(m[3]) + 1) * 12 + base + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0)
  }
  if (typeof n !== 'number') return null
  return 440 * pow(2, (n - 69) / 12)
}
function draw() {
  clear()
  if (!stave.scheduler) return
  const now = stave.scheduler.now()
  let haps = stave.scheduler.query(now - 0.01, now + 0.01)
  haps = haps.filter(h => h.begin <= now && h.end > now)
  const sz = min(width, height), r = sz / 2 - 12
  const cx = width / 2, cy = height / 2
  noStroke(); fill(117, 186, 255, 64)
  for (let i = 0; i < 12; i++) {
    const a = freq2angle(ROOT_FREQ * pow(2, i / 12))
    const [x, y] = circPos(cx, cy, r, a)
    circle(x, y, 7)
  }
  noFill(); stroke(117, 186, 255, 48); strokeWeight(1)
  circle(cx, cy, r * 2)
  for (const h of haps) {
    const freq = hapFreq(h)
    if (freq == null) continue
    const a = freq2angle(freq)
    const [x, y] = circPos(cx, cy, r, a)
    const c = h.color ?? '#75baff'
    stroke(c); strokeWeight(2)
    line(cx, cy, x, y)
    fill(c); noStroke()
    circle(x, y, 12)
  }
}`;

/** Pitchwheel as first bundled. */
export const PITCHWHEEL_P5_FIRST = `// Stave p5 viz — Pitchwheel
const ROOT_FREQ = 440 * pow(2, (36 - 69) / 12)
function setup() {
  createCanvas(300, 200)
  pixelDensity(window.devicePixelRatio || 1)
}
function freq2angle(f) { return 0.5 - (log(f / ROOT_FREQ) / log(2) % 1) }
function circPos(cx, cy, r, a) {
  const rad = a * TWO_PI
  return [sin(rad) * r + cx, cos(rad) * r + cy]
}
function draw() {
  background(9, 9, 18)
  if (!stave.scheduler) return
  const now = stave.scheduler.now()
  let haps = stave.scheduler.query(now - 0.01, now + 0.01)
  haps = haps.filter(h => h.begin <= now && h.end > now)
  const sz = min(width, height), r = sz / 2 - 12
  const cx = width / 2, cy = height / 2
  noStroke(); fill(117, 186, 255, 64)
  for (let i = 0; i < 12; i++) {
    const a = freq2angle(ROOT_FREQ * pow(2, i / 12))
    const [x, y] = circPos(cx, cy, r, a)
    circle(x, y, 7)
  }
  noFill(); stroke(117, 186, 255, 48); strokeWeight(1)
  circle(cx, cy, r * 2)
  for (const h of haps) {
    const note = typeof h.note === 'string' ? 60 : (h.note ?? 60)
    const freq = 440 * pow(2, (note - 69) / 12)
    const a = freq2angle(freq)
    const [x, y] = circPos(cx, cy, r, a)
    const c = h.color ?? '#75baff'
    stroke(c); strokeWeight(2)
    line(cx, cy, x, y)
    fill(c); noStroke()
    circle(x, y, 12)
  }
}`;

/** Spiral as first bundled. */
export const SPIRAL_P5_FIRST = `// Stave p5 viz — Spiral
function setup() {
  createCanvas(300, 200)
  pixelDensity(window.devicePixelRatio || 1)
  noFill()
}
function xySpiral(rot, margin, cx, cy, rotate) {
  const a = ((rot + rotate) * 360 - 90) * PI / 180
  return [cx + cos(a) * margin * rot, cy + sin(a) * margin * rot]
}
function draw() {
  background(9, 9, 18)
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
