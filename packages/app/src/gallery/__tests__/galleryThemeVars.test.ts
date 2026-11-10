// @vitest-environment node
/**
 * The gallery's CSS is injected <style> strings that read the theme through
 * `var(--…)`. A variable no theme defines doesn't fail loudly: it falls back to
 * whatever is written after the comma (a colour picked for the dark theme) or,
 * with no fallback, drops the whole declaration. That is how an entry's code
 * block came out grey and hard to read in the light theme (#2531), and error
 * text pale red on a near-white page (#2536).
 *
 * So: every variable the gallery reads must be defined by the theme
 * (app/globals.css), and code must take the editor's light colours in the
 * light theme.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIGHT_CODE_BG } from "../codeColour";

const GALLERY = path.resolve(__dirname, "..");
const GLOBALS = readFileSync(path.resolve(GALLERY, "../app/globals.css"), "utf8");

/** Variables the theme defines (`--name:` at the start of a line in globals.css). */
function themeVariables(css: string): Set<string> {
  return new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]));
}

/** `var(--name` reads in a source, as [name, file]. */
function variablesRead(file: string, src: string): Array<[string, string]> {
  return [...src.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => [m[1], file]);
}

function gallerySources(): Array<[string, string]> {
  return readdirSync(GALLERY)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => [f, readFileSync(path.join(GALLERY, f), "utf8")]);
}

function undefinedReads(defined: Set<string>, sources: Array<[string, string]>): string[] {
  return sources
    .flatMap(([f, src]) => variablesRead(f, src))
    .filter(([name]) => !defined.has(name))
    .map(([name, f]) => `${name} in ${f}`);
}

describe("the gallery reads only theme variables that exist (#2531, #2536)", () => {
  const defined = themeVariables(GLOBALS);

  it("every var(--…) in the gallery's sources is defined by the theme", () => {
    const sources = gallerySources();
    expect(sources.length).toBeGreaterThan(10);
    expect(undefinedReads(defined, sources)).toEqual([]);
  });

  it("CONTROL: the check names a variable the theme doesn't define", () => {
    const bad: Array<[string, string]> = [["Fake.tsx", ".x { background: var(--bg-editor, rgba(0,0,0,.25)); color: var(--text-primary); }"]];
    expect(undefinedReads(defined, bad)).toEqual(["--bg-editor in Fake.tsx"]);
  });

  it("CONTROL: the theme reader sees both themes' names", () => {
    for (const name of ["--bg-app", "--bg-elevated", "--text-primary", "--danger-fg"]) expect(defined.has(name)).toBe(true);
  });
});

describe("code takes the editor's light colours in the light theme (#2531)", () => {
  const entry = readFileSync(path.join(GALLERY, "GalleryEntry.tsx"), "utf8");
  const markdown = readFileSync(path.join(GALLERY, "markdown.ts"), "utf8");
  const monaco = readFileSync(path.resolve(GALLERY, "../../../editor/src/theme/monacoTheme.ts"), "utf8");
  const lightTheme = monaco.slice(monaco.indexOf("base: 'vs',"));

  it("the light code background is the light editor's background", () => {
    expect(lightTheme).toContain(`'editor.background':              '${LIGHT_CODE_BG}'`);
  });

  it("the entry's code block and a bio's code block both switch background in the light theme", () => {
    expect(entry).toContain('[data-stave-theme="light"] .sg-code { background: ${LIGHT_CODE_BG}; }');
    expect(markdown).toContain('[data-stave-theme="light"] .sg-md pre { background: ${LIGHT_CODE_BG}; }');
  });

  it.each([
    ["sg-tk", "keyword", "6d28d9"],
    ["sg-ts", "string", "92400e"],
    ["sg-tn", "number", "c2410c"],
    ["sg-tf", "strudel.function", "1d4ed8"],
  ])("light .%s takes the light editor's %s colour", (cls, token, hex) => {
    expect(lightTheme).toMatch(new RegExp(`token: '${token.replace(".", "\\.")}',\\s+foreground: '${hex}'`));
    expect(entry).toContain(`[data-stave-theme="light"] .${cls} { color: #${hex}; }`);
  });
});
