/**
 * "Night Drive" — an original Stave GLSL sketch, written for the launch film (#1992, #1996).
 * The source of the `Night Drive` package on the Library's Viz shelf
 * (see {@link ../vizLibrary}).
 */
export const NIGHT_DRIVE_GLSL_CODE = `// night_drive — a city at night from the side window of a moving car, through rain on the glass.
// Beyond the glass everything is flat light: a band of out-of-focus city lights drifting past, a wide bar
// of light that crosses on the kick, thin streaks that answer the hi-hats. The car is moving: everything
// slides towards the back of the car, the near lights much faster than the far ones, and now and then a
// street lamp close to the road washes across the whole glass. On the glass, real rain: every drop is a small lens with a
// bright rim, and the running ones leave a beaded track.
const float RAIN  = 0.6;     // how wet the glass is, 0 to 1
const float CITY  = 36.0;    // lights in the city band
const float SPEED = 1.0;     // how fast the city goes by
const float GLOW  = 1.0;     // how bright the whole picture is
const float WIND  = 0.75;    // how far the car's speed pushes the running drops back as they fall

// a city at night
const vec3 RED    = vec3(1.00, 0.20, 0.12);
const vec3 ORANGE = vec3(1.00, 0.48, 0.14);
const vec3 YELLOW = vec3(1.00, 0.86, 0.30);
const vec3 GREEN  = vec3(0.28, 0.92, 0.62);
const vec3 WHITE  = vec3(0.90, 0.93, 1.00);
const vec3 TEAL   = vec3(0.030, 0.095, 0.115);  // the sky, high on the glass
const vec3 EMBER  = vec3(0.060, 0.022, 0.020);  // the road's glow, low on the glass

float h1(float n) { return fract(sin(n * 91.345) * 47453.5453); }
float h2(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
vec3 lamp(float pick) { return pick < 0.30 ? RED : pick < 0.55 ? ORANGE : pick < 0.80 ? YELLOW : pick < 0.92 ? GREEN : WHITE; }

// one light, out of focus: a flat disc, a touch brighter at its rim
float disc(vec2 uv, vec2 at, float r) {
  float d = length(uv - at);
  return smoothstep(r, r * 0.84, d) * (0.70 + 0.30 * smoothstep(r * 0.5, r, d));
}

// everything beyond the glass. \`focus\` is 1 for the blurred world and small inside a drop, which is a lens
vec3 world(vec2 uv, float focus) {
  float t = iTime * SPEED;
  float loud = smoothstep(0.02, 0.30, uRms);
  vec3 col = mix(EMBER, TEAL, smoothstep(-0.45, 0.45, uv.y)) * (0.8 + 0.5 * uBass);
  // the city: a band of small lights high on the glass, sliding back past the window — the far ones barely
  // move, the near ones go by eight times as fast
  for (float i = 0.0; i < CITY; i++) {
    float depth = h1(i * 1.7);
    float x = (fract(h1(i) - t * (0.012 + 0.090 * depth * depth)) - 0.5) * 2.6;
    float y = 0.27 + (h1(i * 5.3) - 0.5) * (0.10 + 0.16 * depth) + 0.05 * sin(x * 2.0 + 1.0);
    float r = (0.010 + 0.034 * depth * depth) * focus + 0.002;
    float twinkle = 0.60 + 0.40 * sin(t * (1.0 + 2.0 * h1(i * 7.1)) + i);
    col += lamp(h1(i * 9.3)) * disc(uv, vec2(x, y), r) * twinkle * (0.20 + 0.34 * (1.0 - depth) + 0.30 * loud);
  }
  // a few big, faint ones close to the lens, top and bottom, that the kick swells
  for (float i = 0.0; i < 5.0; i++) {
    float x = (fract(h1(i + 40.0) - t * (0.11 + 0.06 * h1(i + 50.0))) - 0.5) * 2.8;
    float y = (i < 3.0 ? 0.36 : -0.34) + (h1(i + 60.0) - 0.5) * 0.14;
    col += lamp(h1(i + 70.0)) * disc(uv, vec2(x, y), (0.075 + 0.05 * h1(i + 80.0) + 0.018 * uKick) * (0.35 + 0.65 * focus)) * (0.07 + 0.10 * loud + 0.06 * uKick);
  }
  // long thin trails of light through the city, like a slow shutter
  for (float i = 0.0; i < 3.0; i++) {
    float y = 0.20 + 0.07 * i + 0.012 * sin(uv.x * 3.0 + t * 0.4 + i * 2.0);
    float along = fract(uv.x * 0.35 + t * (0.09 + 0.05 * i) + h1(i + 90.0));
    col += mix(RED, YELLOW, h1(i + 91.0)) * smoothstep(0.004 * focus + 0.0015, 0.0, abs(uv.y - y)) * smoothstep(0.0, 0.5, along) * smoothstep(1.0, 0.8, along) * 0.22;
  }
  // a street lamp close to the road: every few seconds one goes by, a big soft disc high on the glass that
  // throws a wash of amber across everything and is gone in half a second
  for (float i = 0.0; i < 2.0; i++) {
    float turn = fract(t / (3.7 + 2.3 * i) + 0.4 * i), pass = turn / 0.16;
    if (pass > 1.0) continue;
    float x = mix(1.9, -1.9, pass);
    col += ORANGE * 0.22 * disc(uv, vec2(x, 0.40), 0.05 + 0.15 * focus);
    col += mix(ORANGE, YELLOW, 0.3) * 0.085 * exp(-(uv.x - x) * (uv.x - x) / 0.30) * smoothstep(-0.7, 0.5, uv.y);
  }
  // one wide bar of light, leaning, that crosses the glass and flares on the kick
  vec2 lean = normalize(vec2(-0.26, 1.0));
  float across = dot(uv, lean) - (fract(t * 0.045) - 0.5) * 1.5;
  float bar = smoothstep(0.075, 0.068, abs(across));
  float kick = uKick * uKick * (3.0 - 2.0 * uKick);
  col += mix(vec3(0.35, 0.80, 0.85), mix(YELLOW, ORANGE, smoothstep(0.2, 1.1, uv.x)), smoothstep(-0.9, 0.3, uv.x)) * bar * (0.035 + 0.15 * kick);
  // thin teal streaks the other way, on the hi-hats
  vec2 steep = normalize(vec2(1.0, -0.34));
  for (float i = 0.0; i < 3.0; i++) {
    float off = dot(uv, steep) + (fract(h1(i + 20.0) + t * (0.05 + 0.03 * i)) - 0.5) * 2.4;
    float seg = smoothstep(0.42, 0.30, abs(uv.y - (h1(i + 30.0) - 0.5) * 0.4));
    col += vec3(0.25, 0.85, 0.90) * smoothstep(0.006, 0.002, abs(off)) * seg * (0.06 + 0.40 * max(uHat, uTreble));
  }
  return col * GLOW;
}

// the water on the glass: x = how thick it is there (0 on dry glass), y = where a running drop has wiped the mist
vec2 water(vec2 uv, float t) {
  float thick = 0.0, wiped = 0.0;
  // still drops in three sizes, none quite round; each sits a while, dries, and another lands elsewhere.
  // The treble brings out more of the small ones.
  for (float layer = 0.0; layer < 3.0; layer++) {
    float cells = 4.5 + 5.5 * layer;
    vec2 g = uv * cells + layer * 17.3, id = floor(g), f = fract(g) - 0.5;
    float seed = h2(id + layer * 31.0), pace = t * (0.025 + 0.045 * seed) + seed * 9.0;
    float age = fract(pace);
    float there = step(1.0 - RAIN * (0.34 + 0.12 * layer) - 0.12 * uTreble * layer, h2(id + 7.7 + floor(pace)));
    vec2 d = f - (vec2(h2(id + 1.3), h2(id + 2.9)) - 0.5) * 0.55;
    float lumpy = 1.0 + 0.07 * sin(atan(d.y, d.x) * 2.0 + seed * 40.0) + 0.04 * sin(atan(d.y, d.x) * 3.0 + seed * 70.0);
    float size = (0.07 + 0.19 * h2(id + 4.1) * h2(id + 4.1)) * lumpy * smoothstep(0.0, 0.04, age) * smoothstep(1.0, 0.75, age);
    float p = clamp(1.0 - dot(d, d) / max(size * size, 1e-5), 0.0, 1.0);
    thick = max(thick, there * pow(p, 0.65) * (0.55 + 0.45 * size / 0.32));
  }
  // running drops: a heavy head that sticks, lets go, and slides; behind it a track of beads that shrink and dry.
  // The wind of the car's speed pushes them towards the back as they fall, so their tracks lean across the glass.
  vec2 q = vec2(uv.x - WIND * uv.y, uv.y);
  for (float layer = 0.0; layer < 2.0; layer++) {
    float lanes = 6.0 + 5.0 * layer;
    float lane = floor(q.x * lanes), seed = h1(lane + layer * 53.0);
    if (seed > 0.10 + 0.40 * RAIN) continue;
    float fall = t * (0.10 + 0.16 * seed) + seed * 11.0;
    float headY = mix(0.60, -0.60, fract(fall + 0.22 * sin(fall * 6.2831)));
    float x = (fract(q.x * lanes) - 0.5) / lanes - 0.016 * sin(uv.y * 11.0 + seed * 40.0) - (h1(lane + 9.0) - 0.5) * 0.06;
    float up = uv.y - headY;                                             // how far above the head we are
    vec2 d = vec2(x, up * (up > 0.0 ? 0.62 : 1.0));                      // the head is longer above than below
    float size = 0.022 + 0.014 * seed;
    thick = max(thick, pow(clamp(1.0 - dot(d, d) / (size * size), 0.0, 1.0), 0.65));
    float behind = step(0.0, up) * smoothstep(0.50, 0.0, up);
    wiped = max(wiped, behind * smoothstep(size * 0.9, size * 0.4, abs(x)));
    vec2 b = vec2(x + 0.004 * sin(floor(uv.y * 38.0) * 9.0 + seed * 5.0), (fract(uv.y * 38.0) - 0.5) / 38.0);
    float bead = size * 0.36 * behind * step(0.45, h1(floor(uv.y * 38.0) + lane)) * (0.4 + 0.6 * h1(floor(uv.y * 38.0) + lane + 3.0));
    thick = max(thick, 0.7 * pow(clamp(1.0 - dot(b, b) / max(bead * bead, 1e-6), 0.0, 1.0), 0.65));
  }
  return vec2(thick, wiped);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  // the slope of the water bends the view: steep at a drop's edge, flat in its middle, so each drop holds
  // a small picture of the world turned over
  float e = 1.5 / iResolution.y;
  vec2 w = water(uv, iTime);
  vec2 slope = vec2(w.x - water(uv + vec2(e, 0.0), iTime).x, w.x - water(uv + vec2(0.0, e), iTime).x);
  slope = slope / max(1.0, length(slope) / 0.45);
  float wet = smoothstep(0.0, 0.10, w.x);
  // dry glass is misted: the world is out of focus. Water is clear, and a track where a drop has run is half clear.
  vec3 col = world(uv - slope * 0.55, mix(mix(1.0, 0.55, w.y), 0.14, wet));
  col += vec3(0.012, 0.016, 0.020) * (1.0 - wet) * (1.0 - 0.7 * w.y);            // the mist itself
  col *= 1.0 + 0.35 * wet;                                                       // water lets more light through
  col *= 1.0 - 0.30 * wet * smoothstep(0.25, 0.45, length(slope));               // a drop is a little darker where it turns away from us
  vec3 n = normalize(vec3(slope * 3.0, 1.0));
  col += wet * 0.55 * pow(max(0.0, dot(n, normalize(vec3(-0.35, 0.55, 0.75)))), 60.0) * (0.25 + 0.75 * smoothstep(0.0, 0.5, uv.y + 0.5)); // a glint near the top of each
  col += wet * vec3(0.045, 0.060, 0.070) * smoothstep(0.30, 0.45, length(slope)) * smoothstep(0.0, 1.0, -n.y + 0.2);                                          // and a thin bright lower rim
  col *= 1.0 - 0.30 * dot(uv * vec2(0.55, 1.0), uv * vec2(0.55, 1.0));           // the corners of the glass fall away
  fragColor = vec4(pow(col, vec3(0.92)), 1.0);
}
`;
