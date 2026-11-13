import { describe, expect, it } from "vitest";

import { FRAME_SIZE, captureVisualFrames, encodeUnderLimit, findLiveVizCanvas, isBlankFrame, type CaptureResult, type EncodeFn } from "../thumbnail";
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
  function mount(id: string, w: number, h: number): HTMLCanvasElement {
    const host = document.createElement("div");
    host.innerHTML = `<div data-testid="compiled-viz-mount-${id}"><canvas></canvas></div>`;
    document.body.appendChild(host);
    const c = host.querySelector("canvas")!;
    c.width = w;
    c.height = h;
    c.getBoundingClientRect = () => ({ width: w, height: h }) as DOMRect;
    c.dataset.file = id;
    return c;
  }
  /** Stands in for the copy: "reads" a canvas as its file id, or blank when told. */
  const taken: string[] = [];
  const take = (blank: Set<string> = new Set()) => async (c: HTMLCanvasElement): Promise<CaptureResult> => {
    taken.push(c.dataset.file!);
    return blank.has(c.dataset.file!)
      ? { ok: false, reason: "blank" }
      : { ok: true, thumbnail: { dataUrl: `data:image/webp;base64,${c.dataset.file}`, bytes: 10, type: "image/webp" } };
  };

  it("each visual file's still comes from its own mount; patterns, other files and visuals not on screen get none", async () => {
    document.body.innerHTML = "";
    taken.length = 0;
    mount("a", 400, 300);
    mount("b", 800, 600); // larger, but another file's: never a's still
    mount("p", 400, 300); // a pattern's id on a mount (can't happen, but must not count)
    mount("hidden", 0, 0); // a visual whose tab isn't showing
    const files = [
      { id: "a", path: "a.hydra" },
      { id: "b", path: "b.p5" },
      { id: "p", path: "p.strudel" },
      { id: "hidden", path: "h.glsl" },
      { id: "off", path: "off.hydra" }, // not running at all
    ];
    const got = await captureVisualFrames(files, document, take());
    expect(got).toEqual([
      { path: "a.hydra", image: "data:image/webp;base64,a" },
      { path: "b.p5", image: "data:image/webp;base64,b" },
    ]);
    expect(taken).toEqual(["a", "b"]);
  });

  it("a visual that reads back blank gets no still", async () => {
    document.body.innerHTML = "";
    mount("a", 400, 300);
    expect(await captureVisualFrames([{ id: "a", path: "a.hydra" }], document, take(new Set(["a"])))).toEqual([]);
  });

  it("at most the record's number of stills", async () => {
    document.body.innerHTML = "";
    const files = Array.from({ length: RECORDING_LIMITS.frames + 3 }, (_, i) => ({ id: `v${i}`, path: `v${i}.hydra` }));
    for (const f of files) mount(f.id, 100, 100);
    expect(await captureVisualFrames(files, document, take())).toHaveLength(RECORDING_LIMITS.frames);
  });

  it("a still is small: the record's width and bytes", () => {
    expect(FRAME_SIZE.width).toBe(RECORDING_LIMITS.frameWidth);
    expect(FRAME_SIZE.maxBytes).toBe(RECORDING_LIMITS.frameBytes);
    expect(Math.max(...FRAME_SIZE.widths)).toBeLessThanOrEqual(RECORDING_LIMITS.frameWidth);
  });
});
