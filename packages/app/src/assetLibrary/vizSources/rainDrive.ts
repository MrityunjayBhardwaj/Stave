/**
 * "Rain Drive" — an original Stave GLSL sketch, written for the launch film (#1992).
 * The source of the `Rain Drive` package on the Library's Viz shelf
 * (see {@link ../vizLibrary}).
 */
export const RAIN_DRIVE_GLSL_CODE = `// rain_drive — the drive home at night, seen through a wet windscreen.
// Nothing is in focus but the rain: headlights, tail lights and street lamps are soft discs of light,
// and every drop on the glass holds a small, sharp, upside-down picture of them.
// The kick swells the lights nearest to us and touches the brakes of the car ahead; the bass brightens
// the whole road; the treble brings out the fine drops.
const float RAIN   = 0.6;    // how wet the glass is, 0 to 1
const float CARS   = 5.0;    // cars coming the other way
const float LAMPS  = 6.0;    // street lamps along the road
const float SPEED  = 1.0;    // how fast we are driving

// the colours of a real road at night
const vec3 HEAD  = vec3(0.86, 0.90, 1.00);   // headlights, a cold white
const vec3 TAIL  = vec3(1.00, 0.10, 0.08);   // tail lights
const vec3 LAMP  = vec3(1.00, 0.66, 0.30);   // sodium street lamps
const vec3 GREEN = vec3(0.25, 1.00, 0.55);   // a traffic light, far off
const vec3 SKY   = vec3(0.115, 0.095, 0.200); // the last of the dusk, at the top of the glass

const vec2 AHEAD = vec2(0.06, 0.03);         // the point the road runs towards
const float BLUR = 0.050;                    // how far out of focus the world is

float h1(float n) { return fract(sin(n * 91.345) * 47453.5453); }
float h2(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }

// one light, out of focus: a flat disc with a slightly brighter rim, and a faint haze around it
float disc(vec2 uv, vec2 at, float r) {
  float d = length(uv - at);
  float body = smoothstep(r, r * 0.86, d) * (0.72 + 0.28 * smoothstep(r * 0.55, r, d));
  return body + 0.10 * exp(-d * d / (r * r * 9.0));
}

// a light out in the world, at (side, height, distance) from the driver, as it lands on the glass
vec2 onGlass(vec3 w) { return AHEAD + w.xy / w.z; }

// everything beyond the glass. \`focus\` is 1 for the blurred world, and small inside a drop, which acts as a lens
vec3 world(vec2 uv, float focus) {
  vec3 col = SKY * smoothstep(-0.10, 0.62, uv.y) * smoothstep(1.5, 0.2, abs(uv.x));
  float t = iTime * SPEED;
  float blur = BLUR * focus;
  // cars coming the other way: two white discs each, small and dim far off, sweeping out to the left as they pass
  for (float i = 0.0; i < CARS; i++) {
    float ph = fract(t * (0.085 + 0.02 * h1(i + 3.0)) + h1(i) * 7.0);
    float z = 0.85 + 33.0 * pow(1.0 - ph, 2.3);                      // far off for a moment, then a long sweep past
    float seen = smoothstep(0.0, 0.08, ph) * smoothstep(1.0, 0.93, ph);
    float glow = seen * (0.30 + 0.55 * smoothstep(20.0, 2.0, z)) * (0.80 + 0.45 * uBass);
    float r = blur * (0.55 + 0.45 * smoothstep(30.0, 2.0, z)) + 0.045 / z + 0.022 * uKick * smoothstep(9.0, 1.5, z);
    for (float s = -1.0; s < 2.0; s += 2.0)
      col += HEAD * glow * disc(uv, onGlass(vec3(-1.15 + 0.33 * s, -0.36, z)), r);
  }
  // the car ahead: two red discs that drift nearer and farther, and flare with the kick as if it touched the brakes
  for (float i = 0.0; i < 2.0; i++) {
    float z = 2.9 + 5.5 * i + (0.5 + 1.5 * i) * sin(t * (0.21 + 0.07 * i) + i * 2.0);
    float glow = (0.40 + 0.70 * uKick) * (0.85 + 0.30 * uBass) * (1.0 - 0.45 * i);
    float r = blur * 0.85 + 0.05 / z + 0.010 * uKick;
    for (float s = -1.0; s < 2.0; s += 2.0)
      col += TAIL * glow * disc(uv, onGlass(vec3(0.55 + 1.6 * i + 0.36 * s, -0.62, z)), r);
  }
  // street lamps on the right, high up, coming over the top of the glass one after another
  for (float i = 0.0; i < LAMPS; i++) {
    float ph = fract(t * 0.16 + i / LAMPS);
    float z = 1.1 + 29.0 * pow(1.0 - ph, 2.0);
    float seen = smoothstep(0.0, 0.10, ph) * smoothstep(1.0, 0.90, ph);
    float glow = seen * (0.22 + 0.60 * smoothstep(22.0, 2.0, z)) * (0.80 + 0.40 * uBass);
    col += LAMP * glow * disc(uv, onGlass(vec3(2.1, 1.25, z)), blur * 1.05 + 0.07 / z + 0.016 * uKick * smoothstep(8.0, 1.5, z));
  }
  // the town far ahead: small still lights low on the horizon, most of them amber, one or two red or green
  for (float i = 0.0; i < 12.0; i++) {
    vec2 at = AHEAD + vec2((h1(i * 3.1) - 0.5) * 1.9, (h1(i * 5.7) - 0.62) * 0.16);
    float pick = h1(i * 9.3);
    vec3 tint = pick < 0.60 ? LAMP : pick < 0.80 ? HEAD : pick < 0.92 ? TAIL : GREEN;
    float twinkle = 0.55 + 0.45 * sin(t * (0.7 + h1(i)) + i * 4.0);
    col += tint * 0.10 * twinkle * (0.7 + 0.6 * uBass) * disc(uv, at, blur * (0.45 + 0.35 * h1(i * 2.2)));
  }
  return col;
}

// the rain on the glass. Returns xy: which way the glass bends the view there (zero on dry glass),
// and z: how much of a drop is there, 0 to 1
vec3 rain(vec2 uv, float t) {
  vec3 wet = vec3(0.0);
  // still drops, in three sizes; each lives a while, then dries, and another appears elsewhere.
  // The treble brings out more of the small ones.
  for (float layer = 0.0; layer < 3.0; layer++) {
    float cells = 9.0 + 13.0 * layer;
    vec2 g = uv * cells + layer * 17.3, id = floor(g), f = fract(g) - 0.5;
    float seed = h2(id + layer * 31.0);
    float age = fract(t * (0.03 + 0.05 * seed) + seed * 9.0);
    float amount = RAIN * (0.55 + 0.25 * layer) + 0.30 * uTreble * layer;
    float there = step(1.0 - amount, h2(id + 7.7 + floor(t * (0.03 + 0.05 * seed) + seed * 9.0)));
    vec2 at = (vec2(h2(id + 1.3), h2(id + 2.9)) - 0.5) * 0.62;
    float size = (0.10 + 0.20 * h2(id + 4.1)) * smoothstep(0.0, 0.05, age) * smoothstep(1.0, 0.70, age);
    vec2 d = f - at; d.y *= 0.88;
    float m = there * smoothstep(size, size * 0.55, length(d));
    wet = mix(wet, vec3(d / max(size, 0.001), 1.0), m);
  }
  // running drops: a fat head sliding down in fits and starts, wandering a little, leaving a wet track that dries
  for (float layer = 0.0; layer < 2.0; layer++) {
    vec2 g = uv * vec2(7.0 + 5.0 * layer, 1.0);
    float col = floor(g.x), seed = h1(col + layer * 53.0);
    if (seed > 0.25 + 0.55 * RAIN) continue;
    float fall = t * (0.10 + 0.16 * seed) + seed * 11.0;
    float y = fract(fall + 0.25 * sin(fall * 6.2831)) ;                 // it sticks, then lets go
    float headY = mix(0.62, -0.62, y);
    float x = fract(g.x) - 0.5 - 0.22 * sin(uv.y * 9.0 + seed * 40.0) * 0.6 - (h1(col + 9.0) - 0.5) * 0.4;
    vec2 d = vec2(x / (7.0 + 5.0 * layer) * 9.0, (uv.y - headY) * 9.0);
    d.y *= d.y > 0.0 ? 0.55 : 1.0;                                      // a little taller above than below
    float size = 0.34 + 0.20 * seed;
    float head = smoothstep(size, size * 0.5, length(d));
    float track = smoothstep(0.13, 0.03, abs(d.x)) * step(headY, uv.y) * smoothstep(0.45, 0.0, uv.y - headY);
    wet = mix(wet, vec3(d.x * 5.0, 0.0, 0.45), track * 0.6);            // the track it leaves: a thin smear that dries
    wet = mix(wet, vec3(d / size, 1.0), head);
  }
  return wet;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  vec3 wet = rain(uv, iTime);
  // dry glass shows the world as it is, out of focus. A drop is a small lens: it bends the view a long way
  // and turns it over, and through it the lights are nearly sharp.
  vec3 col = mix(world(uv, 1.0), world(uv - wet.xy * 0.34, 0.16) * 1.25, wet.z);
  float edge = wet.z * smoothstep(0.55, 1.0, length(wet.xy));
  col *= 1.0 - 0.55 * edge;                                             // each drop is darker round its edge
  col += wet.z * 0.035 * pow(max(0.0, dot(normalize(wet.xy + 1e-4), vec2(-0.55, 0.83))), 6.0);  // and catches a little light at the top
  col *= 1.0 - 0.35 * dot(uv * vec2(0.55, 1.0), uv * vec2(0.55, 1.0)); // the corners of the glass fall away
  fragColor = vec4(pow(col, vec3(0.92)), 1.0);
}
`;
