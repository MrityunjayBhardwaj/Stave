import { describe, expect, it } from "vitest";

import { encodeUnderLimit, findLiveVizCanvas, isBlankFrame, type EncodeFn } from "../thumbnail";

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
