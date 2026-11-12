/**
 * #2516 — every place in the app that keeps its own idea of "which files are
 * visuals" knows `.three`. A list the compiler doesn't check can drop a new viz
 * kind without a word: GLSL was silently ignored at exactly these sites (#287).
 * One case per site, so removing `three` from any one of them reddens its case.
 *
 * (`vizLibrary.ts` and `templates.ts` no longer keep a list: their types derive
 * from the editor's, so a missing arm there is a compile error instead.)
 */
import { describe, expect, it, vi } from "vitest";
import { compileThreeSketch, THREE_ADDONS, type WorkspaceFile } from "@stave/editor";

vi.mock("../../dialogs/host", () => ({ showPrompt: vi.fn(), showToast: vi.fn() }));

import { filesForKind } from "../../gallery/publish";
import { previewKindOf, parseToFrame } from "../../gallery/previewProtocol";
import { fileRole } from "../../gallery/galleryModel";
import { extensionToLanguage, starterCodeFor } from "../../lib/newFile";
import { findVizFileByName, qualifiedVizName, p5VizBasenames } from "../vizFileLookup";

const knot: WorkspaceFile = {
  id: "knot",
  path: "viz/Knot.three",
  content: "",
  language: "three",
  meta: {},
} as unknown as WorkspaceFile;

describe("a .three file is a visual everywhere the app keeps its own list", () => {
  it("newFile: the .three extension makes a three.js file", () => {
    expect(extensionToLanguage("three")).toBe("three");
  });

  it("newFile: a new .three file starts with a sketch that parses and imports only what Stave bundles", () => {
    const starter = starterCodeFor("three");
    expect(starter).toContain("from 'three'");
    const compiled = compileThreeSketch(starter);
    expect(compiled.syntaxError).toBeNull();
    for (const { spec } of compiled.imports) {
      const addon = spec.replace(/^three\/addons\//, "");
      expect(spec === "three" || THREE_ADDONS.includes(addon), spec).toBe(true);
    }
    // the one Stave line: the music
    expect(starter).toContain("sig.bass");
  });

  it("publish: a .three file can be published as a viz entry", () => {
    expect(filesForKind([{ id: "knot", path: "Knot.three", language: "three", content: "" }] as never, "viz")).toHaveLength(1);
  });

  it("gallery: a .three file gets a preview, by extension and by language", () => {
    expect(previewKindOf({ path: "a/Knot.three" })).toBe("three");
    expect(previewKindOf({ path: "a/Knot", language: "three" })).toBe("three");
    const msg = { play: true, path: "a/Knot.three", files: [{ path: "a/Knot.three", kind: "three", code: "x" }] };
    expect(parseToFrame(msg)).toEqual(msg);
  });

  it("gallery: a .three file in an entry counts as a visual", () => {
    expect(fileRole("viz/Knot.three")).toBe("visual");
  });

  it("vizFileLookup: .viz(\"Knot\") finds the .three file, and a p5 twin makes it Knot:three", () => {
    expect(findVizFileByName([knot], "Knot")).toBe(knot);
    const twin = { ...knot, id: "p5", path: "viz/Knot.p5", language: "p5js" } as WorkspaceFile;
    expect(qualifiedVizName(knot, p5VizBasenames([knot, twin]))).toBe("Knot:three");
  });
});
