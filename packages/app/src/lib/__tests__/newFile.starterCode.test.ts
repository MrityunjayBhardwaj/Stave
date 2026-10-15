import { describe, expect, it, vi } from "vitest";
import { listWorkspaceFiles } from "@stave/editor";

const prompt = vi.hoisted(() => ({ name: "" }));
vi.mock("../../dialogs/host", () => ({
  showPrompt: vi.fn(async () => prompt.name),
  showToast: vi.fn(),
}));

import { promptAndCreateFile } from "../newFile";

/**
 * #2076: a new visual file starts with a short sketch that already draws, in
 * its renderer's own contract, instead of an empty page.
 */
async function create(name: string) {
  prompt.name = name;
  await promptAndCreateFile("starter-code");
  const file = listWorkspaceFiles().find((f) => f.path === `starter-code/${name}`);
  expect(file, name).toBeDefined();
  return file!;
}

describe("starter code for new visual files (#2076)", () => {
  it("a new p5 sketch sizes its canvas to Stave and draws", async () => {
    for (const name of ["a.p5", "b.js"]) {
      const { content } = await create(name);
      expect(content, name).toContain("createCanvas(stave.width, stave.height)");
      expect(content, name).toMatch(/function draw\(\)/);
    }
  });

  it("a new Hydra sketch outputs", async () => {
    for (const name of ["a.hydra", "b.hy"]) {
      expect((await create(name)).content, name).toMatch(/\.out\(\)\s*$/);
    }
  });

  it("a new GLSL shader writes mainImage", async () => {
    for (const name of ["a.glsl", "b.frag", "c.shader"]) {
      expect((await create(name)).content, name).toContain("void mainImage(out vec4 fragColor, in vec2 fragCoord)");
    }
  });

  it("other new files still start empty", async () => {
    for (const name of ["a.strudel", "a.md"]) expect((await create(name)).content, name).toBe("");
  });
});
