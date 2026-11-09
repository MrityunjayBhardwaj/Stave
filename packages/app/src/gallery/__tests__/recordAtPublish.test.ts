/**
 * #2487 — recording at publish evaluates the author's own patterns only: a file
 * still held from someone else's gallery entry is never evaluated, and a file
 * that fails is left out without failing the rest.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const evaluated = vi.hoisted(() => [] as string[]);
const allowed = vi.hoisted(() => ({ ids: new Set<string>() }));

vi.mock("@stave/editor", () => ({
  StrudelEngine: class {
    private code = "";
    async init() {}
    async evaluate(code: string) {
      evaluated.push(code);
      this.code = code;
      return code.includes("BROKEN") ? { error: new Error("nope") } : {};
    }
    getTimelineEventsBand(from: number, to: number) {
      const out = [];
      for (let c = Math.max(0, Math.floor(from)); c < to; c++) out.push({ begin: c, end: c + 0.5, s: "bd", trackId: "$0" });
      return out;
    }
  },
  parseStrudel: (code: string) => ({ tag: "Code", code }),
  songEnd: (ir: { code: string }) => (ir.code.includes("arrange") ? { kind: "arranged", cycles: 8 } : { kind: "loop" }),
  analyzeSong: async () => ({ periodCycles: 2, repeatCycles: 2 }),
}));
vi.mock("../../components/musicalTimeline/timelineMarks", () => ({
  collectNoteMarks: (events: Array<{ begin: number; end: number; s: string }>) => ({
    marksByLane: new Map([["$0", events.map((e) => ({ cycle: e.begin, end: e.end, pitch: null, gain: 1, voice: e.s }))]]),
    clipsByLane: new Map([["$0", [{ armIndex: 0, startCycle: 0, endCycle: 4, nameRange: null }, { armIndex: 1, startCycle: 4, endCycle: 8, nameRange: null }]]]),
  }),
}));
vi.mock("../runGate", () => ({ mayEvaluateQuietly: (_p: string, id: string) => allowed.ids.has(id) }));

import { recordEntry } from "../recordAtPublish";
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
