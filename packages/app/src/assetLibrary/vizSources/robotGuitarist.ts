/**
 * "Robot Guitarist" — an original Stave p5 sketch, written for the launch film (#1992).
 * The source of the `Robot Guitarist` package on the Library's Viz shelf
 * (see {@link ../vizLibrary}).
 */
export const ROBOT_GUITARIST_P5_CODE = `// robot guitarist — a robot in a long black leather coat, black trousers,
// a silver belt. An original robot built from an amplifier. It reads the chord this track is
// playing and frets it; its face is the track's own waveform and its speaker chest pumps on the kick.
// It plays on a stage under a rig of sweeping, flickering lights and strobes, in front of a big screen
// showing it from a camera down in the pit, looking up, to a crowd that bobs on the kick.
// Major and minor triads are held as barre chords on the A string;
// a root and fifth alone is held as a power chord.
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
let chord = null, handAt = 3, ring = 0, bang = 0, lastKey = '', feed = null

function setup() {
  createCanvas(stave.width, stave.height)
  textFont('monospace')
}

// which triad is sounding in this cycle, and how to hold it
function readChord() {
  if (!stave.scheduler) return null
  const now = stave.scheduler.now()
  // the notes struck most recently (a chord keeps its shape through the rests between strums)
  const struck = stave.scheduler.query(now - 1, now + 0.01).filter(h => h.midi != null && h.begin <= now)
  if (!struck.length) return null
  const latest = Math.max(...struck.map(h => h.begin))
  const pcs = new Set(struck.filter(h => h.begin > latest - 0.001).map(h => h.midi % 12))
  for (let root = 0; root < 12; root++) {
    if (!pcs.has(root) || !pcs.has((root + 7) % 12)) continue
    const minor = pcs.has((root + 3) % 12), major = pcs.has((root + 4) % 12)
    const a = (root - 9 + 12) % 12, e = (root - 4 + 12) % 12 // fret of the root on the A and E strings
    // strings low E .. high e; -1 is a muted string
    if (!minor && !major) {
      if (pcs.size !== 2) continue
      const frets = e < a ? [e, e + 2, e + 2, -1, -1, -1] : [-1, a, a + 2, a + 2, -1, -1]
      return { name: NAMES[root] + '5', fret: min(a, e), frets, barre: false }
    }
    return { name: NAMES[root] + (minor ? 'm' : ''), fret: a, frets: [-1, a, a + 2, a + 2, a + (minor ? 1 : 2), a], barre: true }
  }
  return null
}

function draw() {
  // drawn for a 1024 x 512 canvas and scaled to fit, so a canvas of any size shows the whole stage
  if (!(width > 0 && height > 0)) return   // no room yet: a scale of 0 would make the stage endlessly wide
  const K = min(width / 1024, height / 512), W = width / K, H = height / K
  scale(K)
  const kick = sig.kick || 0, treble = sig.treble || 0
  let level = 0 // how loud this track is right now
  let wave = null
  if (stave.analyser) {
    const w = new Uint8Array(256); stave.analyser.getByteTimeDomainData(w)
    wave = w
    for (const v of w) level += (v - 128) * (v - 128)
    level = min(1, sqrt(level / 256) / 40)
  }
  const now = stave.scheduler ? stave.scheduler.now() : millis() / 2000
  const next = readChord()
  if (next) chord = next
  const key = chord ? chord.name : ''
  if (key !== lastKey) { ring = 1; lastKey = key }
  ring = max(ring * 0.9, level)
  bang = max(kick, bang * 0.85)
  if (chord) handAt = lerp(handAt, chord.fret, 0.25)

  // the stage: a big screen at the back, a rig of moving lights overhead, a raised deck
  const STAGE = H - 84
  const SCREEN = { x: 44, y: 22, w: 560, h: 236 }
  noStroke()
  // the deck and its front face, with a strip of lights along the lip
  const deck = () => {
    noStroke(); fill(34, 24, 58); rect(0, STAGE, W, 12)
    fill(18, 13, 34); rect(0, STAGE + 12, W, H - STAGE - 12)
    for (let x = 14; x < W; x += 34) { fill(124, 124, 255, 60 + 150 * (((x / 34 + floor(now * 8)) % 4) < 1 ? 1 : 0.15)); rect(x, STAGE + 15, 14, 3, 1) }
  }
  // the rig: six moving heads that sweep like the real thing, each on its own arc and speed, and each
  // flickering on its own; between them, small strobes that fire in bursts on the kick
  const HUES = [[255, 70, 160], [70, 220, 255], [124, 124, 255], [90, 255, 194], [255, 170, 60], [255, 70, 160]]
  // how far lamp i has swung, and how bright it is this frame; the rig and its picture on the screen both read this
  const lamp = i => {
    const sweep = sin(now * TWO_PI * (0.22 + 0.07 * (i % 3)) + i * 1.9) * (0.55 + 0.12 * (i % 2)) + sin(now * TWO_PI * 0.5 + i) * 0.10
    const waver = noise(i * 9.1, frameCount * 0.06), stutter = noise(i * 3.7 + 50, frameCount * 0.9)
    const out = noise(i * 5.3 + 90, frameCount * 0.11) < 0.20 ? 0.2 : 1
    return { sweep, power: (0.45 + 0.75 * waver) * (0.72 + 0.28 * stutter) * out }
  }
  const strobe = i => bang > 0.55 && noise(i * 7.7, floor(frameCount / 3) * 1.3) > 0.45
  const lights = () => {
    noStroke()
    for (let i = 0; i < 6; i++) {
      const x = 40 + i * 108, hue = HUES[i]
      const { sweep, power } = lamp(i)
      // the head hangs from a pivot on the rig and tilts by \`sweep\`; the beam leaves from its lens, along the
      // way the head points, so the two always agree
      const px = x, py = 9, lx = px + sin(sweep) * 14, ly = py + cos(sweep) * 14
      const tx = lx + tan(sweep) * (STAGE - ly), half = 58 + 30 * abs(sin(sweep))
      fill(hue[0], hue[1], hue[2], (20 + treble * 40 + bang * 30) * power); triangle(lx, ly, tx - half, STAGE, tx + half, STAGE)
      fill(hue[0], hue[1], hue[2], (22 + bang * 26) * power); triangle(lx, ly, tx - half * 0.3, STAGE, tx + half * 0.3, STAGE)   // the hot core
      fill(hue[0], hue[1], hue[2], 60 * power); ellipse(tx, STAGE + 6, half * 2.2, 18)                                        // its pool on the deck
      // p5 turns clockwise for a positive angle (y runs down), which swings a downward lamp to the LEFT;
      // the beam swings right for a positive sweep, so the head is turned by -sweep
      push(); translate(px, py); rotate(-sweep); fill(44, 38, 70); rect(-11, -7, 22, 20, 4); fill(hue[0], hue[1], hue[2], 110 + 145 * power); ellipse(0, 14, 18, 7); pop()
      fill(70, 62, 104); circle(px, py, 7)                                                                                    // the pivot
    }
    for (let i = 0; i < 5; i++) {                                                                                             // strobes
      const fire = strobe(i)
      fill(255, 250, 235, fire ? 255 : 26); rect(84 + i * 108, 3, 20, 6, 2)
      if (fire) { fill(255, 250, 235, 15); triangle(94 + i * 108, 8, 94 + i * 108 - 150, 150, 94 + i * 108 + 150, 150) }
    }
    fill(26, 22, 44); rect(0, 0, 640, 4)
  }

  // the player: a robot built from an amplifier — a screen for a face, a speaker for a chest, and an electric guitar plugged into it
  const swing = sin(now * 4 * TWO_PI)
  const sway = sin(now * TWO_PI) * 7
  const VIOLET = [124, 124, 255], MINT = [90, 255, 194], SHELL = [58, 50, 96], EDGE = [196, 188, 240]
  // drawn from the feet up, so it can be drawn twice: on the deck, and on the screen behind
  const robot = () => {
  const dip = bang * 10
  const LEATHER = [21, 19, 30], SHEEN = [118, 110, 156], SILVER = [204, 210, 224]
  const cxB = sway * 0.7, cyB = -222 + dip                     // where the chest will be
  const hemY = -46, flare = 10 + bang * 12, drift = -sway * 0.9  // the coat's hem swings against the sway and kicks out on the beat
  // the back of the coat, hanging behind the legs to the shins
  stroke(...SHEEN, 150); strokeWeight(2); fill(...LEATHER)
  beginShape(); vertex(cxB - 56, cyB - 70); vertex(cxB + 56, cyB - 70); vertex(74 + flare + drift, hemY); vertex(-74 - flare + drift, hemY); endShape(CLOSE)
  stroke(...SHEEN, 90); strokeWeight(2); line(cxB, cyB + 78, drift, hemY - 4)                 // the vent
  // legs: black trousers over the pistons, heavy boots; the knees give a little on the kick
  for (const side of [-1, 1]) {
    const hipX = side * 26 + sway * 0.3, footX = side * 58
    stroke(...LEATHER); strokeWeight(19); strokeCap(ROUND); line(hipX, -148 + dip, footX - side * 8, -74 + dip * 0.5)
    strokeWeight(15); line(footX - side * 8, -74 + dip * 0.5, footX, -20)
    stroke(...SHEEN, 120); strokeWeight(2); line(hipX + side * 6, -140 + dip, footX - side * 3, -78 + dip * 0.5) // a crease catching the light
    noStroke()
    fill(34, 28, 58); rect(footX - 30, -16, 60, 16, 7)                                        // foot
    fill(...VIOLET); for (let i = -2; i <= 2; i++) rect(footX + i * 11 - 3, -5, 6, 5, 2)      // tread
  }
  // chest: a speaker cabinet; the cone pumps with the kick
  const cx = sway * 0.7, cy = -222 + dip
  stroke(...EDGE); strokeWeight(5); fill(...SHELL); rect(cx - 52, cy - 74, 104, 150, 16)
  noStroke(); fill(22, 18, 40); circle(cx, cy - 22, 70 + bang * 10)
  fill(...VIOLET, 210); circle(cx, cy - 22, 44 + bang * 18)
  fill(22, 18, 40); circle(cx, cy - 22, 16 + bang * 8)
  for (let i = -1; i <= 1; i++) { fill(i === 0 ? MINT[0] : 255, i === 0 ? MINT[1] : 96, i === 0 ? MINT[2] : 150, 120 + treble * 135); circle(cx + i * 22, cy + 56, 9) } // three lamps, lit by the treble
  // the front of the coat: two panels hanging open over the speaker, lapels, a stand-up collar
  for (const side of [-1, 1]) {
    stroke(...SHEEN, 170); strokeWeight(2); fill(...LEATHER)
    beginShape()
    vertex(cx + side * 60, cy - 80); vertex(cx + side * 26, cy - 80); vertex(cx + side * 40, cy + 74)
    vertex(side * 30 + drift, hemY + 2); vertex(side * (76 + flare) + drift, hemY + 2); vertex(cx + side * 62, cy + 30)
    endShape(CLOSE)
    noStroke(); fill(40, 36, 56); beginShape(); vertex(cx + side * 26, cy - 80); vertex(cx + side * 52, cy - 74); vertex(cx + side * 34, cy - 4); endShape(CLOSE) // lapel
    stroke(...SHEEN, 150); strokeWeight(2); noFill(); line(cx + side * 40, cy + 74, side * 30 + drift, hemY)                                    // the coat's edge
    line(cx + side * 58, cy - 70, cx + side * 60, cy + 26)
    noStroke(); fill(...LEATHER); beginShape(); vertex(cx + side * 22, cy - 78); vertex(cx + side * 50, cy - 82); vertex(cx + side * 44, cy - 104); endShape(CLOSE) // collar
  }
  // the belt: silver, with a buckle that catches the light on the kick
  const beltY = cy + 26
  noStroke(); fill(...SILVER); rect(cx - 50, beltY, 100, 12, 3)
  fill(120, 126, 142); for (let i = -4; i <= 4; i++) if (abs(i) > 1) circle(cx + i * 10, beltY + 6, 3)
  fill(232 + bang * 23, 236 + bang * 19, 245); stroke(120, 126, 142); strokeWeight(2); rect(cx - 13, beltY - 5, 26, 22, 4)
  noStroke(); fill(...LEATHER); rect(cx - 6, beltY + 1, 12, 10, 2)
  // head: a little monitor on a spring neck; its face is this track's own waveform
  const hx = sway * 1.5, hy = -352 + dip - bang * 14
  stroke(120, 112, 170); strokeWeight(6); noFill()
  beginShape(); for (let i = 0; i <= 6; i++) vertex(lerp(cx, hx, i / 6) + (i % 2 ? 7 : -7), lerp(cy - 76, hy + 38, i / 6)); endShape()
  stroke(...EDGE); strokeWeight(5); fill(...SHELL); rect(hx - 50, hy - 38, 100, 76, 14)
  noStroke(); fill(12, 10, 26); rect(hx - 39, hy - 27, 78, 54, 8)
  fill(...MINT); circle(hx - 60, hy - 6, 13); fill(255, 96, 150); circle(hx + 60, hy - 6, 13)  // a knob on each side
  stroke(...MINT); strokeWeight(3); noFill()
  beginShape()
  for (let i = 0; i <= 24; i++) {
    const v = wave ? (wave[i * 10] - 128) / 128 : 0
    vertex(hx - 32 + i * (64 / 24), hy + 4 + v * 60 * sin((i / 24) * PI) - sin((i / 24) * PI) * (5 + bang * 9)) // rests as a smile
  }
  endShape()
  noStroke(); fill(...MINT); rect(hx - 22, hy - 17, 12, 5 + bang * 5, 2); rect(hx + 10, hy - 17, 12, 5 + bang * 5, 2) // eyes
  // an electric guitar, slung low at the thigh so the belt shows, and plugged into the robot's own chest
  const bx = -30 + sway * 0.4, by = -104 + dip
  const nut = { x: 262, y: -300 }, joint = { x: bx + 58, y: by - 30 }
  const ang = atan2(nut.y - joint.y, nut.x - joint.x)
  // the lead: out of the body's jack, drooping, up into the chest
  stroke(20, 16, 36); strokeWeight(5); noFill()
  bezier(bx - 58, by + 26, bx - 120, by + 120 + bang * 10, cx - 110, cy + 110, cx - 52, cy + 40)
  noStroke(); fill(...MINT); circle(cx - 52, cy + 40, 11)
  // neck: dark fingerboard, bright frets, a pointed headstock with six tuners
  stroke(34, 26, 52); strokeWeight(14); strokeCap(SQUARE); line(joint.x, joint.y, nut.x, nut.y)
  stroke(...EDGE); strokeWeight(2)
  for (let f = 1; f <= 12; f++) {
    const k = (1 - Math.pow(2, -f / 12)) * 1.9 // real fret spacing, squeezed onto the neck
    if (k <= 1) line(lerp(nut.x, joint.x, k) - 3, lerp(nut.y, joint.y, k) - 7, lerp(nut.x, joint.x, k) + 3, lerp(nut.y, joint.y, k) + 7)
  }
  push(); translate(nut.x, nut.y); rotate(ang)
  noStroke(); fill(26, 20, 44); beginShape(); vertex(-4, -9); vertex(52, -15); vertex(66, 2); vertex(40, 11); vertex(-4, 9); endShape(CLOSE)
  stroke(...MINT); strokeWeight(2); noFill(); beginShape(); vertex(-4, -9); vertex(52, -15); vertex(66, 2); vertex(40, 11); vertex(-4, 9); endShape(CLOSE)
  noStroke(); fill(...EDGE); for (let i = 0; i < 6; i++) circle(6 + i * 8, i % 2 ? 6 : -7, 5)
  pop()
  // body: an angular slab with two horns, an edge that lights on the kick
  push(); translate(bx, by); rotate(ang + 0.10); scale(1.3)
  const body = [[-78, -20], [-58, -50], [-6, -40], [34, -58], [70, -44], [52, -18], [78, 8], [58, 40], [8, 34], [-40, 52], [-80, 26]]
  noStroke(); fill(22, 16, 40); beginShape(); for (const [x, y] of body) vertex(x, y); endShape(CLOSE)
  stroke(255, 60 + bang * 120, 130 + bang * 80); strokeWeight(4 + bang * 3); noFill(); beginShape(); for (const [x, y] of body) vertex(x, y); endShape(CLOSE)
  noStroke(); fill(...VIOLET, 70 + bang * 110); beginShape(); vertex(-52, -30); vertex(-8, -24); vertex(20, -6); vertex(0, 22); vertex(-44, 30); vertex(-62, 6); endShape(CLOSE) // scratchplate
  fill(...EDGE); rect(-34, -13, 12, 30, 3); rect(-6, -13, 12, 30, 3)                           // two pickups
  fill(12, 10, 26); for (let i = 0; i < 6; i++) { circle(-28, -9 + i * 4.4, 2.5); circle(0, -9 + i * 4.4, 2.5) }
  fill(...EDGE); rect(-64, -12, 8, 28, 2)                                                      // bridge
  fill(...MINT); circle(-58, 34, 9); fill(255, 96, 150); circle(-42, 40, 9)                    // two knobs
  stroke(...EDGE); strokeWeight(3); noFill(); line(-62, 18, -92 + swing * 3, 30 + bang * 8)    // the bar, shoved on the kick
  pop()
  // strings: lit, shivering when a chord rings, and throwing sparks when it is struck
  for (let i = -2; i <= 3; i++) {
    stroke(MINT[0] + ring * 120, 255, MINT[2] + ring * 40, 150 + ring * 105); strokeWeight(1.2 + ring * 0.8)
    const o = (i - 0.5) * 2.2
    line(bx - 50, by + 12 + o + sin(frameCount * 1.7 + i) * ring * 3.5, nut.x, nut.y + o * 0.8)
  }
  if (ring > 0.35) {
    noStroke()
    for (let i = 0; i < 9; i++) {
      const q = (frameCount * 0.07 + i * 0.37) % 1, d = 18 + q * 64 * ring, th = i * 2.4 + frameCount * 0.03
      fill(i % 2 ? 255 : MINT[0], i % 2 ? 230 : 255, i % 2 ? 120 : MINT[2], 255 * (1 - q) * ring)
      rect(bx - 20 + cos(th) * d, by + sin(th) * d * 0.7, 4, 4)
    }
  }
  // arms: jointed tubes ending in a clamp. The fretting clamp slides to the chord's fret
  const arm = (x0, y0, mx, my, x1, y1) => {
    stroke(...LEATHER); strokeWeight(17); strokeCap(ROUND); noFill(); line(x0, y0, mx, my); line(mx, my, lerp(mx, x1, 0.82), lerp(my, y1, 0.82)) // the sleeve
    stroke(...SHEEN, 130); strokeWeight(2); line(x0 + 3, y0 - 5, mx + 3, my - 5)
    stroke(...SILVER); strokeWeight(5); const ux = lerp(mx, x1, 0.80), uy = lerp(my, y1, 0.80), ex = lerp(mx, x1, 0.86), ey = lerp(my, y1, 0.86); line(ux, uy, ex, ey) // a silver cuff
    stroke(...EDGE); strokeWeight(7); line(ex, ey, x1, y1)                                      // the wrist, bare metal
    noStroke()
    fill(...SHELL); stroke(...EDGE); strokeWeight(3); rect(x1 - 11, y1 - 9, 22, 18, 5)         // clamp
  }
  const kf = min(1, (1 - Math.pow(2, -handAt / 12)) * 1.9)
  const fx = lerp(nut.x, joint.x, kf), fy = lerp(nut.y, joint.y, kf)
  arm(cx + 50, cy - 50, (cx + 50 + fx) / 2 + 14, max(cy - 50, fy) + 46, fx, fy)
  const sx = bx + 6 + swing * 4, sy = by + swing * 26
  arm(cx - 50, cy - 50, cx - 96, cy + 12, sx, sy)
  }

  // the camera feed for the big screen. The robot is drawn once, flat, on a cleared corner of the canvas and
  // kept as a picture, so it can be laid on the screen in strips that narrow towards his head
  const SRC = { w: 500, h: 420, ox: 165, oy: 416, k: 1.2 }  // drawn a little large, so the close-up stays sharp
  const cv = drawingContext.canvas, dens = cv.width / W
  clear()
  push(); scale(SRC.k); translate(SRC.ox, SRC.oy); robot(); pop()
  const fw0 = ceil(SRC.w * SRC.k * dens), fh0 = ceil(SRC.h * SRC.k * dens)
  if (!feed || feed.width !== fw0 || feed.height !== fh0) { feed = new OffscreenCanvas(fw0, fh0); feed.pen = feed.getContext('2d') }
  feed.pen.clearRect(0, 0, feed.width, feed.height); feed.pen.drawImage(cv, 0, 0, feed.width, feed.height, 0, 0, feed.width, feed.height)
  background(10, 7, 20)

  // the big screen: a camera down in the pit, looking up at him on the stage
  noStroke(); fill(30, 26, 52); rect(SCREEN.x - 8, SCREEN.y - 8, SCREEN.w + 16, SCREEN.h + 16, 8)
  fill(14, 10, 30); rect(SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h)
  drawingContext.save(); drawingContext.beginPath(); drawingContext.rect(SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h); drawingContext.clip()
  // a hand-held camera: it drifts, and pushes in on the kick, about the spot where he stands
  const camX = SCREEN.x + SCREEN.w * 0.33, floorY = SCREEN.y + SCREEN.h
  push(); translate(camX + sin(now * TWO_PI * 0.25) * 9, floorY); scale(1 + 0.02 * sin(now * TWO_PI * 0.5) + 0.04 * bang); translate(-camX, -floorY)
  // the rig, seen from underneath: its truss high in the picture, every lamp a glare, the beams fanning down past the lens
  const TRUSS = SCREEN.y + 20
  noStroke(); fill(40, 34, 66); rect(SCREEN.x - 40, TRUSS - 5, SCREEN.w + 80, 4); rect(SCREEN.x - 40, TRUSS + 3, SCREEN.w + 80, 2)
  for (let i = 0; i < 6; i++) {
    const { sweep, power } = lamp(i), hue = HUES[i]
    const lx = SCREEN.x + 46 + i * 94, facing = 1 - min(1, abs(sweep) * 1.4)                    // brightest when it swings across the lens
    const tx = lx + tan(sweep) * 330
    fill(hue[0], hue[1], hue[2], (26 + treble * 40 + bang * 34) * power); triangle(lx, TRUSS + 4, tx - 150, floorY + 60, tx + 150, floorY + 60)
    fill(hue[0], hue[1], hue[2], (24 + bang * 30) * power); triangle(lx, TRUSS + 4, tx - 44, floorY + 60, tx + 44, floorY + 60)
    fill(hue[0], hue[1], hue[2], 70 * power); circle(lx, TRUSS + 4, 30 + 46 * facing)           // the glare
    fill(255, 250, 240, (120 + 135 * facing) * power); circle(lx, TRUSS + 4, 7 + 9 * facing)    // the lamp itself
  }
  for (let i = 0; i < 5; i++) if (strobe(i)) { fill(255, 250, 235, 230); rect(SCREEN.x + 84 + i * 94, TRUSS - 4, 18, 5, 2); fill(255, 250, 235, 26); circle(SCREEN.x + 93 + i * 94, TRUSS, 90) }
  for (let r = 0; r < 4; r++) { fill(150, 140, 255, 15 + bang * 9); ellipse(camX + 10, floorY - 70, 470 - r * 90, 380 - r * 70) } // haze, lit from behind him, so the black coat has an edge
  // him, from the waist up: looking up from below, he is widest at the belt and narrows towards the head
  const RISE = 1.15, STRIPS = 105, cut = SRC.h / STRIPS, WAIST = 0.38       // the share of his height that falls below the picture
  const near = j => 1 / (1 + RISE * (j + 0.5) / STRIPS), rise = j => cut * Math.pow(near(j), 1.2)
  let above = 0, below = 0; for (let j = 0; j < STRIPS; j++) if (j < WAIST * STRIPS) below += rise(j); else above += rise(j)
  const zoom = (SCREEN.h - 8) / above
  const pen = drawingContext
  for (let j = 0, y = floorY + below * zoom; j < STRIPS; j++) {                                 // from the boots up; the legs fall outside the screen
    const dh = rise(j) * zoom
    y -= dh
    if (y > floorY + 12) continue
    pen.drawImage(feed, 0, (SRC.h - (j + 1) * cut) * SRC.k * dens, feed.width, cut * SRC.k * dens, camX - SRC.ox * zoom * near(j), y, SRC.w * zoom * near(j), dh + 0.7)
  }
  pop()
  noStroke(); for (let y = SCREEN.y; y < SCREEN.y + SCREEN.h; y += 4) { fill(0, 0, 0, 46); rect(SCREEN.x, y, SCREEN.w, 1.5) }  // the screen's own lines
  fill(255, 255, 255, 10 + 26 * noise(frameCount * 0.4)); rect(SCREEN.x, SCREEN.y + ((frameCount * 3) % SCREEN.h), SCREEN.w, 10) // a bar rolling down it
  fill(255, 60, 90, 150 + 105 * (floor(now * 2) % 2)); circle(SCREEN.x + 20, SCREEN.y + 18, 10); fill(255); textSize(14); textAlign(LEFT); text('LIVE', SCREEN.x + 32, SCREEN.y + 23)
  drawingContext.restore()
  // then the lights, the deck, and the robot himself, small against his own picture
  lights(); deck()
  push(); translate(330, STAGE); scale(0.52); robot(); pop()

  // the fretboard, close up: nut on the left, high e on top
  const X0 = 640, X1 = 990, Y0 = 150, GAP = 42
  const first = chord && chord.fret > 3 ? chord.fret - 1 : 1
  const fw = (X1 - X0) / 5
  noStroke(); fill(0); rect(X0, Y0 - 22, X1 - X0, GAP * 5 + 44, 6)
  stroke(210, 200, 180); strokeWeight(first === 1 ? 9 : 3); line(X0, Y0 - 22, X0, Y0 + GAP * 5 + 22)
  strokeWeight(3)
  for (let i = 1; i <= 5; i++) line(X0 + i * fw, Y0 - 22, X0 + i * fw, Y0 + GAP * 5 + 22)
  noStroke(); fill(170, 160, 190); textSize(15); textAlign(CENTER)
  for (let i = 0; i < 5; i++) text(first + i, X0 + (i + 0.5) * fw, Y0 + GAP * 5 + 46)
  for (let sN = 0; sN < 6; sN++) {                               // sN 0 = low E
    const y = Y0 + (5 - sN) * GAP
    const live = chord && chord.frets[sN] >= 0
    stroke(live ? 255 : 120, live ? 235 : 110, live ? 170 : 110); strokeWeight(3.2 - sN * 0.25)
    noFill(); beginShape()
    for (let x = X0; x <= X1; x += 8) vertex(x, y + (live ? sin((x - X0) * 0.05 + frameCount * 1.3 + sN) * ring * 5 * sin(((x - X0) / (X1 - X0)) * PI) : 0))
    endShape()
  }
  if (chord) {
    // the barre (if there is one), then the other fingers
    const bxr = X0 + (chord.fret - first + 0.5) * fw
    if (chord.barre && chord.fret >= first) { noStroke(); fill(70, 220, 255, 230); rect(bxr - 11, Y0 - 12, 22, GAP * 4 + 24, 11) }
    for (let sN = 0; sN < 6; sN++) {
      const y = Y0 + (5 - sN) * GAP, f = chord.frets[sN]
      if (f < 0) { fill(255, 90, 110); noStroke(); textSize(24); text('x', X0 - 20, y + 8); continue }
      if (chord.barre && f === chord.fret) continue
      noStroke(); fill(255, 60, 110); circle(X0 + (f - first + 0.5) * fw, y, 27 + ring * 6)
    }
    textAlign(LEFT); noStroke(); fill(255); textSize(70); text(chord.name, X0, 98)
    fill(170, 160, 190); textSize(20)
    text(chord.frets.map(f => (f < 0 ? 'x' : f)).join(' '), X0 + 150, 91)
  }
  // the audience, in front: two rows of heads bobbing to the kick, hands in the air, a few phones held up
  // now and then somebody takes a photo: every tenth of a second there is a small chance of one flash, from one of them
  const rnd = n => { const v = sin(n * 127.1) * 43758.5453; return v - floor(v) }
  const tick = millis() / 100, shot = floor(tick), snap = rnd(shot) < 0.10 ? { row: floor(rnd(shot + 0.3) * 2), i: floor(rnd(shot + 0.7) * 30) } : null
  let flash = null
  noStroke()
  for (let row = 0; row < 2; row++) {
    const baseY = H - 16 + row * 16, sizeK = 1 + row * 0.25
    for (let i = 0; i < 30; i++) {
      const seed = i * 12.9 + row * 78.2
      const x = (i + 0.5 + (noise(seed) - 0.5) * 0.9) * (W / 29) - 14 + row * 17
      const tall = noise(seed + 4) * 22
      const bob = bang * (7 + noise(seed + 8) * 9) + sin(now * TWO_PI * 2 + seed) * 2
      const y = baseY - tall - bob
      fill(row ? 5 : 9, row ? 3 : 6, row ? 12 : 18)
      ellipse(x, y, 30 * sizeK, 32 * sizeK); rect(x - 20 * sizeK, y + 10, 40 * sizeK, 80, 12)
      noFill(); stroke(150, 130, 230, row ? 50 : 95 + bang * 80); strokeWeight(2); arc(x, y, 30 * sizeK, 32 * sizeK, PI + 0.5, TWO_PI - 0.5); noStroke() // stage light catching the tops of heads
      if (snap && snap.row === row && snap.i === i) flash = { x: x + 12, y: y - 26 }
      const mood = noise(seed + 20)
      if (mood > (x > 610 ? 0.93 : 0.60)) {                                 // an arm up, pumping on the kick (few in front of the chord chart)
        const hand = y - 34 - bang * 20 - noise(seed + 30) * 14, dir = noise(seed + 40) > 0.5 ? 1 : -1
        stroke(row ? 5 : 9, row ? 3 : 6, row ? 12 : 18); strokeWeight(7 * sizeK); line(x + dir * 14, y + 8, x + dir * 20, hand); noStroke()
        if (mood > 0.86) { fill(190, 220, 255, 150 + 105 * noise(seed, frameCount * 0.05)); rect(x + dir * 20 - 5, hand - 12, 10, 15, 2) } // a phone, its screen glowing
        else { fill(row ? 5 : 9, row ? 3 : 6, row ? 12 : 18); circle(x + dir * 20, hand, 11 * sizeK) }
      }
    }
  }
  if (flash) {                                                        // the flash: a hard white point with a brief bloom, gone within a tenth of a second
    const life = 1 - (tick - shot), hot = life * life
    noStroke()
    fill(255, 255, 255, 26 * hot); circle(flash.x, flash.y, 150)
    fill(255, 255, 255, 70 * hot); circle(flash.x, flash.y, 56)
    fill(255, 255, 255, 255 * life); circle(flash.x, flash.y, 13)
    stroke(255, 255, 255, 230 * hot); strokeWeight(2); line(flash.x - 30, flash.y, flash.x + 30, flash.y); line(flash.x, flash.y - 22, flash.x, flash.y + 22)
    noStroke()
  }
}
`;
