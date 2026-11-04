/**
 * #2342 — one gate in front of every evaluate of project code.
 *
 * The engine guard is driven through the REAL LiveCodingRuntime, so every path
 * the runtime has to the engine (play, the timeline, the offline bounce, the
 * stems, the live capture, seek, loop) is exercised against it — and a sweep
 * calls every method the runtime has, so a new method that evaluates is caught
 * without anyone remembering to list it here.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { LiveCodingRuntime, type LiveCodingEngine } from "@stave/editor";
import {
  GalleryRunDeclined,
  GalleryRunRefused,
  askBeforeRunning,
  guardProjectEngine,
  isGalleryRunDeclined,
  isGuardedEngine,
  mayEvaluate,
  mayEvaluateQuietly,
  runAfterAsking,
} from "../runGate";
import {
  beginGalleryImport,
  endGalleryImport,
  galleryAuthorToConfirm,
  holdGalleryFiles,
  isGalleryHeld,
  markGalleryFilesUntrusted,
  resetGalleryHoldsForTest,
} from "../safeRun";

beforeEach(() => {
  window.localStorage.clear();
  resetGalleryHoldsForTest();
});

/** Import `fileId` into project `p` from the gallery, as GalleryHost does. */
function importFromGallery(fileId: string, author = "Alice"): void {
  holdGalleryFiles("p", [fileId]);
  markGalleryFilesUntrusted("p", [fileId], author);
}

/** A stand-in engine with every capability the runtime looks for; counts the code it is asked to run. */
function fakeEngine() {
  const ran: string[] = [];
  const blob = new Blob([new Uint8Array(8)]);
  const report = { blob, haps: 1, played: 1, skipped: [] };
  const engine = {
    ran,
    components: { queryable: { scheduler: { now: () => 0 } } },
    init: vi.fn(async () => {}),
    evaluate: vi.fn(async (code: string): Promise<{ error?: Error }> => {
      ran.push(code);
      return {};
    }),
    play: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    setRuntimeErrorHandler: vi.fn(),
    renderLoadedReport: vi.fn(async () => report),
    renderLoadedStemsReport: vi.fn(async () => ({ order: ["a"], stems: { a: { ok: true, ...report } } })),
    record: vi.fn(async () => blob),
    waitUntilQuiet: vi.fn(async () => true),
    setTransportOffset: vi.fn(),
    getTransportOffset: vi.fn(() => 0),
    getLoopRange: vi.fn(() => null),
    setLoopRange: vi.fn(),
  };
  return engine;
}

function runtimeFor(fileId: string, engine = fakeEngine()) {
  const guarded = guardProjectEngine(engine, () => ({ projectId: "p", fileId }));
  const rt = new LiveCodingRuntime(fileId, guarded as unknown as LiveCodingEngine, () => `s("bd") // ${fileId}`);
  return { rt, engine };
}

type Message = { title: string; description: string; confirmLabel: string };
const yes = () => vi.fn(async (_m: Message) => true);
const no = () => vi.fn(async (_m: Message) => false);

describe("the engine guard", () => {
  it("runs your own file's code without asking", async () => {
    const engine = fakeEngine();
    const g = guardProjectEngine(engine, () => ({ projectId: "p", fileId: "mine" }));
    expect(isGuardedEngine(g)).toBe(true);
    expect(await g.evaluate("code")).toEqual({});
    expect(engine.ran).toEqual(["code"]);
  });

  it("refuses an untrusted gallery import without running anything", async () => {
    importFromGallery("f1");
    const engine = fakeEngine();
    const g = guardProjectEngine(engine, () => ({ projectId: "p", fileId: "f1" }));
    const out = await g.evaluate("code");
    expect(out.error).toBeInstanceOf(GalleryRunRefused);
    expect(engine.ran).toEqual([]);
  });

  it("refuses a file that is still held even once it is trusted, until someone runs it", async () => {
    holdGalleryFiles("p", ["f1"]);
    const engine = fakeEngine();
    const g = guardProjectEngine(engine, () => ({ projectId: "p", fileId: "f1" }));
    expect((await g.evaluate("x")).error).toBeInstanceOf(GalleryRunRefused);
    expect(await askBeforeRunning("p", "f1", no())).toBe(true); // nothing to confirm: no question
    expect(await g.evaluate("x")).toEqual({});
    expect(engine.ran).toEqual(["x"]);
  });

  it("reads the project at each evaluate, and wraps only once", async () => {
    importFromGallery("f1");
    let projectId = "other";
    const engine = fakeEngine();
    const g = guardProjectEngine(engine, () => ({ projectId, fileId: "f1" }));
    expect(guardProjectEngine(g, () => ({ projectId: "p", fileId: "f1" }))).toBe(g);
    expect(await g.evaluate("a")).toEqual({});
    projectId = "p";
    expect((await g.evaluate("b")).error).toBeInstanceOf(GalleryRunRefused);
    expect(engine.ran).toEqual(["a"]);
  });
});

describe("asking before running", () => {
  it("asks once per untrusted import; your own files and trusted ones pass silently", async () => {
    importFromGallery("f1", "Alice");
    const ask = yes();
    expect(await askBeforeRunning("p", "mine", ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();

    expect(await askBeforeRunning("p", "f1", ask)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0].description).toContain("This code was written by Alice.");
    expect(ask.mock.calls[0][0].confirmLabel).toBe("Run it");
    // trusted and released: the engine may now run it, and nothing asks again
    expect(mayEvaluate("p", "f1")).toBe(true);
    expect(isGalleryHeld("p", "f1")).toBe(false);
    expect(await askBeforeRunning("p", "f1", ask)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("Cancel leaves the file untrusted and held, and the next run asks again", async () => {
    importFromGallery("f1", "Bob");
    expect(await askBeforeRunning("p", "f1", no())).toBe(false);
    expect(galleryAuthorToConfirm("p", "f1")).toBe("Bob");
    expect(isGalleryHeld("p", "f1")).toBe(true);
    expect(mayEvaluate("p", "f1")).toBe(false);
    const again = yes();
    expect(await askBeforeRunning("p", "f1", again)).toBe(true);
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("runAfterAsking: Cancel rejects with GalleryRunDeclined and never calls run", async () => {
    importFromGallery("f1");
    const run = vi.fn(async () => "rendered");
    const err = await runAfterAsking("p", "f1", no(), run).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GalleryRunDeclined);
    expect(isGalleryRunDeclined(err)).toBe(true);
    expect(isGalleryRunDeclined(new Error("other"))).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(await runAfterAsking("p", "f1", yes(), run)).toBe("rendered");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("background work never asks: the quiet check also holds an import still landing", () => {
    expect(mayEvaluateQuietly("p", "f9")).toBe(true);
    beginGalleryImport();
    expect(mayEvaluateQuietly("p", "f9")).toBe(false);
    // …while the engine guard does not refuse a file of yours that is already playing
    expect(mayEvaluate("p", "f9")).toBe(true);
    endGalleryImport();
    importFromGallery("f1");
    expect(mayEvaluateQuietly("p", "f1")).toBe(false);
  });
});

describe("every runtime path to the engine passes the guard", () => {
  // Each way the runtime can run a file, with the arguments it needs.
  const PATHS: Record<string, (rt: LiveCodingRuntime) => Promise<unknown>> = {
    play: (rt) => rt.play(),
    evaluateForTimeline: (rt) => rt.evaluateForTimeline(),
    bounceOffline: (rt) => rt.bounceOffline(4),
    bounceStemsOffline: (rt) => rt.bounceStemsOffline(4),
    record: (rt) => rt.record(4),
    seekTo: (rt) => rt.seekTo(2),
  };

  for (const [name, call] of Object.entries(PATHS)) {
    it(`${name}: an untrusted import runs nothing; once trusted, it runs`, async () => {
      importFromGallery("f1");
      const { rt, engine } = runtimeFor("f1");
      await call(rt).catch(() => undefined);
      expect(engine.ran, `${name} reached the engine for an untrusted import`).toEqual([]);

      // positive control: the same call DOES reach the engine once the person said yes
      expect(await askBeforeRunning("p", "f1", yes())).toBe(true);
      rt.stop();
      await call(rt).catch(() => undefined);
      expect(engine.ran.length, `${name} never reached the engine even when trusted`).toBeGreaterThan(0);
      rt.dispose();
    });
  }

  it("setLoopRange while playing re-evaluates through the guard", async () => {
    const { rt, engine } = runtimeFor("f2");
    await rt.play(); // your own file, playing
    const before = engine.ran.length;
    importFromGallery("f2"); // (as if the file were swapped for an import under it)
    await rt.setLoopRange({ startCycle: 0, cycles: 2 });
    expect(engine.ran.length).toBe(before);
    // control: trusted again, the same kind of call does re-evaluate
    expect(await askBeforeRunning("p", "f2", yes())).toBe(true);
    await rt.setLoopRange({ startCycle: 1, cycles: 2 });
    expect(engine.ran.length).toBe(before + 1);
    rt.dispose();
  });

  it("calling EVERY runtime method on an untrusted import runs none of its code", async () => {
    importFromGallery("f1");
    const { rt, engine } = runtimeFor("f1");
    const names = Object.getOwnPropertyNames(LiveCodingRuntime.prototype).filter(
      (n) => n !== "constructor" && n !== "dispose" && typeof (rt as unknown as Record<string, unknown>)[n] === "function",
    );
    // a sweep that called nothing would pass vacuously
    expect(names.length).toBeGreaterThan(20);
    for (const n of Object.keys(PATHS)) expect(names).toContain(n);
    const args: Record<string, unknown[]> = {
      setLoopRange: [{ startCycle: 0, cycles: 2 }],
      setAutoRefresh: [true],
    };
    for (const n of names) {
      const fn = (rt as unknown as Record<string, (...a: unknown[]) => unknown>)[n];
      try {
        await Promise.resolve(fn.apply(rt, args[n] ?? [2, undefined, () => {}])).catch(() => undefined);
      } catch {
        /* a method that wants other arguments may throw; what matters is what ran */
      }
    }
    expect(engine.ran, "some runtime method evaluated an untrusted import").toEqual([]);
    rt.dispose();
  });
});
