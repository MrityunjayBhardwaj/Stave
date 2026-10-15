"use client";

import React from "react";
import type { WorkspaceFile } from "@stave/editor";

/**
 * The icon that says what kind of file a file is (#2074).
 *
 * Keyed on the file's type, not its extension: Stave opens `.js` as p5,
 * `.frag` and `.shader` as GLSL, `.hy` as Hydra and `.rb` as Sonic Pi, and
 * each of those is the same kind of file as its type's main extension.
 *
 * A type with its own logo shows that logo (Strudel, p5.js, Sonic Pi, the
 * Markdown mark). Hydra and GLSL have none, so they get a drawing of what
 * each one makes: the stripes Hydra's `osc()` draws, and the shaded triangle
 * that is the first thing most shaders draw. The coloured logos are files in
 * `public/file-icons`; the Markdown mark and the plain page follow the
 * theme's text colour, so they are drawn inline.
 */

type Language = WorkspaceFile["language"];

const LOGOS: Partial<Record<Language, string>> = {
  strudel: "/file-icons/strudel.svg",
  p5js: "/file-icons/p5.svg",
  hydra: "/file-icons/hydra.svg",
  glsl: "/file-icons/glsl.svg",
  sonicpi: "/file-icons/sonicpi.svg",
};

const box: React.CSSProperties = { width: 14, height: 14, flex: "none", display: "block" };

export function FileTypeIcon({ language }: { language: Language | undefined }): React.ReactElement {
  const logo = language ? LOGOS[language] : undefined;
  if (logo) return <img src={logo} alt="" aria-hidden width={14} height={14} style={box} draggable={false} />;
  if (language === "markdown") {
    return (
      <svg viewBox="0 0 208 128" style={box} aria-hidden fill="currentColor">
        <path
          fillRule="evenodd"
          d="m15 10c-2.76 0-5 2.24-5 5v98c0 2.76 2.24 5 5 5h178c2.76 0 5-2.24 5-5v-98c0-2.76-2.24-5-5-5zm-15 5c0-8.28 6.72-15 15-15h178c8.28 0 15 6.72 15 15v98c0 8.28-6.72 15-15 15h-178c-8.28 0-15-6.72-15-15z"
        />
        <path d="m30 98v-68h20l20 25 20-25h20v68h-20v-39l-20 25-20-25v39zm125 0-30-33h20v-35h20v35h20z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" style={box} aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M14 3H6v18h12V7z" />
      <path d="M14 3v4h4" />
    </svg>
  );
}

/** A folder, in the theme's icon colour. */
export function FolderIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" style={box} aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M3 6h6l2 2h10v11H3z" />
    </svg>
  );
}
