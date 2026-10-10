/**
 * Viz library corpus (#834) — the curated, non-default viz you can ADD to your
 * workspace from the Asset Library. This is deliberately NOT the set of bundled
 * default presets (Piano Roll, scope, …); those already ship in every project.
 * The library is a shelf of opt-in viz *packages*.
 *
 * Each entry is a **package**: a named folder of one or more files. A viz often
 * references its own assets (extra shader passes, textures) from its code, so it
 * always lives in its own folder — even Prism, which is a single `.glsl` today.
 * Adding a package materialises it under a root `viz_lib/<Name>/` folder:
 *
 *   viz_lib/Prism/Prism.glsl
 *   viz_lib/Pulse Grid/Pulse Grid.glsl
 *
 * The `.glsl`/`.p5`/`.hydra` file then auto-registers as a named viz (the
 * workspace-file → named-viz bridge keys off `language`, not path), so
 * `.viz("Prism")` resolves. See {@link ./vizProvider} for the Asset adapter and
 * `StaveApp` for the materialisation + registration.
 *
 * The GLSL sources below were previously seeded into every project by
 * `templates.ts`; they now live here so the library is their single source.
 */

/** The viz languages a package file can be (a subset of `WorkspaceLanguage`).
 *  Kept as local literals so this module — and the provider's tests — stay free
 *  of a runtime `@stave/editor` import (which the app's tests could not load
 *  until #1938). */
import { BAKED_VIZ_THUMBNAILS } from "./vizThumbnails.data";
import { RAIN_DRIVE_GLSL_CODE } from "./vizSources/rainDrive";
import { ROBOT_GUITARIST_P5_CODE } from "./vizSources/robotGuitarist";
import { SUNSET_DRIVE_P5_CODE } from "./vizSources/sunsetDrive";
import { TUNNEL_GLSL_CODE } from "./vizSources/tunnel";

export type VizFileLanguage = "glsl" | "p5js" | "hydra";

/** One file inside a viz package. */
export interface VizLibFile {
  /** Path relative to the package folder, e.g. `"Prism.glsl"`. */
  readonly relPath: string;
  readonly content: string;
  readonly language: VizFileLanguage;
}

/** A curated viz package on the library shelf. */
export interface VizLibItem {
  /** Stable id (kebab-case) — also seeds the workspace-file ids so a second
   *  "add" is idempotent. */
  readonly id: string;
  /** Display name, folder name, and the name the viz registers under
   *  (`.viz("<name>")`), e.g. `"Prism"`. */
  readonly name: string;
  /** The renderer kind — drives the group label / category chip. */
  readonly renderer: "glsl" | "p5" | "hydra";
  /** The files that make up this package. The primary viz file (the one whose
   *  basename matches {@link name}) is what registers as a named viz. */
  readonly files: readonly VizLibFile[];
  /**
   * A baked thumbnail of the running viz — a self-contained `data:image/*` URI.
   * These are captured ONCE, offline, through the compositor-capture harness
   * (`tests/viz-thumbnails.bake.spec.ts`): the shader runs against a real
   * pattern, a representative frame is grabbed, centre-cropped, downscaled, and
   * pasted here. Absent → the provider falls back to a renderer-hued placeholder
   * tile, so a package without a baked frame (e.g. a future user-authored one)
   * still reads as intentional.
   */
  readonly thumbnail?: string;
}

// ── Bundled GLSL example shaders (originally issue #287) ─────────────────
// "Prism" is the classic "Creation" demo by Danilo Guanabara, made
// audio-reactive for Stave, included with author credit. "Pulse Grid" is an
// original Stave shader. Both are single-pass ShaderToy-style `mainImage`.

const PRISM_GLSL_CODE = `// "Prism" — after "Creation" by Danilo Guanabara, made audio-reactive for Stave.
// http://www.pouet.net/prod.php?which=57245
// If you intend to reuse this shader, please add credits to 'Danilo Guanabara'.
// iChannel0: row 0 (y=0.0) = FFT magnitude.
#define t iTime
#define r iResolution.xy

void mainImage( out vec4 fragColor, in vec2 fragCoord ){
    float bass   = texture(iChannel0, vec2(0.03, 0.0)).x;
    float mid    = texture(iChannel0, vec2(0.30, 0.0)).x;
    float treble = texture(iChannel0, vec2(0.65, 0.0)).x;
    vec3 c;
    float l, z = t;
    for (int i = 0; i < 3; i++) {
        vec2 uv, p = fragCoord.xy / r;
        uv = p;
        p -= .5;
        p.x *= r.x / r.y;
        z += .07 + bass * .08;                                  // bass drives the zoom
        l = length(p);
        uv += p / l * (sin(z) + 1.) * abs(sin(l * 9. - z - z))
            * (1. + treble * 1.4);                              // treble ripples the warp
        c[i] = .01 / length(mod(uv, 1.) - .5);
    }
    vec3 col = c / l;
    col = mix(col, col.gbr, mid * .6);                          // mids swirl the hue
    fragColor = vec4(col * (.6 + bass * 1.7), 1.0);             // bass brightens
}
`;

const PULSEGRID_GLSL_CODE = `// "Pulse Grid" — pattern-event reactive cells. An original Stave shader.
// Reacts to PATTERN EVENTS (uKick/uSnare/uHat/uRms), not the raw spectrum.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 g  = uv * vec2(8.0, 5.0);
  vec2 cell = fract(g) - 0.5;
  vec2 id   = floor(g);

  // Per-cell random phase so the grid never pulses uniformly.
  float phase = fract(sin(dot(id, vec2(12.9, 78.2))) * 43758.5);
  float d   = max(abs(cell.x), abs(cell.y));
  float box = smoothstep(0.46, 0.40, d);

  vec3 col = vec3(0.02, 0.02, 0.05);
  col += vec3(1.0, 0.3, 0.2) * uKick  * box * (0.4 + 0.6 * step(id.x, 3.0)); // kick → left red
  col += vec3(0.3, 0.6, 1.0) * uSnare * box * step(2.0, id.y);               // snare → top blue
  col += vec3(1.0)           * uHat   * box * (0.3 + 0.7 * phase);           // hat  → scattered white
  col += box * uRms * 0.25 * (0.5 + 0.5 * sin(iTime * 3.0 + phase * 6.28));  // loudness → breathing
  fragColor = vec4(col, 1.0);
}
`;

/** The curated shelf: the two `#287` GLSL examples, then the four sketches
 *  written for the launch film (#1992) — two GLSL, two p5 — whose sources live
 *  in `./vizSources/`, one module each. Every entry is its own package.
 *  Thumbnails are baked frames of each running viz (`vizThumbnails.data.ts`,
 *  generated by the baker spec); a missing one degrades to a placeholder tile. */
export const VIZ_LIBRARY: readonly VizLibItem[] = [
  {
    id: "prism",
    name: "Prism",
    renderer: "glsl",
    files: [{ relPath: "Prism.glsl", content: PRISM_GLSL_CODE, language: "glsl" }],
    thumbnail: BAKED_VIZ_THUMBNAILS["prism"],
  },
  {
    id: "pulse-grid",
    name: "Pulse Grid",
    renderer: "glsl",
    files: [{ relPath: "Pulse Grid.glsl", content: PULSEGRID_GLSL_CODE, language: "glsl" }],
    thumbnail: BAKED_VIZ_THUMBNAILS["pulse-grid"],
  },
  {
    id: "rain-drive",
    name: "Rain Drive",
    renderer: "glsl",
    files: [{ relPath: "Rain Drive.glsl", content: RAIN_DRIVE_GLSL_CODE, language: "glsl" }],
    thumbnail: BAKED_VIZ_THUMBNAILS["rain-drive"],
  },
  {
    id: "tunnel",
    name: "Tunnel",
    renderer: "glsl",
    files: [{ relPath: "Tunnel.glsl", content: TUNNEL_GLSL_CODE, language: "glsl" }],
    thumbnail: BAKED_VIZ_THUMBNAILS["tunnel"],
  },
  {
    id: "robot-guitarist",
    name: "Robot Guitarist",
    renderer: "p5",
    files: [{ relPath: "Robot Guitarist.p5", content: ROBOT_GUITARIST_P5_CODE, language: "p5js" }],
    thumbnail: BAKED_VIZ_THUMBNAILS["robot-guitarist"],
  },
  {
    id: "sunset-drive",
    name: "Sunset Drive",
    renderer: "p5",
    files: [{ relPath: "Sunset Drive.p5", content: SUNSET_DRIVE_P5_CODE, language: "p5js" }],
    thumbnail: BAKED_VIZ_THUMBNAILS["sunset-drive"],
  },
];

/** Root workspace folder every viz package is materialised under. */
export const VIZ_LIB_ROOT = "viz_lib";

/** A file to write into the workspace when a package is added. */
export interface PlannedVizFile {
  /** Stable workspace-file id — `vizlib_<item>_<relPath>` so re-adding is a
   *  no-op (`seedWorkspaceFile` returns the persisted file for a known id). */
  readonly workspaceId: string;
  /** Full workspace path: `viz_lib/<Name>/<relPath>`. Folders are implicit. */
  readonly path: string;
  readonly content: string;
  readonly language: VizFileLanguage;
  /** True for the package's primary viz file — the one that registers as the
   *  named viz (its basename matches the package name). Helper assets are
   *  false. */
  readonly isPrimary: boolean;
}

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "_");

/** Basename of a package-relative path, minus its extension. */
const baseNameOf = (relPath: string) =>
  relPath.split("/").pop()!.replace(/\.[^.]+$/, "");

/**
 * Pure plan: a viz package → the workspace files to write. The primary viz
 * file is the one whose basename equals the package name (`Prism.glsl` for
 * "Prism"); that's what registers as `.viz("<name>")`. Exported for unit tests
 * and reused by `StaveApp`'s add handler.
 */
export function planVizLibFiles(item: VizLibItem): PlannedVizFile[] {
  return item.files.map((f) => ({
    workspaceId: `vizlib_${item.id}_${sanitize(f.relPath)}`,
    path: `${VIZ_LIB_ROOT}/${item.name}/${f.relPath}`,
    content: f.content,
    language: f.language,
    isPrimary: baseNameOf(f.relPath) === item.name,
  }));
}
