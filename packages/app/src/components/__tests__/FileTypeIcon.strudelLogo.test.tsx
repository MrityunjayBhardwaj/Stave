import React from "react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { FileTypeIcon } from "../FileTypeIcon";

/**
 * #2077: Strudel's icon is Strudel's own mark, the orange strudel roll from its
 * app icon. It was the Tidal Cycles logo, taken from a file named `logo.svg`.
 */

afterEach(cleanup);

const ICONS = join(__dirname, "../../../public/file-icons");
// The Tidal Cycles logo's gradient: navy to teal to magenta.
const TIDAL = ["#1a2243", "#46c1b9", "#c5115b"];

describe("Strudel's icon (#2077)", () => {
  it("no file icon is the Tidal Cycles logo", () => {
    const svgs = readdirSync(ICONS).filter((f) => f.endsWith(".svg"));
    expect(svgs.length, "icons examined").toBeGreaterThan(0);
    for (const f of svgs) {
      const text = readFileSync(join(ICONS, f), "utf8").toLowerCase();
      expect(TIDAL.every((c) => text.includes(c)), f).toBe(false);
    }
  });

  it("the Strudel icon is a square PNG of the strudel roll", () => {
    const { container } = render(<FileTypeIcon language="strudel" />);
    const src = container.querySelector("img")!.getAttribute("src")!;
    expect(src).toBe("/file-icons/strudel.png");
    const png = readFileSync(join(ICONS, "strudel.png"));
    // PNG header, then IHDR width and height.
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(png.readUInt32BE(20));
  });
});
