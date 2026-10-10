/**
 * "Sunset Drive" — an original Stave p5 sketch, written for the launch film (#1992).
 * The source of the `Sunset Drive` package on the Library's Viz shelf
 * (see {@link ../vizLibrary}).
 */
export const SUNSET_DRIVE_P5_CODE = `// sunset drive — a car heading for the sun. The kick lights the road,
// the bass swells the sun, the spectrum raises the hills.
const SPEED = 9
const CARS = 1
let road = 0, sunPulse = 0, glow = 0

function setup() {
  createCanvas(stave.width, stave.height, WEBGL)
  perspective(PI / 3, width / height, 10, 9000)
}

function draw() {
  const kick = sig.kick || 0, bass = sig.bass || 0, rms = sig.rms || 0
  const fft = sig.fft || []
  glow = max(kick, glow * 0.88)
  sunPulse = lerp(sunPulse, bass, 0.12)
  road += SPEED + rms * 40
  const t = millis() / 1000

  background(8, 2, 22)
  camera(sin(t * 0.5) * 40, -210, 760, 0, -150, -400, 0, 1, 0)

  // sky
  noStroke()
  beginShape()
  fill(10, 4, 40); vertex(-6000, -3600, -4200); vertex(6000, -3600, -4200)
  fill(255, 60, 150); vertex(6000, 0, -4200); vertex(-6000, 0, -4200)
  endShape(CLOSE)

  // stars
  stroke(255, 240, 255); strokeWeight(2)
  for (let i = 0; i < 70; i++) {
    const a = (i * 97.13) % 1, b = (i * 41.77) % 1
    if (sin(t * 2 + i) > -0.6) point(-3600 + a * 7200, -3300 + b * 2300, -4100)
  }

  // sun, in bands that slide down and thin out
  noStroke()
  const R = 1350 + sunPulse * 380, SUN_Y = -1050
  for (let i = 0; i < 46; i++) {
    const y0 = -R + (i / 46) * 2 * R, y1 = y0 + (2 * R) / 46
    const band = (y0 + R) / (2 * R)
    const gap = band > 0.5 && ((band * 9 + t * 0.35) % 1) < (band - 0.45) * 0.9
    if (gap) continue
    if (y0 + SUN_Y >= 0) continue                                  // the sun stops at the horizon; none of it is under the ground
    const ym = (y0 + y1) / 2, half = sqrt(max(0, R * R - ym * ym))
    fill(255, lerp(235, 60, band), lerp(90, 170, band))
    beginShape()
    vertex(-half, y0 + SUN_Y, -4000); vertex(half, y0 + SUN_Y, -4000)
    vertex(half, min(0, y1 + SUN_Y), -4000); vertex(-half, min(0, y1 + SUN_Y), -4000)
    endShape(CLOSE)
  }

  // the ground: one dark sheet out to the horizon, under the road and the hills, so nothing behind shows through
  noStroke(); fill(10, 3, 28)
  beginShape(); vertex(-6000, 2, 700); vertex(6000, 2, 700); vertex(6000, 2, -4190); vertex(-6000, 2, -4190); endShape(CLOSE)

  // hills on both sides, raised by the spectrum. Each row of the hills answers its own band, and the lift
  // belongs to the row's EDGE, not to the strip: two strips that share an edge use the same heights there,
  // so the hills stay one surface however the spectrum moves
  const step = 220, off = road % step
  const liftAt = r => 0.5 + (fft[(r * 3) % max(1, fft.length)] || 0) * 1.6
  for (const side of [-1, 1]) {
    for (let r = 0; r < 20; r++) {
      const zA = 500 - r * step + off, zB = zA - step
      const liftA = liftAt(r), liftB = liftAt(r + 1)
      stroke(60, 240, 255, 230 - r * 9); strokeWeight(1.5)
      fill(22, 6, 54)
      beginShape(TRIANGLE_STRIP)
      for (let c = 0; c <= 7; c++) {
        const x = side * (400 + c * 260)                             // the hills start at the road's edge
        const rowA = floor((road - off) / step) + r, rowB = rowA + 1
        const hA = c === 0 ? 0 : noise(c * 0.6 + side * 9, rowA * 0.35) * (90 + c * 110) * liftA
        const hB = c === 0 ? 0 : noise(c * 0.6 + side * 9, rowB * 0.35) * (90 + c * 110) * liftB
        vertex(x, -hA, zA); vertex(x, -hB, zB)
      }
      endShape()
    }
  }

  // road grid
  strokeWeight(2)
  for (let x = -400; x <= 400; x += 100) {
    stroke(255, 60, 220, 120 + glow * 135)
    line(x, 0, 600, x, 0, -4000)
  }
  for (let r = 0; r < 22; r++) {
    const z = 600 - r * step + off
    stroke(255, 60 + glow * 160, 220, 200 - r * 8)
    line(-400, 0, z, 400, 0, z)
  }
  // centre dashes
  stroke(255, 240, 120); strokeWeight(4)
  for (let r = 0; r < 22; r++) {
    const z = 600 - r * step + off
    line(0, -1, z, 0, -1, z - 90)
  }

  // the cars, from behind
  for (let n = 0; n < CARS; n++) {
  push()
  translate((n - (CARS - 1) / 2) * 250 + sin(t * 0.9 + n * 2) * (CARS > 1 ? 24 : 70), -glow * 6, 250 - (n % 2) * 260)
  rotateZ(sin(t * 0.9 + 1.2 + n) * 0.03)
  noStroke(); fill(255, 60, 160, 50 + glow * 120)                 // underglow
  push(); translate(0, -3, 0); rotateX(HALF_PI); plane(240 + glow * 50, 380); pop()
  fill(6, 4, 14)                                                  // wheels
  for (const [wx, wz] of [[-92, 110], [92, 110], [-92, -110], [92, -110]]) {
    push(); translate(wx, -20, wz); box(26, 40, 70); pop()
  }
  stroke(60, 240, 255); strokeWeight(1.5); fill(34, 10, 78)       // body
  push(); translate(0, -44, 0); box(184, 34, 330); pop()
  fill(22, 6, 52)                                                 // cabin, narrower at the roof
  beginShape(QUADS)
  const cb = [[-78, -61, 110], [78, -61, 110], [78, -61, -70], [-78, -61, -70]]
  const ct = [[-56, -100, 60], [56, -100, 60], [56, -100, -40], [-56, -100, -40]]
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    vertex(...cb[i]); vertex(...cb[j]); vertex(...ct[j]); vertex(...ct[i])
  }
  vertex(...ct[0]); vertex(...ct[1]); vertex(...ct[2]); vertex(...ct[3])
  endShape()
  noStroke(); fill(90, 200, 255, 150)                             // rear window
  beginShape(); vertex(-66, -66, 111); vertex(66, -66, 111); vertex(49, -95, 68); vertex(-49, -95, 68); endShape(CLOSE)
  fill(255, 40 + glow * 180, 90 + glow * 110)                     // tail lights flash on the kick
  push(); translate(-58, -48, 166); box(52, 10, 3); pop()
  push(); translate(58, -48, 166); box(52, 10, 3); pop()
  fill(255, 240, 120); push(); translate(0, -34, 166); box(40, 8, 3); pop()
  pop()
  }
}
`;
