/**
 * Editor-owned Monaco keys (#745).
 *
 * These shortcuts live in scattered Monaco / editor handlers OUTSIDE the app
 * command registry, so they are not dispatched by installKeybindingDispatcher
 * and cannot (yet) be rebound here. Rather than hide them — which would read
 * as "Stave has no Run shortcut" — we surface them as READ-ONLY "System" rows
 * for reference. Rerouting Monaco through the registry is deliberately out of
 * scope (decision D2).
 *
 * Chords are in the same `mod+key` form the rest of the shell uses, so
 * `keybindingTokens` renders them identically (⌘⏎, ⌘., ⌘/, ⇧⌥F).
 */

export interface EditorOwnedKey {
  readonly name: string;
  readonly chord: string;
  /**
   * The code editor's Monaco action for this key (EditorView's `addAction`).
   * With an extension on, the key dispatcher runs it before any extension sees
   * the key, unless the extension declares that key and it is not handed back
   * (#2513), so an extension cannot silently break Play or Stop.
   */
  readonly actionId?: string;
}

export const EDITOR_OWNED_KEYS: readonly EditorOwnedKey[] = [
  { name: "Run / Evaluate", chord: "mod+enter", actionId: "stave.play" },
  { name: "Stop", chord: "mod+.", actionId: "stave.stop" },
  { name: "Toggle Line Comment", chord: "mod+/" },
  { name: "Format Document", chord: "shift+alt+f" },
];

/** Nav / display label for the read-only editor-owned group. */
export const EDITOR_OWNED_CATEGORY = "Editor";
