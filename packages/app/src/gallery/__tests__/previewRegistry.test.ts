/**
 * #2490 — inside the preview frame, a pattern's `.viz("name")` finds the
 * entry's own visual by the studio's name rule (vizFileLookup.ts).
 */
import { describe, expect, it } from "vitest";
import { previewRegistry } from "../previewRegistry";
import type { PreviewFile } from "../previewProtocol";

const f = (path: string, kind: PreviewFile["kind"], code = ""): PreviewFile => ({ path, kind, code });

describe("previewRegistry", () => {
  const files = [
    f("main.strudel", "strudel", 's("bd").viz("bloom")'),
    f("viz/bloom.hydra", "hydra", "osc(10).out()"),
    f("viz/Piano Roll.p5", "p5"),
  ];
  const reg = previewRegistry(files);

  it("resolves a .viz name to the project's file of that name", () => {
    expect(reg.visualFor("bloom")).toBe(files[1]);
  });

  it("matches names as the studio does: exact, then ignoring case, spaces, hyphens and underscores", () => {
    expect(reg.visualFor("Piano Roll")).toBe(files[2]);
    expect(reg.visualFor("pianoroll")).toBe(files[2]);
    expect(reg.visualFor("BLOOM")).toBe(files[1]);
  });

  it("finds nothing for a name the entry has no visual for", () => {
    expect(reg.visualFor("scope")).toBeNull();
    expect(previewRegistry([files[0]]).visualFor("bloom")).toBeNull();
  });

  it("a pattern is never a visual, even one named like it", () => {
    expect(previewRegistry([f("bloom.strudel", "strudel")]).visualFor("bloom")).toBeNull();
  });

  it("a Hydra file sharing a p5 sketch's name answers to <name>:hydra; the bare name is the sketch's", () => {
    const twins = [f("scope.hydra", "hydra"), f("scope.p5", "p5")];
    const r = previewRegistry(twins);
    expect(r.visualFor("scope")).toBe(twins[1]);
    expect(r.visualFor("scope:hydra")).toBe(twins[0]);
  });

  it("two files of one name: the later one wins, as re-registering does in the studio", () => {
    const two = [f("a/glow.hydra", "hydra"), f("b/glow.hydra", "hydra")];
    expect(previewRegistry(two).visualFor("glow")).toBe(two[1]);
  });

  it("every visual kind can be drawn by name", () => {
    for (const kind of ["hydra", "p5", "glsl", "three"] as const) {
      expect(previewRegistry([f(`v.${kind}`, kind)]).visualFor("v"), kind).not.toBeNull();
    }
  });
});
