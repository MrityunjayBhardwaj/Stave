import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createWorkspaceFile, type WorkspaceLanguage } from "@stave/editor";
import { FileTree } from "../FileTree";

/**
 * #2074: a file's icon in the tree says what kind of file it is. The kind is
 * the file's type, not its extension: Stave opens `.js` as p5, `.frag` and
 * `.shader` as GLSL, `.hy` as Hydra and `.rb` as Sonic Pi, so those share
 * their type's icon instead of falling back to a blank page.
 */

const FILES: Array<[id: string, path: string, language: WorkspaceLanguage]> = [
  ["i-strudel", "icons/song.strudel", "strudel"],
  ["i-p5", "icons/visuals.p5", "p5js"],
  ["i-js", "icons/sketch.js", "p5js"],
  ["i-hydra", "icons/bg.hydra", "hydra"],
  ["i-hy", "icons/bg2.hy", "hydra"],
  ["i-glsl", "icons/glow.glsl", "glsl"],
  ["i-frag", "icons/blur.frag", "glsl"],
  ["i-shader", "icons/fx.shader", "glsl"],
  ["i-sonicpi", "icons/old.sonicpi", "sonicpi"],
  ["i-rb", "icons/old2.rb", "sonicpi"],
  ["i-md", "icons/README.md", "markdown"],
];

function iconOf(container: HTMLElement, id: string): string {
  const row = container.querySelector(`[data-file-tree-item="${id}"]`);
  expect(row, `row for ${id}`).not.toBeNull();
  // The icon is the row's first child; the file name follows it.
  return (row!.firstElementChild as HTMLElement).outerHTML;
}

describe("file tree type icons (#2074)", () => {
  afterEach(cleanup);

  function renderTree() {
    for (const [id, path, language] of FILES) createWorkspaceFile(id, path, "", language);
    return render(
      <FileTree projectName="p" onOpenFile={() => {}} activeFileId={null} onFileHistory={() => {}} />,
    );
  }

  it("gives every extension of a type that type's icon", () => {
    const { container } = renderTree();
    const same: Array<[string, string]> = [
      ["i-js", "i-p5"],
      ["i-hy", "i-hydra"],
      ["i-frag", "i-glsl"],
      ["i-shader", "i-glsl"],
      ["i-rb", "i-sonicpi"],
    ];
    for (const [alias, canonical] of same) {
      expect(iconOf(container, alias), `${alias} shares ${canonical}'s icon`).toBe(iconOf(container, canonical));
    }
  });

  it("gives each type an icon of its own", () => {
    const { container } = renderTree();
    const types = ["i-strudel", "i-p5", "i-hydra", "i-glsl", "i-sonicpi", "i-md"];
    const icons = types.map((id) => iconOf(container, id));
    expect(new Set(icons).size).toBe(types.length);
  });

  it("draws icons, not emoji", () => {
    const { container } = renderTree();
    for (const [id] of FILES) {
      expect(iconOf(container, id), id).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    // The folder row too: the whole tree carries no emoji.
    expect(container.textContent ?? "").not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
