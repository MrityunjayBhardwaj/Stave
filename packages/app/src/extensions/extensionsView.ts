/**
 * #2511 — what the Extensions view shows, worked out from the extensions' manifests.
 *
 * Pure functions, no React, so the rules are tested on their own. Everything comes from
 * the manifest list the editor package lists (`listedExtensions()`), never from a copy
 * kept here: a manifest is plain data, so an extension that is off (its code never
 * loaded) shows the same names, languages and "what it adds" as one that is on.
 */
import type { ExtensionLanguage, ExtensionManifest, RESIDUE } from "@stave/editor";

/** The All / On / Off filter. */
export type ExtensionFilter = "all" | "on" | "off";

export const EXTENSION_FILTERS: readonly ExtensionFilter[] = ["all", "on", "off"];

export const FILTER_LABELS: Record<ExtensionFilter, string> = { all: "All", on: "On", off: "Off" };

/** Each language's name as people read it. A record, so a new language id is a type error here. */
export const LANGUAGE_NAMES: Record<ExtensionLanguage, string> = {
  strudel: "Strudel",
  sonicpi: "Sonic Pi",
  hydra: "Hydra",
  p5js: "p5.js",
  glsl: "GLSL",
  three: "three.js",
  markdown: "Markdown",
};

/** The panel (and its activity-bar icon) shows only once at least one extension is listed. */
export function showsExtensionsPanel(manifests: readonly ExtensionManifest[]): boolean {
  return manifests.length > 0;
}

/** "All languages" for `'*'`, else the names, in the manifest's order. */
export function languagesLabel(languages: ExtensionManifest["languages"]): string {
  if (languages === "*") return "All languages";
  return languages.map((l) => LANGUAGE_NAMES[l] ?? l).join(", ");
}

/** The code names it adds, as you would write them: `s("voice")`, `.lyric()`. */
export function codeNamesOf(m: ExtensionManifest): string[] {
  const strudel = m.provides?.strudel;
  return [
    ...(strudel?.sounds ?? []).map((s) => `s("${s}")`),
    ...(strudel?.controls ?? []).map((c) => `.${c}()`),
  ];
}

/** One row of an extension, as the list shows it. */
export interface ExtensionRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly languages: string;
  readonly codeNames: readonly string[];
  readonly experimental: boolean;
  /** switched on by this person, in this browser */
  readonly on: boolean;
  /** this project uses it and it is off (#2512 fills this) */
  readonly needed: boolean;
  readonly manifest: ExtensionManifest;
}

export function extensionRow(
  m: ExtensionManifest,
  enabled: ReadonlySet<string>,
  needed: ReadonlySet<string> = NOTHING,
): ExtensionRow {
  const on = enabled.has(m.id);
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    languages: languagesLabel(m.languages),
    codeNames: codeNamesOf(m),
    experimental: m.about?.experimental === true,
    on,
    needed: needed.has(m.id) && !on,
    manifest: m,
  };
}

const NOTHING: ReadonlySet<string> = new Set();

/** The list's groups. Each extension is in exactly one; the community group has none yet. */
export interface ExtensionGroups {
  /** used by this project and switched off (#2512) */
  readonly needed: readonly ExtensionRow[];
  readonly on: readonly ExtensionRow[];
  /** built into Stave and off, not needed by this project */
  readonly builtIn: readonly ExtensionRow[];
}

/** Does the row match the search? Name, description, id, code names and languages, any case. */
export function matchesQuery(row: ExtensionRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.name, row.description, row.id, row.languages, ...row.codeNames].some((s) => s.toLowerCase().includes(q));
}

export function matchesFilter(row: ExtensionRow, filter: ExtensionFilter): boolean {
  return filter === "all" || (filter === "on") === row.on;
}

/** The rows, filtered and searched, in their groups. */
export function groupExtensions(
  manifests: readonly ExtensionManifest[],
  opts: { enabled: ReadonlySet<string>; needed?: ReadonlySet<string>; filter?: ExtensionFilter; query?: string },
): ExtensionGroups {
  const rows = manifests
    .map((m) => extensionRow(m, opts.enabled, opts.needed))
    .filter((r) => matchesFilter(r, opts.filter ?? "all") && matchesQuery(r, opts.query ?? ""));
  return {
    needed: rows.filter((r) => r.needed),
    on: rows.filter((r) => r.on),
    builtIn: rows.filter((r) => !r.on && !r.needed),
  };
}

/**
 * The line beside the page's switch. `failure` is why switching it on failed in this page
 * (#2552): the switch stays on, but the line says what happened, not what was asked for.
 */
export function switchStateLine(on: boolean, failure?: string): string {
  if (on && failure) return `Couldn't switch on: ${failure} The Console has the details.`;
  return on ? "On — takes effect at once, no reload" : "Off — its code has not been loaded";
}

/** Is it switched on but failed to start? Only then is a failure shown (#2552). */
export function failedToStart(on: boolean, failure: string | undefined): boolean {
  return on && failure !== undefined;
}

/** One line of the page's "What it adds" table. */
export interface AddsLine {
  readonly kind: string;
  /** code names, drawn as code */
  readonly names?: readonly string[];
  /** plain text */
  readonly text?: string;
}

/** What it adds, read from the manifest alone, so it is the same while the extension is off. */
export function addsOf(m: ExtensionManifest): AddsLine[] {
  const lines: AddsLine[] = [{ kind: "Languages", text: languagesLabel(m.languages) }];
  const strudel = m.provides?.strudel;
  if (strudel?.sounds?.length) lines.push({ kind: "Sounds", names: strudel.sounds.map((s) => `s("${s}")`) });
  if (strudel?.controls?.length) {
    lines.push({
      kind: "Controls",
      names: strudel.controls.flatMap((c) => [`.${c}(…)`, `${c}(…)`]),
      text: "each as a pattern method and a global function",
    });
  }
  const worklets = m.about?.worklets ?? [];
  if (worklets.length) {
    lines.push({ kind: worklets.length === 1 ? "Audio worklet" : `Audio worklets (${worklets.length})`, text: worklets.join("; ") });
  }
  if (m.about?.prepares) lines.push({ kind: "Before playing", text: m.about.prepares });
  // #2513 adds the keys an extension declares (`provides.keys`) here and in their own
  // section of the page.
  return lines;
}

/** One thing switching off cannot undo, with the names it concerns. */
export interface LeftoverNote {
  readonly names: readonly string[];
  readonly text: string;
}

/**
 * What switching off cannot undo, in words for the person using it (#2552). One line per
 * kind of leftover the host lists (`RESIDUE`, whose own text is written for developers):
 * keyed by the host's kinds, so a new kind is a type error here until it has words.
 */
export type Leftovers = Record<keyof typeof RESIDUE, string>;

export const LEFTOVER_TEXT: Leftovers = {
  control: "code that still uses it stops with an error, but Stave's views keep treating it as a setting",
  worklet: "the code it uses to make sound stays loaded in this page, unused",
};

/**
 * What stays behind when it is switched off, so nothing is hidden. Empty when everything
 * it adds is undone.
 */
export function leftoversOf(m: ExtensionManifest, text: Leftovers = LEFTOVER_TEXT): LeftoverNote[] {
  const notes: LeftoverNote[] = [];
  const controls = m.provides?.strudel?.controls ?? [];
  if (controls.length) notes.push({ names: controls.map((c) => `.${c}(…)`), text: text.control });
  const worklets = m.about?.worklets ?? [];
  if (worklets.length) notes.push({ names: [], text: text.worklet });
  return notes;
}

/** The app tab key of an extension's page. One tab per extension. */
export const EXTENSION_TAB_PREFIX = "extension:";

export function extensionTabKey(id: string): string {
  return `${EXTENSION_TAB_PREFIX}${id}`;
}
