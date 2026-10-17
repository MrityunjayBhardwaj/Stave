/**
 * Keybindings — data-driven.
 *
 * Each command declares its suggested shortcut via Command.keybinding
 * as a chord string: 'mod+n', 'mod+shift+z', 'cmd+k z' (space =
 * two-chord). The dispatcher below matches a KeyboardEvent against
 * those strings.
 *
 * User customization (#743): overrides live in a Map keyed by command id →
 * chord string, PERSISTED to localStorage (`stave:keybindings`) so a rebind
 * survives reload. Writes are write-through + notify subscribers. Persistence
 * lives here in the app package — the editor package must NOT depend on app
 * commands (layering).
 */

import { chordFromEvent, chordMatches, isMacPlatform } from "@stave/editor";
import { executeCommand, listCommands, getCommand, type Command } from "./registry";

const STORAGE_KEY = "stave:keybindings";

/** Map of command id → override chord (user customisation). */
const overrides = new Map<string, string>();

type KeybindingListener = () => void;
const keybindingListeners = new Set<KeybindingListener>();

function notifyKeybindings(): void {
  for (const l of keybindingListeners) l();
}

/** Subscribe to override changes (set / reset). Returns an unsubscribe. */
export function subscribeKeybindings(cb: KeybindingListener): () => void {
  keybindingListeners.add(cb);
  return () => { keybindingListeners.delete(cb); };
}

/** SSR-guarded: read persisted overrides once at module load. */
function loadOverrides(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [id, chord] of Object.entries(parsed)) {
      if (typeof chord === "string" && chord) overrides.set(id, chord);
    }
  } catch (err) {
    console.warn("[stave] failed to load persisted keybindings:", err);
  }
}

/** SSR-guarded: write the current overrides map through to localStorage. */
function persistOverrides(): void {
  if (typeof window === "undefined") return;
  try {
    const obj: Record<string, string> = {};
    for (const [id, chord] of overrides) obj[id] = chord;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch (err) {
    console.warn("[stave] failed to persist keybindings:", err);
  }
}

loadOverrides();

export function setKeybindingOverride(commandId: string, chord: string | null): void {
  if (chord === null) overrides.delete(commandId);
  else overrides.set(commandId, chord);
  persistOverrides();
  notifyKeybindings();
}

/** True when a command's binding has been user-overridden (differs from default). */
export function isKeybindingOverridden(commandId: string): boolean {
  return overrides.has(commandId);
}

/** Clear every user override — all commands fall back to their declared default. */
export function resetAllKeybindings(): void {
  if (overrides.size === 0) return;
  overrides.clear();
  persistOverrides();
  notifyKeybindings();
}

export function hasAnyKeybindingOverride(): boolean {
  return overrides.size > 0;
}

export function getKeybindingFor(cmd: Command): string | undefined {
  return overrides.get(cmd.id) ?? cmd.keybinding;
}

/**
 * Every chord a command answers to (#1795): the user's override alone, or the
 * declared default plus its `alternateKeybindings`. An override REPLACES the
 * alternates — a user who rebinds "Delete section" to X means X, not X as well
 * as Backspace.
 */
export function getKeybindingsFor(cmd: Command): string[] {
  const override = overrides.get(cmd.id);
  if (override) return [override];
  return [cmd.keybinding, ...(cmd.alternateKeybindings ?? [])].filter(
    (c): c is string => !!c,
  );
}

/**
 * Two commands can collide only if one keystroke could reach both (#1795): a
 * global command is reachable everywhere, a scoped one only inside its panel.
 * So a scoped/global pair collides (inside that panel the panel wins, outside it
 * the global one does), two commands of one scope collide, and two different
 * panels' commands never do.
 */
function scopesOverlap(a: Command | undefined, b: Command): boolean {
  if (!a?.scope || !b.scope) return true;
  return a.scope === b.scope;
}

/**
 * Commands whose EFFECTIVE bindings match `chord`, excluding `excludeId`.
 * Pure — used to flag conflicts when a user assigns a chord already in use.
 * Chord comparison is modifier-order-insensitive (see chordMatches). When
 * `excludeId` names a registered scoped command, commands of other panels are
 * not conflicts (see scopesOverlap).
 */
export function findConflicts(chord: string, excludeId: string): Command[] {
  if (!chord) return [];
  const self = getCommand(excludeId);
  const hits: Command[] = [];
  for (const cmd of listCommands()) {
    if (cmd.id === excludeId) continue;
    if (!scopesOverlap(self, cmd)) continue;
    if (getKeybindingsFor(cmd).some((b) => chordMatches(chord, b))) hits.push(cmd);
  }
  return hits;
}

/** Conflicts for every chord a command currently answers to (excludes itself). */
export function conflictsForCommand(commandId: string): Command[] {
  const cmd = getCommand(commandId);
  if (!cmd) return [];
  const hits = new Set<Command>();
  for (const binding of getKeybindingsFor(cmd)) {
    for (const other of findConflicts(binding, commandId)) hits.add(other);
  }
  return [...hits];
}

/** Display one chord part ('mod', 'shift', 'z') as a symbol / label. */
function formatPart(part: string, isMac: boolean): string {
  const p = part.toLowerCase();
  if (p === "mod") return isMac ? "⌘" : "Ctrl";
  if (p === "cmd" || p === "meta") return "⌘";
  if (p === "ctrl") return isMac ? "⌃" : "Ctrl";
  if (p === "shift") return isMac ? "⇧" : "Shift";
  if (p === "alt" || p === "option") return isMac ? "⌥" : "Alt";
  if (p === "space") return "Space";
  if (p === "plus") return "+";
  if (p === "enter") return "⏎";
  if (p === "escape") return "Esc";
  if (p === "tab") return "Tab";
  // #1802 — the grids' cursor keys.
  if (p === "arrowleft") return "←";
  if (p === "arrowright") return "→";
  if (p === "arrowup") return "↑";
  if (p === "arrowdown") return "↓";
  if (p.length === 1) return p.toUpperCase();
  return part[0].toUpperCase() + part.slice(1);
}

/** Format a chord for display: 'mod+shift+z' → '⌘⇧Z' on mac, 'Ctrl+Shift+Z' otherwise. */
export function formatKeybinding(chord: string): string {
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  return chord
    .split(" ")
    .map((single) =>
      single
        .split("+")
        .map((part) => formatPart(part, isMac))
        .join(isMac ? "" : "+"),
    )
    .join(" ");
}

/**
 * Split a chord into individual display tokens for per-key `<kbd>`
 * rendering. 'mod+shift+z' → ['⌘','⇧','Z']; a two-chord 'mod+k v' →
 * ['⌘','K','V']. Modifier-symbol runs are kept as separate tokens so the
 * settings shell can box each key like VS Code.
 */
export function keybindingTokens(chord: string): string[] {
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  return chord
    .split(" ")
    .flatMap((single) => single.split("+").map((part) => formatPart(part, isMac)));
}

/**
 * Chords are built and compared by the ONE builder in the editor package
 * (#1799), shared with the Shortcuts panel's capture and the grids: ⌥-letters
 * by physical key (the label is "Dead" or composed), ⇧3 as shift+3, and on a
 * Mac ⌃ as its own `ctrl`, apart from ⌘ `mod`.
 */
function eventToChord(e: KeyboardEvent): string {
  return chordFromEvent(e);
}

/** True when focus is inside a text-input context where shortcuts should defer. */
function isEditableContext(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable
  );
}

/**
 * True when focus is in the code itself (Monaco's text input), not in one of
 * Monaco's own boxes such as Find or Rename, which are plain text fields (#2100).
 */
function isCodeEditorContext(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target?.closest?.(".monaco-editor")) return false;
  return !target.closest(".find-widget, .rename-box, .monaco-inputbox");
}

/**
 * A keystroke that cannot type text (#2100): ⌘ held on a Mac; Ctrl held
 * without Alt elsewhere. Ctrl+Alt is how Windows reports AltGr, which types
 * characters (AltGr+Z is "ż" on the Polish Programmers layout), so it never
 * counts, even though the chord builder turns it into mod+alt+z.
 */
function cannotTypeText(e: KeyboardEvent): boolean {
  if (isMacPlatform()) return e.metaKey;
  return e.ctrlKey && !e.altKey;
}

/**
 * Install a global keydown listener that matches the pressed chord
 * against every registered command's keybinding and executes the first
 * match. Returns an unsubscribe.
 */
export function installKeybindingDispatcher(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const editable = isEditableContext(e);
    // In the code, a key the editor uses (⌘Z, ⌘/, ⌘D …) never gets here:
    // Monaco handles it and stops it. So whatever arrives from the code and
    // cannot type text is an app shortcut the editor left alone (#2100).
    const appKeyInCode = editable && !e.defaultPrevented && isCodeEditorContext(e) && cannotTypeText(e);
    const chord = eventToChord(e);
    for (const cmd of listCommands()) {
      // A scoped command belongs to its panel, which matches its own keys
      // (matchScopedCommand). Running it from here would fire `S` or `Delete`
      // wherever focus happens to be (#1795).
      if (cmd.scope) continue;
      if (!getKeybindingsFor(cmd).some((b) => chordMatches(chord, b))) continue;
      // Stay out of the way when focus is in an INPUT / TEXTAREA /
      // contentEditable so the user can type freely (a rename box, a search
      // field). Three things still pass: the palette and quick open, which
      // are explicitly global, and in the code, an app shortcut the editor
      // doesn't use (appKeyInCode).
      if (editable && !appKeyInCode) {
        if (!cmd.id.startsWith("stave.palette.") && cmd.id !== "stave.quickOpen") {
          continue;
        }
      }
      e.preventDefault();
      e.stopPropagation();
      executeCommand(cmd.id);
      return;
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

/**
 * #1795 — the command of `scope` that this keystroke is bound to, if any. A
 * panel calls this from its own key handler, so a rebind made in Settings
 * reaches it. Matching is exact, modifiers included: ⌘⇧D is not ⌘D (#1421), and
 * a plain `Backspace` binding is not reached by ⌘⇧Backspace.
 */
export function matchScopedCommand(scope: string, e: KeyboardEvent): Command | undefined {
  const chord = eventToChord(e);
  for (const cmd of listCommands()) {
    if (cmd.scope !== scope) continue;
    if (getKeybindingsFor(cmd).some((b) => chordMatches(chord, b))) return cmd;
  }
  return undefined;
}
