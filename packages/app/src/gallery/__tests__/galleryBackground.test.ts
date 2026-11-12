// @vitest-environment node
/**
 * #2530: the gallery sits on the theme's base colour (`--bg-app`: near-black
 * in the dark theme, the light base in the light theme), like the rest of the
 * window, not on the raised panel colour (`--bg-elevated`). The page itself
 * and every opaque band that scrolls over it (sticky crumbs, the entry's
 * sticky action bar on narrow screens) and the phone overlay must agree, or a
 * strip of the old colour shows. Menus, dialogs and the active chip sit above
 * the page and keep the raised colour, so they aren't listed here.
 *
 * The CSS lives in injected <style> strings, so this reads the rule from the
 * source the way the browser gets it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const GALLERY = path.resolve(__dirname, "..");

/**
 * The `background:` of every rule for `selector` in `file` that sets one
 * (a selector can have a base rule and a narrow-screen rule; the opaque band
 * may live in either), in source order.
 */
function backgroundsOf(file: string, selector: string): string[] {
  const src = readFileSync(path.join(GALLERY, file), "utf8");
  const found: string[] = [];
  for (let at = src.indexOf(`${selector} {`); at >= 0; at = src.indexOf(`${selector} {`, at + 1)) {
    const body = src.slice(at, src.indexOf("}", at));
    const m = /(?:^|[;{\s])background:\s*([^;]+);/.exec(body);
    if (m) found.push(m[1].trim());
  }
  return found;
}

const PAGE_SURFACES: Array<[file: string, selector: string]> = [
  ["galleryTab.tsx", ".sg-tabhost"],
  ["GalleryOverlay.tsx", ".sg-modal"],
  ["GalleryBar.tsx", ".sg-crumbs"],
  ["GalleryEntry.tsx", ".sg-side-actions"],
];

describe("the gallery paints the theme's base colour (#2530)", () => {
  it.each(PAGE_SURFACES)("%s %s uses var(--bg-app)", (file, selector) => {
    const backgrounds = backgroundsOf(file, selector);
    expect(backgrounds.length).toBeGreaterThan(0);
    for (const b of backgrounds) expect(b).toBe("var(--bg-app)");
  });

  it("CONTROL: a raised surface (the active filter chip) still reads as raised", () => {
    expect(backgroundsOf("GalleryBar.tsx", ".sg-filter-on")).toEqual(["var(--bg-elevated)"]);
  });

  it("CONTROL: the reader finds nothing for a selector that isn't there", () => {
    expect(backgroundsOf("GalleryBar.tsx", ".sg-no-such-rule")).toEqual([]);
  });
});
