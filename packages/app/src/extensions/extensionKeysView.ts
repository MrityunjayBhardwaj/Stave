/**
 * #2545 — the keys extensions take, as Keyboard Shortcuts and an extension's page show them.
 *
 * Pure functions over the manifests and the "given back to Stave" setting (`keys.ts` in the
 * editor package), so the two places that show and change that setting work it out the
 * same way, and the rules are tested on their own. Nothing here ever writes the person's
 * shortcuts (`stave:keybindings`): handing a key back is the extension's own setting.
 *
 * The model is VS Code's Keyboard Shortcuts: every row says where it comes from (its
 * Source: Stave's default, You, or an extension), the list can be narrowed to one source,
 * an extension's rows are read-only, and a Stave command whose key an extension takes is
 * marked, the way the panel already marks two commands on one key.
 */
import {
  chordMatches,
  isMacPlatform,
  normalizeChord,
  extensionKeys,
  setExtensionKeyGivenBack,
  type ExtensionKeyInCode,
  type ExtensionKeyState,
  type ExtensionManifest,
} from "@stave/editor";

// ── Source ────────────────────────────────────────────────────────────────────────────

/** Where a row comes from: Stave's default, the person's own change, or an extension (by id). */
export type KeySource = "stave" | "you" | `extension:${string}`;

/** The Source filter: every source, or one. */
export type SourceFilter = "all" | KeySource;

export function extensionSource(extensionId: string): KeySource {
  return `extension:${extensionId}`;
}

/** A Stave command's source: You once the person has changed its key, else Stave. */
export function commandSource(overridden: boolean): KeySource {
  return overridden ? "you" : "stave";
}

/** The Source label, as the row and the filter show it. */
export function sourceLabel(source: KeySource, extensions: readonly ExtensionManifest[]): string {
  if (source === "stave") return "Stave";
  if (source === "you") return "You";
  const id = source.slice("extension:".length);
  return extensions.find((m) => m.id === id)?.name ?? id;
}

export interface SourceOption {
  readonly id: SourceFilter;
  readonly label: string;
}

/** The filter's choices: All, Stave, You, then each switched-on extension that declares keys. */
export function sourceOptions(extensions: readonly ExtensionManifest[]): SourceOption[] {
  return [
    { id: "all", label: "All" },
    { id: "stave", label: "Stave" },
    { id: "you", label: "You" },
    ...withKeys(extensions).map((m) => ({ id: extensionSource(m.id), label: m.name })),
  ];
}

/** Does a row of `source` show under `filter`? */
export function sourceShows(filter: SourceFilter, source: KeySource): boolean {
  return filter === "all" || filter === source;
}

/**
 * The filter to use now: the chosen one, or All when it names an extension that is no
 * longer on (its choice has left the filter, so keeping it would show an empty list).
 */
export function liveFilter(filter: SourceFilter, extensions: readonly ExtensionManifest[]): SourceFilter {
  return sourceOptions(extensions).some((o) => o.id === filter) ? filter : "all";
}

// ── an extension's rows ───────────────────────────────────────────────────────────────

/** The extensions that declare at least one key. */
export function withKeys(extensions: readonly ExtensionManifest[]): ExtensionManifest[] {
  return extensions.filter((m) => (m.provides?.keys?.length ?? 0) > 0);
}

/** A Stave command as far as clashes go: its title, scope, its chords now, and whether the person changed them. */
export interface CommandKeys {
  readonly id: string;
  readonly title: string;
  readonly scope?: string;
  readonly chords: readonly string[];
  readonly overridden: boolean;
}

/** One of an extension's keys, as a read-only row. */
export interface ExtensionKeyRow extends ExtensionKeyState {
  readonly extensionId: string;
  readonly extensionName: string;
  readonly source: KeySource;
  /** the Stave commands on the same key, which run from inside the code only while it is given back */
  readonly staveCommands: readonly string[];
}

/** Which platform to read chords for; the page's own by default (tests pass one). */
export interface PlatformOpts {
  readonly isMac?: boolean;
}

/** Every key the extension declares, handed back or not, with the Stave commands that share it. */
export function extensionKeyRows(
  m: ExtensionManifest,
  commands: readonly CommandKeys[],
  opts: PlatformOpts = {},
): ExtensionKeyRow[] {
  return extensionKeys(m).map((k) => ({
    ...k,
    extensionId: m.id,
    extensionName: m.name,
    source: extensionSource(m.id),
    staveCommands: commands.filter((c) => sharesKeyInCode(c, k.key, opts)).map((c) => c.title),
  }));
}

/** Does a search match this row? Its name, its key, and the extension's name. */
export function extensionRowMatches(row: ExtensionKeyRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.name, row.key, row.extensionName].some((s) => s.toLowerCase().includes(q));
}

// ── clashes ───────────────────────────────────────────────────────────────────────────

/**
 * Does the person's own key `chord` for this command win over an extension's key inside
 * the code? The key dispatcher (`installKeybindingDispatcher`, its capture listener) runs
 * the person's rebind there only when the keystroke cannot type text (⌘ held on a Mac,
 * Ctrl without Alt elsewhere) or the command is the palette or quick open; otherwise the
 * extension still gets the key. Stave's defaults never win.
 */
function ownKeyWinsInCode(c: CommandKeys, chord: string, opts: PlatformOpts): boolean {
  if (!c.overridden) return false;
  if (c.id.startsWith("stave.palette.") || c.id === "stave.quickOpen") return true;
  const isMac = opts.isMac ?? isMacPlatform();
  const parts = normalizeChord(chord, { isMac }).split("+");
  return parts.includes("mod") && (isMac || !parts.includes("alt"));
}

/**
 * Does this command share `key` with an extension inside the code: is it on that key, and
 * would the extension take it from the command there? A scoped command belongs to its
 * panel and never runs from the code, so it never does.
 */
function sharesKeyInCode(c: CommandKeys, key: string, opts: PlatformOpts): boolean {
  if (c.scope) return false;
  const isMac = opts.isMac ?? isMacPlatform();
  return c.chords.some((ch) => chordMatches(ch, key, { isMac }) && !ownKeyWinsInCode(c, ch, opts));
}

/** One extension taking a command's key inside the code. */
export interface ExtensionClash {
  readonly extensionId: string;
  readonly extensionName: string;
  readonly key: string;
}

/**
 * Which switched-on extensions take this command's key inside the code now (`taken` is
 * `extensionKeysInCode()`: declared and not handed back). One entry per extension.
 */
export function extensionClashes(
  c: CommandKeys,
  taken: readonly ExtensionKeyInCode[],
  opts: PlatformOpts = {},
): ExtensionClash[] {
  const out: ExtensionClash[] = [];
  for (const k of taken) {
    if (out.some((o) => o.extensionId === k.extensionId)) continue;
    if (sharesKeyInCode(c, k.key, opts)) {
      out.push({ extensionId: k.extensionId, extensionName: k.extensionName, key: k.key });
    }
  }
  return out;
}

/** The badge's words: "Inside the code, Vim uses this key". */
export function clashLine(clashes: readonly ExtensionClash[]): string {
  const names = clashes.map((c) => c.extensionName);
  const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return `Inside the code, ${who} ${names.length > 1 ? "use" : "uses"} this key`;
}

// ── the toggle ────────────────────────────────────────────────────────────────────────

/** The toggle's words: what pressing it does. */
export function toggleLabel(givenBack: boolean, extensionName: string): string {
  return givenBack ? `Use in ${extensionName}` : "Give back to Stave";
}

/** Where the key goes now, in words. */
export function whereLine(givenBack: boolean, extensionName: string): string {
  return givenBack ? "Given back to Stave" : `${extensionName} uses it`;
}

/**
 * Flip a key between the extension and Stave. Both Keyboard Shortcuts and the extension's
 * page call this, so they change the one setting the same way. Flipping back to the
 * manifest's default clears the person's choice rather than storing the default, so a
 * later change to the default reaches them.
 */
export function toggleExtensionKey(
  k: { readonly key: string; readonly givenBack: boolean; readonly givenBackByDefault: boolean },
  extensionId: string,
  set: (id: string, key: string, givenBack: boolean | null) => void = setExtensionKeyGivenBack,
): void {
  const next = !k.givenBack;
  set(extensionId, k.key, next === k.givenBackByDefault ? null : next);
}
