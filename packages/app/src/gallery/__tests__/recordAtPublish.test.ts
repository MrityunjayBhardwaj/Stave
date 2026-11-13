/**
 * #2487 — recording at publish evaluates the author's own patterns only: a file
 * still held from someone else's gallery entry is never evaluated, and a file
 * that fails is left out without failing the rest.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const evaluated = vi.hoisted(() => [] as string[]);
const allowed = vi.hoisted(() => ({ ids: new Set<string>() }));

vi.mock("@stave/editor", async () => {
  // #2590 — the real reader of the tempo a document writes; the engine below is a stand-in
  const actual = await vi.importActual<typeof import("@stave/editor")>("@stave/editor");
  return {
  writtenCps: actual.writtenCps,
  StrudelEngine: class {
    private code = "";
    // like the real engine, one scheduler shared by every file: a file that sets
    // no tempo leaves the previous file's tempo in place (Strudel's default first)
    private cps = 0.5;
    async init() {}
    async evaluate(code: string) {
      evaluated.push(code);
      this.code = code;
      if (code.includes("BROKEN")) return { error: new Error("nope") };
      // the setters run as the code does: the last one wins (a commented one doesn't run)
      for (const line of code.split("\n")) {
        if (line.trim().startsWith("//")) continue;
        for (const m of line.matchAll(/set(cps|cpm)\(([^)]*)\)/g)) {
          const v = m[2] === "tempo" ? 0.7 : Number(new Function(`return (${m[2]})`)());
          this.cps = m[1] === "cpm" ? v / 60 : v;
        }
      }
      return {};
    }
    getCps() {
      return this.cps;
    }
    getTimelineEventsBand(from: number, to: number) {
      const out = [];
      const per = this.code.includes("DENSE") ? 2000 : 1;
      for (let c = Math.max(0, Math.floor(from)); c < to; c++) {
        for (let k = 0; k < per; k++) {
          // SPEEDUP: from cycle 1 the pattern carries a cps of its own (`.cps(1)`)
          const params = this.code.includes("SPEEDUP") && c >= 1 ? { cps: 1 } : undefined;
          out.push({ begin: c + k / per, end: c + (k + 0.5) / per, s: "bd", trackId: "$0", ...(params ? { params } : {}) });
        }
      }
      return out;
    }
  },
  parseStrudel: (code: string) => ({ tag: "Code", code }),
  songEnd: (ir: { code: string }) => (ir.code.includes("arrange") ? { kind: "arranged", cycles: 8 } : { kind: "loop" }),
  analyzeSong: async () => ({ periodCycles: 2, repeatCycles: 2 }),
  };
});
vi.mock("../../components/musicalTimeline/timelineMarks", () => ({
  collectNoteMarks: (events: Array<{ begin: number; end: number; s: string }>) => ({
    marksByLane: new Map([["$0", events.map((e) => ({ cycle: e.begin, end: e.end, pitch: null, gain: 1, voice: e.s }))]]),
    clipsByLane: new Map([["$0", [{ armIndex: 0, startCycle: 0, endCycle: 4, nameRange: null }, { armIndex: 1, startCycle: 4, endCycle: 8, nameRange: null }]]]),
  }),
}));
vi.mock("../runGate", () => ({ mayEvaluateQuietly: (_p: string, id: string) => allowed.ids.has(id) }));

import { recordEntry } from "../recordAtPublish";
import { RECORDING_LIMITS } from "../recording";
import type { GalleryManifest } from "../types";

const manifest: GalleryManifest = {
  schemaVersion: 1,
  project: { name: "p", sharedAt: 1 },
  files: [
    { id: "mine", path: "main.strudel", language: "strudel", content: '$: arrange([4, a], [4, b]) // mine' },
    { id: "loop", path: "loop.strudel", language: "strudel", content: '$: s("bd") // loop' },
    { id: "held", path: "theirs.strudel", language: "strudel", content: '$: s("bd") // STRANGER' },
    { id: "bad", path: "bad.strudel", language: "strudel", content: "BROKEN" },
    { id: "viz", path: "v.hydra", language: "hydra", content: "osc().out()" },
  ],
  fileOrder: {},
  subfolderOrder: {},
};

beforeEach(() => {
  evaluated.length = 0;
  allowed.ids = new Set(["mine", "loop", "bad", "viz"]);
});

describe("recordEntry", () => {
  it("never evaluates a file the run gate holds, and records the others", async () => {
    const rec = (await recordEntry("proj", manifest, "main.strudel"))!;
    expect(evaluated.some((c) => c.includes("STRANGER"))).toBe(false);
    expect(rec.files.map((f) => f.path)).toEqual(["main.strudel", "loop.strudel"]);
    expect(rec.contents).toEqual({ patterns: 4, visuals: 1, other: 0 });
    expect(rec.cover).toBe("main.strudel");
  });

  it("an arrangement is recorded whole, with its sections; a loop for one pass", async () => {
    const rec = (await recordEntry("proj", manifest, "main.strudel"))!;
    const [song, loop] = rec.files;
    expect(song).toMatchObject({ span: "arranged", cycles: 8, lanes: [{ name: "bd" }] });
    expect(song.events).toHaveLength(8);
    expect(song.sections).toEqual([
      [0, 4, "§1"],
      [4, 8, "§2"],
    ]);
    expect(loop).toMatchObject({ span: "loop", cycles: 2 });
  });

  it("the cover is recorded first", async () => {
    await recordEntry("proj", manifest, "loop.strudel");
    expect(evaluated[0]).toContain("// loop");
  });

  it("nothing it may run: the record still says what the entry holds, with no timelines", async () => {
    allowed.ids = new Set();
    const rec = (await recordEntry("proj", manifest, null))!;
    expect(evaluated).toEqual([]);
    expect(rec.files).toEqual([]);
    expect(rec.contents).toEqual({ patterns: 4, visuals: 1, other: 0 });
  });
});

/** A file of its own, recorded alone, with nothing gated. */
async function recordOne(content: string, extra: GalleryManifest["files"] = []) {
  const files = [{ id: "one", path: "one.strudel", language: "strudel", content }, ...extra];
  allowed.ids = new Set(files.map((f) => f.id));
  return (await recordEntry("proj", { ...manifest, files }, "one.strudel"))!;
}

describe("#2590 — the tempo a pattern starts at", () => {
  it("is recorded when the code sets it as a plain number", async () => {
    const rec = await recordOne('setcpm(120/4)\n$: s("bd")');
    expect(rec.files[0].tempo).toEqual({ cps: 0.5, changes: false });
    const cps = await recordOne('setcps(0.6)\n$: s("bd")');
    expect(cps.files[0].tempo).toEqual({ cps: 0.6, changes: false });
  });

  it("is absent when the code sets none, even with the default (0.5) running", async () => {
    const rec = await recordOne('$: s("bd")');
    expect(rec.files[0]).not.toHaveProperty("tempo");
  });

  it("is absent for a file that sets none after one that did (the shared engine still holds that tempo)", async () => {
    const rec = await recordOne('setcps(0.75)\n$: s("bd")', [
      { id: "two", path: "two.strudel", language: "strudel", content: '$: s("hh")' },
    ]);
    expect(rec.files.map((f) => [f.path, f.tempo?.cps ?? null])).toEqual([
      ["one.strudel", 0.75],
      ["two.strudel", null],
    ]);
  });

  it("is absent when the setter's value isn't a plain number", async () => {
    const rec = await recordOne('const tempo = 0.7\nsetcps(tempo)\n$: s("bd")');
    expect(rec.files[0]).not.toHaveProperty("tempo");
  });

  it("a commented-out setter is not a tempo", async () => {
    const rec = await recordOne('// setcps(0.25)\n$: s("bd")');
    expect(rec.files[0]).not.toHaveProperty("tempo");
  });

  it("says it changes when the pattern moves its tempo during the span: the start is kept", async () => {
    const rec = await recordOne('setcps(0.5)\n$: s("bd") // SPEEDUP');
    expect(rec.files[0].tempo).toEqual({ cps: 0.5, changes: true });
  });
});

/** A tiny "WebP": its header, then padding to `bytes`. */
function webp(bytes = 64): string {
  const body = Buffer.alloc(bytes);
  body.write("RIFF", 0, "latin1");
  body.write("WEBPVP8 ", 8, "latin1");
  return `data:image/webp;base64,${body.toString("base64")}`;
}

describe("#2590 — a still for each visual", () => {
  it("keeps one per visual file of the entry, and none for anything else", async () => {
    const frames = [
      { path: "v.hydra", image: webp() },
      { path: "main.strudel", image: webp() }, // not a visual
      { path: "gone.hydra", image: webp() }, // not in the entry
      { path: "v.hydra", image: webp(80) }, // the same visual twice
    ];
    const rec = (await recordEntry("proj", manifest, "main.strudel", frames))!;
    expect(rec.frames).toEqual([{ path: "v.hydra", image: webp() }]);
  });

  it("no stills given: the record has no frames field (as before)", async () => {
    const rec = (await recordEntry("proj", manifest, "main.strudel"))!;
    expect(rec).not.toHaveProperty("frames");
  });

  it("over the record's size cap, the stills go first and the timelines stay", async () => {
    const big = [1, 2].map((i) => ({ id: `d${i}`, path: `d${i}.strudel`, language: "strudel", content: `$: s("bd") // DENSE ${i}` }));
    const visuals = Array.from({ length: 8 }, (_, i) => ({ id: `v${i}`, path: `v${i}.hydra`, language: "hydra", content: "osc().out()" }));
    const m = { ...manifest, files: [...big, ...visuals] };
    allowed.ids = new Set(m.files.map((f) => f.id));
    const frames = visuals.map((v) => ({ path: v.path, image: webp(RECORDING_LIMITS.frameBytes) }));
    const rec = (await recordEntry("proj", m, "d1.strudel", frames))!;
    expect(rec).not.toBeNull();
    expect(rec.files).toHaveLength(2);
    expect(rec).not.toHaveProperty("frames");
    // control: the same stills beside one light pattern fit, so the cap is what dropped them
    const light = { ...manifest, files: [{ id: "l", path: "l.strudel", language: "strudel", content: '$: s("bd")' }, ...visuals] };
    allowed.ids = new Set(light.files.map((f) => f.id));
    const fits = (await recordEntry("proj", light, "l.strudel", frames))!;
    expect(fits.frames).toHaveLength(8);
  });
});
