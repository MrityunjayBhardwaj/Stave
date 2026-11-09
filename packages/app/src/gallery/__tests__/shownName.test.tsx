// @vitest-environment node
// #2465 — a stored name with nothing visible in it (from before #2450) shows as
// "Unnamed artist" wherever a name is shown, not as a gap.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildAccountMenu } from "../accountMenu";
import { AuthorName } from "../GalleryCards";
import { shownName, UNNAMED_AUTHOR } from "../reservedNames";
import { galleryTrustMessage } from "../safeRun";
import type { GallerySessionState } from "../session";

const INVISIBLE = ["​", "‍", "⁠", "­", "ㅤ", "⠀", "​ㅤ"];

describe("shownName", () => {
  it.each(INVISIBLE.map((n) => [JSON.stringify(n), n]))("shows %s as Unnamed artist", (_, name) => {
    expect(shownName(name)).toBe(UNNAMED_AUTHOR);
  });

  it.each(["Ada", "李雷", "A​", "🎵"])("shows %j as itself", (name) => {
    expect(shownName(name)).toBe(name);
  });
});

describe("where a name is shown", () => {
  it("an author link, with and without a profile to open", () => {
    const link = renderToStaticMarkup(<AuthorName name={"ㅤ"} authorId="a1" onAuthor={() => {}} />);
    expect(link).toContain(`>${UNNAMED_AUTHOR}</a>`);
    expect(renderToStaticMarkup(<AuthorName name={"​"} />)).toContain(`>${UNNAMED_AUTHOR}</span>`);
    expect(renderToStaticMarkup(<AuthorName name="Ada" authorId="a1" onAuthor={() => {}} />)).toContain(">Ada</a>");
  });

  it("the menu bar's account button", () => {
    const state = (name: string) =>
      ({
        status: "ready",
        session: {
          signInAvailable: true,
          providers: [],
          user: { authorId: "a1", name, verified: {} },
          isAdmin: false,
        },
      }) as unknown as GallerySessionState;
    const on = { onSignIn: () => {}, onSignOut: () => {}, onMyProfile: () => {} };
    expect(buildAccountMenu(state("⁠"), on)).toMatchObject({ state: "signed-in", name: UNNAMED_AUTHOR });
    expect(buildAccountMenu(state("Ada"), on)).toMatchObject({ name: "Ada" });
  });

  it("the trust question keeps its own words", () => {
    expect(galleryTrustMessage("ㅤ").description).toContain("written by someone else.");
  });
});

// ── every read of a stored name in the client either shows it through shownName
// or isn't showing it. A new place that shows one has to be added below, and the
// list says which kind it is.

const SRC = path.resolve(__dirname, "../..");
const SKIP_DIRS = new Set(["__tests__", "api", "db"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const full = path.join(dir, f);
    if (statSync(full).isDirectory()) return SKIP_DIRS.has(f) ? [] : files(full);
    return /\.tsx?$/.test(f) ? [full] : [];
  });
}

/** Each line of client code that reads a stored name: `x.authorName`, `author.name`, `user.name`. */
function nameReads(): string[] {
  const out: string[] = [];
  for (const file of files(SRC)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line) => {
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
        if (/\.authorName\b|\bauthor\.name\b|\buser\.name\b/.test(code)) out.push(`${path.relative(SRC, file)}: ${code}`);
      });
  }
  return out;
}

/** Reads that aren't a name being shown, each with why. */
const NOT_SHOWN: Array<[RegExp, string]> = [
  [/markGalleryFilesUntrusted\(/, "the trust step, whose question has its own words"],
  [/useState\(page\.author\.name\)/, "the profile editor starts from what's really stored"],
  [/buildProfileRequest\(\{ name, bio \}, page\.author\.name\)/, "the stored name, to tell a change from keeping it"],
  [/const hay = \[/, "search"],
];

describe("every place that shows a stored name", () => {
  it("goes through shownName, or is listed as not showing it", () => {
    const reads = nameReads();
    expect(reads.length).toBeGreaterThan(5); // the scan found the reads it should
    const unexplained = reads.filter(
      (r) => !r.includes("shownName(") && !r.includes("<AuthorName ") && !NOT_SHOWN.some(([re]) => re.test(r)),
    );
    expect(unexplained).toEqual([]);
  });

  it("and AuthorName, which the others pass names to, applies it itself", () => {
    const cards = readFileSync(path.join(SRC, "gallery/GalleryCards.tsx"), "utf8");
    expect(cards).toMatch(/const name = shownName\(stored\);/);
  });
});
