import { describe, it, expect } from "vitest";

import {
  VIZ_LIBRARY,
  VIZ_LIB_ROOT,
  planVizLibFiles,
  type VizLibItem,
} from "../vizLibrary";

describe("VIZ_LIBRARY corpus (#834)", () => {
  it("is the curated non-default shelf — the two #287 shaders and the four film sketches (#1992)", () => {
    expect(VIZ_LIBRARY.map((i) => [i.name, i.renderer])).toEqual([
      ["Prism", "glsl"],
      ["Pulse Grid", "glsl"],
      ["Rain Drive", "glsl"],
      ["Tunnel", "glsl"],
      ["Robot Guitarist", "p5"],
      ["Sunset Drive", "p5"],
    ]);
  });

  it("ids and names are unique — a name is the `.viz()` token, an id the row key", () => {
    expect(new Set(VIZ_LIBRARY.map((i) => i.id)).size).toBe(VIZ_LIBRARY.length);
    expect(new Set(VIZ_LIBRARY.map((i) => i.name)).size).toBe(VIZ_LIBRARY.length);
  });

  it("each file's language and extension agree with the package's renderer", () => {
    // A file registers as a named viz by its `language`; a p5 sketch filed as
    // glsl (or the reverse) would be handed to the wrong compiler.
    const expected = {
      glsl: { language: "glsl", ext: ".glsl" },
      p5: { language: "p5js", ext: ".p5" },
      hydra: { language: "hydra", ext: ".hydra" },
    } as const;
    for (const item of VIZ_LIBRARY) {
      const primary = item.files.find((f) => f.relPath.startsWith(`${item.name}.`))!;
      expect(primary.language, item.name).toBe(expected[item.renderer].language);
      expect(primary.relPath, item.name).toBe(`${item.name}${expected[item.renderer].ext}`);
    }
  });

  it("every package has a primary file whose basename matches its name", () => {
    // The primary file is what registers as `.viz("<name>")`, so exactly one
    // must exist per package or the add wires up nothing (P118).
    for (const item of VIZ_LIBRARY) {
      const primaries = planVizLibFiles(item).filter((f) => f.isPrimary);
      expect(primaries, `${item.name} has one primary file`).toHaveLength(1);
    }
  });

  it("ships real source (not an empty stub) with its renderer's entry point", () => {
    // GLSL: the ShaderToy entry point. p5: the sketch's own draw loop.
    const entry = { glsl: "mainImage", p5: "function draw()", hydra: ".out(" } as const;
    for (const item of VIZ_LIBRARY) {
      for (const f of item.files) {
        expect(f.content, item.name).toContain(entry[item.renderer]);
      }
    }
  });

  it("every curated package ships a baked PNG thumbnail (#836)", () => {
    // The shelf is curated, so each item carries a real captured frame — not the
    // placeholder fallback. A regressed/empty bake would strip these.
    for (const item of VIZ_LIBRARY) {
      expect(item.thumbnail, `${item.name} has a baked thumbnail`).toMatch(
        /^data:image\/png;base64,/,
      );
      expect((item.thumbnail ?? "").length).toBeGreaterThan(500);
    }
  });
});

describe("planVizLibFiles (#834)", () => {
  const prism: VizLibItem = {
    id: "prism",
    name: "Prism",
    renderer: "glsl",
    files: [{ relPath: "Prism.glsl", content: "// prism", language: "glsl" }],
  };

  it("materialises under viz_lib/<Name>/<relPath> with a stable id", () => {
    const [f] = planVizLibFiles(prism);
    expect(f.path).toBe(`${VIZ_LIB_ROOT}/Prism/Prism.glsl`);
    expect(f.workspaceId).toBe("vizlib_prism_Prism_glsl"); // sanitised, stable
    expect(f.content).toBe("// prism");
    expect(f.language).toBe("glsl");
    expect(f.isPrimary).toBe(true);
  });

  it("gives a stable id for a name with a space (Pulse Grid)", () => {
    const pulse: VizLibItem = {
      id: "pulse-grid",
      name: "Pulse Grid",
      renderer: "glsl",
      files: [{ relPath: "Pulse Grid.glsl", content: "x", language: "glsl" }],
    };
    const [f] = planVizLibFiles(pulse);
    expect(f.path).toBe(`${VIZ_LIB_ROOT}/Pulse Grid/Pulse Grid.glsl`);
    expect(f.workspaceId).toBe("vizlib_pulse-grid_Pulse_Grid_glsl");
    expect(f.isPrimary).toBe(true);
  });

  it("marks a non-matching helper asset as NOT primary", () => {
    // A future multi-file package: only the file whose basename matches the
    // package name registers as the viz; sibling assets do not.
    const withAsset: VizLibItem = {
      id: "prism",
      name: "Prism",
      renderer: "glsl",
      files: [
        { relPath: "Prism.glsl", content: "// prism", language: "glsl" },
        { relPath: "noise.glsl", content: "// helper", language: "glsl" },
      ],
    };
    const planned = planVizLibFiles(withAsset);
    expect(planned.map((f) => f.isPrimary)).toEqual([true, false]);
  });

  it("re-planning yields identical ids (idempotent add)", () => {
    expect(planVizLibFiles(prism)).toEqual(planVizLibFiles(prism));
  });
});
