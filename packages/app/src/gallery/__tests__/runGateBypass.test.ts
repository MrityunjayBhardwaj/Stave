/**
 * #2342 — no way to run project code may go around the gate.
 *
 * Reads the app's source (not its tests) and lists every call that can run
 * code in an engine: `evaluate`, the offline renders that evaluate their own
 * code, every engine or runtime made, and every runtime call that ends in an
 * evaluate. Each one must be in the table below, with why it is safe. A new
 * caller makes this fail until someone decides how it is gated — and the
 * project engine must be made through `guardProjectEngine`.
 *
 * #2344 — viz files run their code when shown, not through an engine: the
 * preview tab and backdrop (the preview provider), the pop-out, the crop
 * preview, and `.viz("name")` through the named-viz registry. Those calls are
 * listed here too.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../..");

/** What can run code. Optional chaining (`rt?.seekTo?.(…)`) counts too. */
const CALLEES: Record<string, RegExp> = {
  evaluate: /(?:\.|\?\.)evaluate(?:\?\.)?\s*\(/g,
  renderOffline: /\brender(?:Offline|OfflineReport|LoadedReport|LoadedStemsReport|Stems)\s*\(/g,
  newEngine: /\bnew\s+(?:StrudelEngine|SonicPiEngine|DemoEngine)\b/g,
  createEngine: /\bcreateEngine\s*\(/g,
  newRuntime: /\bnew\s+LiveCodingRuntime\b/g,
  evaluateForTimeline: /(?:\.|\?\.)evaluateForTimeline(?:\?\.)?\s*\(/g,
  bounce: /(?:\.|\?\.)bounce(?:Stems)?Offline(?:\?\.)?\s*\(/g,
  seekTo: /(?:\.|\?\.)seekTo(?:\?\.)?\s*\(/g,
  setLoopRange: /(?:\.|\?\.)setLoopRange(?:\?\.)?\s*\(/g,
  runtimePlayOrRecord: /\b(?:rt|runtime|evalRuntime)\s*(?:\.|\?\.)(?:play|record)(?:\?\.)?\s*\(/g,
  // viz code (#2344)
  compileViz: /\b(?:compilePreset|compileHydraCode|compileP5Code|makeHydraRenderer|makeP5Renderer)\s*\(/g,
  mountViz: /\b(?:mountVizRenderer|mountVizPreview)\s*\(/g,
  registerViz: /\b(?:registerPresetAsNamedViz|registerNamedViz)\s*\(/g,
  previewProvider: /\bgetPreviewProviderForLanguage\s*\(/g,
};

/**
 * Every known caller: file → callee → count, and why it is safe. The counts are
 * exact, so a second caller in a known file fails as surely as a new file.
 */
const KNOWN: Record<string, { calls: Record<string, number>; why: string }> = {
  "components/StrudelEditorClient.tsx": {
    calls: {
      createEngine: 1, // wrapped by guardProjectEngine: asserted below
      newRuntime: 1, // gets that guarded engine
      evaluateForTimeline: 1, // quiet: mayEvaluateQuietly, never asks
      bounce: 2, // bounceOffline in bounceAsked + bounceStemsOffline, both inside runAfterAsking
      seekTo: 2, // both inside seekAfterAsking (the fast path and the asked one)
      setLoopRange: 1, // the locator push: re-evaluates only a file already playing
      runtimePlayOrRecord: 4, // handlePlay's start (asked), the live capture (in bounceAsked),
      // and the checkout / write-back re-evaluates of a file already playing
      previewProvider: 1, // wrapped by gatePreviewProvider: the viz preview tab and backdrop
      compileViz: 1, // the pop-out, after askBeforeRunning
      registerViz: 5, // registerAllVizFiles + the save hook (both skip untrusted files),
      // the two bundled presets, and the E2E-only registrar
    },
    why: "the project runtimes: every evaluate goes through the guarded engine",
  },
  "assetLibrary/snippetPreview.ts": {
    calls: { newEngine: 1, evaluate: 2 },
    why: "plays Stave's own built-in Library sketches on an engine of its own; never a project file",
  },
  "gallery/recordAtPublish.ts": {
    calls: { newEngine: 1, evaluate: 1 },
    why: "records what the author's own patterns play at publish (#2487), on an engine of its own; a file still held or waiting on the trust step is skipped (mayEvaluateQuietly, asserted below)",
  },
  "gallery/GalleryPlayer.tsx": {
    calls: { evaluate: 1, compileViz: 1, mountViz: 1 },
    why: "the gallery preview player, which runs inside the sealed sandbox frame (#2328)",
  },
  "e2e/bounceProbe.ts": {
    calls: { evaluate: 4, renderOffline: 7, setLoopRange: 4, seekTo: 1, bounce: 3, runtimePlayOrRecord: 1 },
    why: "browser-test probe; installed only in an E2E build, compiled out of a real one",
  },
  "useVizRefWatcher.ts": {
    calls: { registerViz: 1 },
    why: "re-registers a referenced viz file on edit; skips a gallery file nobody agreed to run",
  },
  "components/CropPopup.tsx": {
    calls: { compileViz: 1, mountViz: 1 },
    why: "the crop preview; the backdrop adapter refuses a gallery file nobody agreed to run",
  },
  "components/StaveApp.tsx": {
    calls: { mountViz: 1 },
    why: "the Library's own built-in viz sketches, never a project file",
  },
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

/** Comments name these calls all the time; only code counts. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** file (relative to src) → callee → count. */
export function scanEvaluateCallers(root = SRC): Record<string, Record<string, number>> {
  const found: Record<string, Record<string, number>> = {};
  for (const file of sourceFiles(root)) {
    const code = stripComments(readFileSync(file, "utf8"));
    const rel = path.relative(root, file).split(path.sep).join("/");
    for (const [callee, re] of Object.entries(CALLEES)) {
      const n = code.match(re)?.length ?? 0;
      if (n > 0) (found[rel] ??= {})[callee] = n;
    }
  }
  return found;
}

describe("no evaluate of project code goes around the gate", () => {
  it("every caller that can run code is a known, gated one", () => {
    const files = sourceFiles(SRC);
    expect(files.length, "the scan read the app's source").toBeGreaterThan(200);
    const found = scanEvaluateCallers();
    const unknown: string[] = [];
    for (const [file, calls] of Object.entries(found)) {
      const known = KNOWN[file]?.calls ?? {};
      for (const [callee, n] of Object.entries(calls)) {
        if (known[callee] !== n) unknown.push(`${file}: ${callee} ×${n} (known ×${known[callee] ?? 0})`);
      }
    }
    for (const [file, { calls }] of Object.entries(KNOWN)) {
      for (const [callee, n] of Object.entries(calls)) {
        if ((found[file]?.[callee] ?? 0) !== n) unknown.push(`${file}: ${callee} expected ×${n}, found ×${found[file]?.[callee] ?? 0}`);
      }
    }
    expect(
      unknown,
      "A call that can run code was added or moved. Route it through gallery/runGate.ts " +
        "(the guarded engine, and askBeforeRunning / runAfterAsking where a person asked for it), then list it in KNOWN.",
    ).toEqual([]);
  });

  it("the project engine is made through guardProjectEngine, and the asking sits around the bounce and the stems", () => {
    const src = stripComments(readFileSync(path.join(SRC, "components/StrudelEditorClient.tsx"), "utf8"));
    expect(src).toMatch(/guardProjectEngine\(\s*provider\.createEngine\(\)/);
    // the mix bounce and the stems each run only inside runAfterAsking
    expect(src).toMatch(/runAfterAsking\([^;]*?\bbounceAsked\(/);
    expect(src).toMatch(/runAfterAsking\([^;]*?\.bounceStemsOffline\(/);
    // bounceAsked is called from nowhere else
    expect(src.match(/\bbounceAsked\(/g)?.length).toBe(1);
    // Play and a seek ask first
    expect(src).toMatch(/askBeforeRunning\(storeProjectId\(\), fileId, askToRun\)/);
    expect(src).toMatch(/function seekAfterAsking[\s\S]*?askBeforeRunning\(/);
  });

  it("recording at publish evaluates only files the run gate lets run quietly (#2487)", () => {
    const rec = stripComments(readFileSync(path.join(SRC, "gallery/recordAtPublish.ts"), "utf8"));
    // the gate is checked, per file, before the one call that evaluates
    expect(rec).toMatch(/if \(!mayEvaluateQuietly\(projectId, f\.id\)\) continue;\s*try \{\s*const rec = await recordPattern\(/);
    expect(rec.match(/\brecordPattern\(/g)).toHaveLength(2); // its definition and that one call
  });

  it("viz code: preview and backdrop are gated, the pop-out asks, registration skips untrusted files", () => {
    const read = (f: string) => stripComments(readFileSync(path.join(SRC, f), "utf8"));
    const client = read("components/StrudelEditorClient.tsx");
    expect(client).toMatch(/gatePreviewProvider\(provider, storeProjectId, askToRun\)/);
    expect(client).toMatch(/askBeforeRunning\([^;]*?\)\.then\(\(ok\) => \{\s*if \(ok\) setPopout\(\{ fileId, descriptor: compilePreset\(/);
    expect(client).toMatch(/const registerAllVizFiles[\s\S]*?mayEvaluateQuietly\([\s\S]*?registerPresetAsNamedViz\(effective, name\)/);
    expect(client).toMatch(/mayEvaluate\([^;]*?file\.id\)\) \{\s*registerPresetAsNamedViz\(preset\)/);
    expect(client).toMatch(/onGalleryRunnableChange\(\(\) => \{ void registerAllVizFiles\(\); \}\)/);
    expect(read("useVizRefWatcher.ts")).toMatch(/mayEvaluateQuietly\(projectId, vizFileId\)\) return;/);
    expect(read("components/CropPopup.tsx")).toMatch(/!mayEvaluate\(projectId, fileId\)\) return null;/);
  });
});
