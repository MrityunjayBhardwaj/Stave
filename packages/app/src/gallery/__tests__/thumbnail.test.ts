import { describe, expect, it } from "vitest";

import {
  FRAME_SIZE,
  captureCoverThumbnail,
  captureVisualFrames,
  encodeUnderLimit,
  findLiveVizCanvas,
  findVisualMounts,
  isBlankFrame,
  type CaptureResult,
  type EncodeFn,
} from "../thumbnail";
import { RECORDING_LIMITS } from "../recording";

const px = (...rgba: number[][]) => new Uint8ClampedArray(rgba.flat());

describe("a blank frame", () => {
  it("all transparent or all black is blank; one lit pixel is not", () => {
    expect(isBlankFrame(px([0, 0, 0, 0], [255, 255, 255, 0]))).toBe(true);
    expect(isBlankFrame(px([0, 0, 0, 255], [3, 2, 1, 255]))).toBe(true);
    expect(isBlankFrame(px([0, 0, 0, 255], [0, 40, 0, 255]))).toBe(false);
  });
});

describe("finding the running viz", () => {
  function canvasIn(html: string, w: number, h: number): HTMLCanvasElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const c = host.querySelector("canvas")!;
    c.width = w;
    c.height = h;
    c.getBoundingClientRect = () => ({ width: w, height: h }) as DOMRect;
    return c;
  }

  it("takes the largest viz canvas on screen and ignores canvases that aren't a viz", () => {
    document.body.innerHTML = "";
    canvasIn("<div><canvas></canvas></div>", 2000, 2000); // e.g. the editor's own drawing
    canvasIn('<div data-viz-zone><canvas></canvas></div>', 300, 100);
    const big = canvasIn('<div data-testid="compiled-viz-mount-f1"><canvas></canvas></div>', 800, 600);
    expect(findLiveVizCanvas()).toBe(big);
  });

  it("none when no viz is drawing", () => {
    document.body.innerHTML = "";
    canvasIn('<div data-testid="compiled-viz-mount-f1"><canvas></canvas></div>', 0, 0);
    expect(findLiveVizCanvas()).toBeNull();
  });
});

describe("fitting the picture under the limit", () => {
  const frame = { width: 480, height: 270 } as HTMLCanvasElement;

  it("lowers the quality until the webp fits", async () => {
    const asked: number[] = [];
    const encode: EncodeFn = async (_c, type, q) => {
      asked.push(q!);
      return new Blob([new Uint8Array(q! > 0.6 ? 300 : 100)], { type });
    };
    const blob = await encodeUnderLimit(frame, 200, encode);
    expect(blob?.size).toBe(100);
    expect(asked).toEqual([0.82, 0.65, 0.5]);
  });

  it("a browser without webp gets one png try per size, and nothing when none fits", async () => {
    let calls = 0;
    const encode: EncodeFn = async () => {
      calls++;
      return new Blob([new Uint8Array(500)], { type: "image/png" });
    };
    // a frame already 240 wide is never scaled, so each size encodes it as is
    const small = { width: 240, height: 135 } as HTMLCanvasElement;
    expect(await encodeUnderLimit(small, 200, encode)).toBeNull();
    expect(calls).toBe(3);
  });
});

describe("#2590 — a still of each running visual", () => {
  /** A canvas `w`×`h` inside `html`'s first element, tagged with the file it draws. */
  function canvasIn(html: string, file: string, w: number, h: number): HTMLCanvasElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const c = host.querySelector("canvas")!;
    c.width = w;
    c.height = h;
    c.getBoundingClientRect = () => ({ width: w, height: h }) as DOMRect;
    c.dataset.file = file;
    return c;
  }
  /** A preview tab's or the backdrop's mount for file `id`. */
  const mount = (id: string, w: number, h: number) =>
    canvasIn(`<div data-testid="compiled-viz-mount-${id}"><canvas></canvas></div>`, id, w, h);

  /** Stands in for the copy: "reads" a canvas as its file id, or blank when told. */
  const taken: string[] = [];
  const take = (blank: Set<string> = new Set()) => async (c: HTMLCanvasElement): Promise<CaptureResult> => {
    taken.push(c.dataset.file!);
    return blank.has(c.dataset.file!)
      ? { ok: false, reason: "The running viz read back blank, so there's no thumbnail." }
      : { ok: true, thumbnail: { dataUrl: `data:image/webp;base64,${c.dataset.file}`, bytes: 10, type: "image/webp" } };
  };
  const lang = (path: string) =>
    path.endsWith(".strudel") ? "strudel" : path.endsWith(".p5") ? "p5js" : path.split(".").pop()!;
  const project = (...xs: Array<[string, string]>) => xs.map(([id, path]) => ({ id, path, language: lang(path) }));

  it("each visual file's still comes from its own mount; patterns, other files and visuals not on screen get none", async () => {
    document.body.innerHTML = "";
    taken.length = 0;
    mount("a", 400, 300);
    mount("b", 800, 600); // larger, but another file's: never a's still
    mount("p", 400, 300); // a pattern's id on a mount (can't happen, but must not count)
    mount("hidden", 0, 0); // a visual whose tab isn't showing
    const files = project(["a", "a.hydra"], ["b", "b.p5"], ["p", "p.strudel"], ["hidden", "h.glsl"], ["off", "off.hydra"]);
    const got = await captureVisualFrames(files, document, take());
    expect(got.frames).toEqual([
      { path: "a.hydra", image: "data:image/webp;base64,a" },
      { path: "b.p5", image: "data:image/webp;base64,b" },
    ]);
    expect(got.missed).toEqual([]);
    expect(taken).toEqual(["a", "b"]);
  });

  it("a visual on screen that reads back blank gets no still, and is named as missed with why", async () => {
    document.body.innerHTML = "";
    mount("a", 400, 300);
    const got = await captureVisualFrames(project(["a", "a.hydra"], ["off", "off.p5"]), document, take(new Set(["a"])));
    expect(got.frames).toEqual([]);
    // only the one that was on screen: a visual that isn't running is not "missed"
    expect(got.missed).toEqual([{ path: "a.hydra", reason: "The running viz read back blank, so there's no thumbnail." }]);
  });

  it("at most the record's number of stills", async () => {
    document.body.innerHTML = "";
    const files = Array.from({ length: RECORDING_LIMITS.frames + 3 }, (_, i) => ({ id: `v${i}`, path: `v${i}.hydra`, language: "hydra" }));
    for (const f of files) mount(f.id, 100, 100);
    expect((await captureVisualFrames(files, document, take())).frames).toHaveLength(RECORDING_LIMITS.frames);
  });

  it("a still is small: the record's width and bytes", () => {
    expect(FRAME_SIZE.width).toBe(RECORDING_LIMITS.frameWidth);
    expect(FRAME_SIZE.maxBytes).toBe(RECORDING_LIMITS.frameBytes);
    expect(Math.max(...FRAME_SIZE.widths)).toBeLessThanOrEqual(RECORDING_LIMITS.frameWidth);
  });
});

describe("#2610 — a visual drawn inline by .viz(\"name\")", () => {
  function canvasIn(html: string, file: string, w: number, h: number): HTMLCanvasElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const c = host.querySelector("canvas")!;
    c.width = w;
    c.height = h;
    c.getBoundingClientRect = () => ({ width: w, height: h }) as DOMRect;
    c.dataset.file = file;
    return c;
  }
  const mount = (id: string, w: number, h: number) =>
    canvasIn(`<div data-testid="compiled-viz-mount-${id}"><canvas></canvas></div>`, id, w, h);
  const zone = (name: string, file: string, w: number, h: number) =>
    canvasIn(`<div data-viz-zone data-viz-zone-track="$0" data-viz-zone-id="${name}"><div><canvas></canvas></div></div>`, file, w, h);
  const take = (blank: Set<string> = new Set()) => async (c: HTMLCanvasElement): Promise<CaptureResult> =>
    blank.has(c.dataset.file!)
      ? { ok: false, reason: "The running viz read back blank, so there's no thumbnail." }
      : { ok: true, thumbnail: { dataUrl: `data:image/webp;base64,${c.dataset.file}`, bytes: 10, type: "image/webp" } };
  // the issue's project: a three.js knot drawn inline, the Sunset Drive backdrop behind it
  const files = [
    { id: "pat", path: "pattern.strudel", language: "strudel" },
    { id: "knot", path: "Knot.three", language: "three" },
    { id: "sun", path: "viz_lib/Sunset Drive/Sunset Drive.p5", language: "p5js" },
    { id: "knotpat", path: "knot.strudel", language: "strudel" }, // a pattern sharing the name: never the visual
  ];
  const scene = () => {
    document.body.innerHTML = "";
    mount("sun", 1076, 813); // the backdrop, larger
    zone("Knot", "knot", 1003, 501);
  };

  it("the inline zone is matched to the file its name resolves to, by the studio's rule", () => {
    scene();
    zone("pianoroll", "builtin", 400, 100); // a visual Stave ships: no file of the project
    const m = findVisualMounts(files, document);
    expect([...m.keys()].sort()).toEqual(["knot", "sun"]);
    expect(m.get("knot")![0].getAttribute("data-viz-zone-id")).toBe("Knot");
  });

  it("the name is read as the renderer reads it: case, spaces and hyphens don't matter", () => {
    document.body.innerHTML = "";
    zone("sunset-drive", "sun", 300, 200);
    expect([...findVisualMounts(files, document).keys()]).toEqual(["sun"]);
  });

  it("so it counts as running: its row gets a still", async () => {
    scene();
    const got = await captureVisualFrames(files, document, take());
    expect(got.frames.map((f) => [f.path, f.image])).toEqual([
      ["Knot.three", "data:image/webp;base64,knot"],
      ["viz_lib/Sunset Drive/Sunset Drive.p5", "data:image/webp;base64,sun"],
    ]);
  });

  it("with the inline visual as the cover, the picture is of it, not of the larger backdrop", async () => {
    scene();
    const got = await captureCoverThumbnail(files, "knot", document, take());
    expect(got.ok && got.thumbnail.dataUrl).toBe("data:image/webp;base64,knot");
    expect(got.note).toBeUndefined();
  });

  it("with a pattern as the cover, the picture is the largest visual on screen, as before", async () => {
    scene();
    const got = await captureCoverThumbnail(files, "pat", document, take());
    expect(got.ok && got.thumbnail.dataUrl).toBe("data:image/webp;base64,sun");
    expect(got.note).toBeUndefined();
  });

  it("a cover visual on screen that can't be read: another visual's picture, and the dialog is told why", async () => {
    scene();
    const got = await captureCoverThumbnail(files, "knot", document, take(new Set(["knot"])));
    expect(got.ok && got.thumbnail.dataUrl).toBe("data:image/webp;base64,sun");
    expect(got.note).toBe(
      "Knot.three is on screen, but its frame couldn't be taken: the running viz read back blank, so there's no thumbnail. This picture is of another visual that is.",
    );
  });

  it("a cover visual that isn't on screen: said so, beside the picture or instead of it", async () => {
    document.body.innerHTML = "";
    mount("sun", 1076, 813);
    const withOther = await captureCoverThumbnail(files, "knot", document, take());
    expect(withOther.ok && withOther.thumbnail.dataUrl).toBe("data:image/webp;base64,sun");
    expect(withOther.note).toBe("Knot.three isn't drawing on screen right now. This picture is of another visual that is.");
    document.body.innerHTML = "";
    const alone = await captureCoverThumbnail(files, "knot", document, take());
    expect(alone).toEqual({ ok: false, reason: "Knot.three isn't drawing on screen right now. Play it, or open its tab, to take its picture." });
  });

  it("an inline visual on screen whose still can't be taken is named, not left out quietly", async () => {
    scene();
    const got = await captureVisualFrames(files, document, take(new Set(["knot"])));
    expect(got.frames.map((f) => f.path)).toEqual(["viz_lib/Sunset Drive/Sunset Drive.p5"]);
    expect(got.missed).toEqual([{ path: "Knot.three", reason: "The running viz read back blank, so there's no thumbnail." }]);
  });
});
