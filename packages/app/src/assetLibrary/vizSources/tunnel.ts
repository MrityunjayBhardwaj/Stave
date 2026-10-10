/**
 * "Tunnel" — an original Stave GLSL sketch, written for the launch film (#1992).
 * The source of the `Tunnel` package on the Library's Viz shelf
 * (see {@link ../vizLibrary}).
 */
export const TUNNEL_GLSL_CODE = `// tunnel — a slow glide down a panelled tunnel.
// Every panel is a meter for its own band of the spectrum, and the kick lights a few outright.
// The small dashes grow and multiply with the treble. The camera nods on each kick like a head
// keeping time; the bass breathes the walls; the rings ride the spectrum.
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

const float SECTORS = 26.0;   // panels around the tunnel
const float SPEED = 1.5;      // tunnel lengths per second
const float TAU = 6.2831853;

// palette: Stave's own violet in a dark tunnel
const vec3 WALL   = vec3(0.085, 0.045, 0.200);  // deep indigo
const vec3 BRUSH  = vec3(0.050, 0.028, 0.110);
const vec3 VIOLET = vec3(0.486, 0.486, 1.000);  // the studio's accent
const vec3 PINK   = vec3(1.000, 0.300, 0.620);
const vec3 LILAC  = vec3(0.800, 0.700, 1.000);  // rings and panel ends
const vec3 CREAM  = vec3(1.000, 0.910, 0.780);  // strips and dashes
const vec3 MINT   = vec3(0.350, 1.000, 0.760);  // the odd dash, and the wires
const vec3 AMBER  = vec3(1.000, 0.600, 0.280);  // a few of the strips

// one tile of the wall: its colour times how brightly it is lit (rgb), from the sector it sits in and the
// place along the tunnel. Lit by its own band of the spectrum; a few by the kick; a few always faintly on.
vec4 tile(float s, float z) {
  s = mod(s, SECTORS);
  float len = 0.5 + 2.2 * hash(vec2(s, 3.0));
  float cz = z / len + hash(vec2(s, 9.0)) * 7.0;
  float c = floor(cz);
  float id = hash(vec2(s, c));
  float band = texture(iChannel0, vec2(0.01 + 0.6 * hash(vec2(s, c + 40.0)), 0.0)).x;
  float e = 1.7 * band * band
          + step(1.0 - (0.05 + 0.14 * uKick), id) * (0.30 + 0.75 * uKick)
          + step(0.70, id) * 0.20;
  vec3 tint = mix(VIOLET, PINK, step(0.5, hash(vec2(c, s + 4.0))));
  return vec4(tint * e, fract(cz));
}

// a thin line at the start of each cell, the same width on screen at any depth
float line(float f, float w) { return 1.0 - smoothstep(w, w * 1.6 + 0.004, min(f, 1.0 - f)); }

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
  float t = iTime;

  // camera: the vanishing point sits right of centre and above it, sways, and bobs like a head
  vec2 eye = vec2(0.78 + 0.09 * sin(t * 0.19), 0.22 + 0.05 * sin(t * 0.27));
  float nod = uKick * uKick * (3.0 - 2.0 * uKick);    // the kick, eased so the nod has weight
  eye.y -= 0.13 * nod;                                // head bob: down on the kick, back up as it fades
  eye.x += 0.035 * sin(t * 3.14159);             // and a sway from side to side, one way per beat
  vec2 p = uv - eye;
  p *= 1.0 - 0.035 * nod;                        // leaning in a little as it nods
  float roll = 0.08 * sin(t * 0.17) + 0.045 * sin(t * 3.14159) * (0.4 + 0.6 * nod);  // the head tilts with the sway
  p = mat2(cos(roll), -sin(roll), sin(roll), cos(roll)) * p;

  float r = length(p);
  float a = atan(p.y, p.x) / TAU + 0.5;          // 0..1 around the tunnel
  float z = 0.55 / max(r, 0.001) + t * SPEED;    // position along the tunnel
  float near = clamp(r * 2.2, 0.0, 1.0);         // detail fades toward the vanishing point

  // panels: one per sector, each with its own length along the tunnel
  float sa = a * SECTORS;
  float sec = floor(sa), fa = fract(sa);
  float len = 0.5 + 2.2 * hash(vec2(sec, 3.0));
  float cz = z / len + hash(vec2(sec, 9.0)) * 7.0;
  float cell = floor(cz), fz = fract(cz);
  float id = hash(vec2(sec, cell));

  // dark steel-blue wall, brushed along the tunnel
  float streak = hash(vec2(floor(a * 1400.0), 1.0));
  float brush = hash(vec2(floor(a * 300.0), floor(z * 2.0)));
  vec3 wall = (WALL * (0.20 + 0.55 * streak) + BRUSH * brush * 0.7) * (0.75 + 0.6 * uBass);
  wall *= 0.75 + 0.5 * hash(vec2(sec, 17.0));
  vec3 col = wall;

  // every tile is a lamp: it glows with its own band of the spectrum, inset from its neighbours by a dark
  // seam, brightest down its middle, and its light spills over the seam onto the tiles beside it
  vec4 t0 = tile(sec, z);
  float inset = smoothstep(0.03, 0.10, fa) * smoothstep(0.03, 0.10, 1.0 - fa)
              * smoothstep(0.015, 0.06, fz) * smoothstep(0.015, 0.06, 1.0 - fz);
  float core = 0.50 + 0.50 * sin(3.14159 * fa);
  float heat = dot(t0.rgb, vec3(0.34));
  col += t0.rgb * inset * core * (0.60 + 0.40 * streak);
  col += vec3(1.0, 0.92, 1.0) * heat * heat * inset * core * core * 0.35;      // the hottest tiles whiten at the core
  vec3 spill = t0.rgb * (1.0 - inset) * 0.55
             + tile(sec - 1.0, z).rgb * exp(-fa * 4.5)
             + tile(sec + 1.0, z).rgb * exp(-(1.0 - fa) * 4.5);
  col += spill * 0.42 * near;

  // rings, close together: each rides a band of the spectrum
  float rz = z * 3.0;
  float ring = floor(rz);
  float band = texture(iChannel0, vec2(0.02 + 0.55 * hash(vec2(ring, 5.0)), 0.0)).x;
  float heavy = step(0.80, hash(vec2(ring, 7.0)));
  float rw = 0.025 + 0.045 * heavy + 0.14 * band * band;
  float gap = step(0.25, hash(vec2(ring, floor(a * 40.0))));          // rings are broken, not solid
  float rl = line(fract(rz), rw) * near * mix(1.0, gap, 0.7);
  col += LILAC * rl * (0.07 + 0.14 * heavy + 0.9 * band);
  col += LILAC * line(fz, 0.03) * 0.14 * near;         // panel end caps

  // greebles: dashes on the panels at two sizes; the treble switches more of them on
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    vec2 g = vec2(a * SECTORS * (5.0 + 9.0 * fk), z * (3.0 + 5.0 * fk));
    vec2 gi = floor(g), gf = fract(g);
    float along = step(0.5, hash(gi + 11.0));                          // lies along the tunnel, or across it
    // each dash listens to its own band: it stretches and brightens with it, and the treble adds more
    float gb = texture(iChannel0, vec2(0.25 + 0.7 * hash(gi + 5.0), 0.0)).x;
    float grow = 0.55 + 0.9 * max(gb, uTreble);
    vec2 half_ = (along > 0.5 ? vec2(0.10, 0.30) : vec2(0.28, 0.12)) * vec2(1.0, grow);
    half_ = min(half_, vec2(0.48));
    float box = step(abs(gf.x - 0.5), half_.x) * step(abs(gf.y - 0.5), half_.y);
    float on = step(1.0 - (0.08 + 0.05 * fk + 0.16 * uTreble), hash(gi));
    vec3 gcol = mix(CREAM, MINT, step(0.7, hash(gi + 23.0)));
    col += gcol * box * on * near * (0.30 + 1.1 * max(gb, uTreble) + 0.25 * uKick);
  }

  // radial ribs between panels: white strips on some seams, hairlines on the rest
  float rib = hash(vec2(sec, 21.0));
  float wide = step(0.60, rib);
  float ribW = mix(0.022, 0.06 + 0.11 * rib, wide);                    // as a share of the sector
  float ribs = (1.0 - smoothstep(ribW, ribW + 0.02 + 0.01 / (r + 0.05), min(fa, 1.0 - fa))) * near;
  float notch = step(0.12, fract(z * (1.5 + 3.0 * rib) + rib * 9.0));  // strips are segmented
  vec3 steel = mix(CREAM, AMBER, 0.7 * step(0.86, rib)) * (0.85 + 0.15 * streak) * (0.95 + 0.45 * uKick);
  col = mix(col, steel, ribs * mix(0.35, 0.92 * notch, wide));
  // a few mint wires
  float wire = step(0.84, hash(vec2(sec, 33.0)));
  float wl = (1.0 - smoothstep(0.012, 0.03 + 0.012 / (r + 0.05), abs(fa - 0.5))) * wire * near;
  col = mix(col, MINT, wl * (0.75 + 0.5 * uKick));

  col *= smoothstep(0.03, 0.75, r);               // the far end stays black
  col *= 1.0 - 0.6 * smoothstep(0.75, 2.1, length(uv));  // and the corners fall away into the dark
  col = col / (1.0 + 0.45 * col);                 // soft shoulder so nothing clips flat
  fragColor = vec4(col, 1.0);
}
`;
