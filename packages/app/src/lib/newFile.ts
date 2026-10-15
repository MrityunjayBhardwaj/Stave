import { createWorkspaceFile, type WorkspaceFile } from "@stave/editor";
import { showPrompt, showToast } from "../dialogs/host";

/**
 * Map a (lower-cased) file extension to a workspace language. Single source
 * of truth for the set of extensions Stave can create — shared by the file
 * tree (New File button + drag-drop import) and the editor tab-bar "+"
 * (issue #612). Returns null for an unrecognized extension.
 */
export function extensionToLanguage(ext: string): WorkspaceFile["language"] | null {
  switch (ext) {
    case "strudel": return "strudel";
    case "sonicpi":
    case "rb": return "sonicpi";
    case "hydra":
    case "hy": return "hydra";
    case "p5":
    case "p5js":
    case "js": return "p5js";
    case "glsl":
    case "frag":
    case "shader": return "glsl";
    case "md": return "markdown";
    default: return null;
  }
}

/**
 * What a new file starts with (#2076). A visual file starts with a short sketch
 * that already draws, written to its renderer's contract (p5 reads `stave`,
 * Hydra reads `s.a.fft`, GLSL is a ShaderToy `mainImage` reading the
 * `iChannel0` audio texture), so there is something to see and change at once.
 * Other files start empty.
 */
export function starterCodeFor(language: WorkspaceFile["language"]): string {
  switch (language) {
    case "p5js": return P5_STARTER;
    case "hydra": return HYDRA_STARTER;
    case "glsl": return GLSL_STARTER;
    default: return "";
  }
}

const P5_STARTER = `// p5 sketch — a circle that swells with the music.
// Use it from a pattern with .viz("<this file's name>").
let wave = null // one buffer, reused every frame

function setup() {
  createCanvas(stave.width, stave.height)
  noStroke()
}

function draw() {
  clear()
  let level = 0
  if (stave.analyser) {
    if (!wave || wave.length !== stave.analyser.fftSize) wave = new Float32Array(stave.analyser.fftSize)
    stave.analyser.getFloatTimeDomainData(wave)
    for (const v of wave) level = max(level, abs(v))
  }
  fill(237, 34, 93)
  circle(width / 2, height / 2, min(width, height) * (0.2 + level))
}
`;

const HYDRA_STARTER = `// Hydra sketch — stripes that bend with the bass.
// Use it from a pattern with .viz("<this file's name>").
s.osc(10, 0.1, 1.2)
  .rotate(() => s.a.fft[0] * 0.5)
  .modulate(s.noise(2), () => s.a.fft[1] * 0.3)
  .out()`;

const GLSL_STARTER = `// GLSL shader — colours that pulse with the bass.
// iChannel0: row 0 (y = 0.0) is the spectrum, row 1 (y = 1.0) the waveform.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float bass = texture(iChannel0, vec2(0.03, 0.0)).x;
  vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx * 3.0 + vec3(0.0, 2.0, 4.0));
  fragColor = vec4(col * (0.4 + bass), 1.0);
}
`;

/**
 * Prompt the user for a file name and create the file at `folderPath`
 * (root when empty). The single new-file flow behind both the file tree's
 * "New File" button and the editor tab-bar "+" (issue #612) so the two
 * affordances stay byte-for-byte identical — same prompt copy, same
 * supported-extension validation, same toast on an unknown extension.
 */
export async function promptAndCreateFile(folderPath = ""): Promise<void> {
  const name = await showPrompt({
    title: "New file",
    description: "Include an extension — .strudel, .sonicpi, .hydra, .p5, .glsl, or .md.",
    placeholder: "sketch.strudel",
    confirmLabel: "Create",
  });
  if (!name || !name.trim()) return;
  const trimmedName = name.trim();
  const path = folderPath ? `${folderPath}/${trimmedName}` : trimmedName;
  const ext = trimmedName.split(".").pop()?.toLowerCase() ?? "";
  const language = extensionToLanguage(ext);
  if (!language) {
    showToast(
      `Unknown file extension ".${ext}". Supported: .strudel, .sonicpi, .hydra, .p5, .glsl, .md`,
      "error",
    );
    return;
  }
  const id = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  createWorkspaceFile(id, path, starterCodeFor(language), language);
}
