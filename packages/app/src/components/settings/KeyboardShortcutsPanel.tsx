"use client";

import React, { useEffect, useMemo, useState } from "react";
import { chordFromEvent, isModifierOnlyKey } from "@stave/editor";
import { listCommands, subscribeToCommands, type Command } from "../../commands/registry";
import {
  keybindingTokens,
  getKeybindingFor,
  getKeybindingsFor,
  setKeybindingOverride,
  subscribeKeybindings,
  isKeybindingOverridden,
  resetAllKeybindings,
  hasAnyKeybindingOverride,
  conflictsForCommand,
} from "../../commands/keybindings";
import { EDITOR_OWNED_KEYS, EDITOR_OWNED_CATEGORY } from "./editorOwnedKeys";
import { IconWarn } from "./icons";
import {
  clashLine,
  commandSource,
  extensionClashes,
  extensionKeyRows,
  extensionRowMatches,
  extensionSource,
  liveFilter,
  sourceLabel,
  sourceOptions,
  sourceShows,
  toggleExtensionKey,
  toggleLabel,
  whereLine,
  withKeys,
  type CommandKeys,
  type ExtensionKeyRow,
  type KeySource,
  type SourceFilter,
} from "../../extensions/extensionKeysView";
import { useExtensionKeysSource, useExtensionKeysVersion } from "../../extensions/useExtensionKeys";

interface KeyboardShortcutsPanelProps {
  query: string;
}

interface Row {
  cmd: Command;
  binding: string;
}

/**
 * The Keyboard Shortcuts surface (#739 Phase B) inside the shell pane.
 *
 * - B1: rebinds persist (via commands/keybindings.ts) and survive reload;
 *   the panel subscribes so it re-renders on any override change.
 * - B2: inline conflict badge when a chord collides with another command;
 *   per-binding reset (only shown when overridden) + a global
 *   "Reset all keybindings".
 * - B3: editor-owned Monaco keys render as read-only rows in an "Editor"
 *   category — searchable, but not rebindable (dispatcher-skipped).
 * - #2545, as VS Code's Keyboard Shortcuts: every row says where it comes from
 *   (Source: Stave, You, or an extension) and the list can be narrowed to one
 *   source. While an extension that declares keys is on, its keys are read-only
 *   rows in a group of their own, each with "Give back to Stave" / "Use in …"
 *   (the extension's own setting, the same one its page shows), and a Stave
 *   command whose key it takes inside the code carries a conflict badge. Switched
 *   off, its rows and badges go. Nothing here writes the person's shortcuts
 *   except their own rebinds and resets.
 */
export function KeyboardShortcutsPanel({ query }: KeyboardShortcutsPanelProps) {
  const [ver, force] = useState(0);
  const tick = () => force((t) => t + 1);
  const [chosenCat, setActiveCat] = useState("all");
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [chosenSource, setSource] = useState<SourceFilter>("all");
  const extensionKeys = useExtensionKeysSource();
  const extVer = useExtensionKeysVersion();

  useEffect(() => subscribeToCommands(tick), []);
  useEffect(() => subscribeKeybindings(tick), []);

  // Capture: while capturing, the next non-modifier keydown becomes the
  // binding; Escape cancels. Capture-phase + stopPropagation so it never
  // reaches the shell's Escape-to-close handler.
  useEffect(() => {
    if (!capturingId) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setCapturingId(null); return; }
      if (isModifierOnlyKey(e)) return;
      // The dispatcher's own builder (#1799), so the chord recorded here is the
      // chord that will match — ⌥⌘K, ⇧3 and ⌃⌫ included.
      setKeybindingOverride(capturingId, chordFromEvent(e)); // persists + notifies
      setCapturingId(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturingId]);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const { commandCats, byCat } = useMemo(() => {
    const rows: Row[] = listCommands().map((c) => ({ cmd: c, binding: getKeybindingFor(c) ?? "" }));
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const cat = r.cmd.category ?? "Misc";
      const list = map.get(cat) ?? [];
      list.push(r);
      map.set(cat, list);
    }
    const cats = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
    return { commandCats: cats, byCat: map };
    // `ver` bumps on every command/keybinding change so the memoised rows
    // (which snapshot each command's binding) refresh after a rebind/reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, ver]);

  // #2545 — the switched-on extensions that declare keys, their rows, and the keys they
  // take in the code now. Read fresh whenever an extension switches or a key is handed
  // back (`extVer`), or a rebind changes which Stave commands share a key (`ver`).
  const { extensions, extensionGroups, taken, commandKeys } = useMemo(() => {
    const keysOf = (c: Command): CommandKeys => ({
      id: c.id,
      title: c.title,
      scope: c.scope,
      chords: getKeybindingFor(c) ? getKeybindingsFor(c) : [],
      overridden: isKeybindingOverridden(c.id),
    });
    const all = listCommands().map(keysOf);
    const exts = withKeys(extensionKeys.active());
    return {
      extensions: exts,
      extensionGroups: exts.map((m) => ({ manifest: m, rows: extensionKeyRows(m, all) })),
      taken: extensionKeys.taken(),
      commandKeys: keysOf,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensionKeys, extVer, ver]);
  const source = liveFilter(chosenSource, extensions);
  // An extension's nav item goes when it is switched off; showing nothing under it would look broken.
  const activeCat =
    chosenCat.startsWith("extension:") && !extensionGroups.some((g) => extensionSource(g.manifest.id) === chosenCat)
      ? "all"
      : chosenCat;

  const rowSource = (r: Row): KeySource => commandSource(isKeybindingOverridden(r.cmd.id));
  const rowMatches = (r: Row): boolean =>
    (!q || `${r.cmd.category ?? ""} ${r.cmd.title}`.toLowerCase().includes(q)) && sourceShows(source, rowSource(r));
  const editorKeyMatches = (name: string): boolean =>
    (!q || name.toLowerCase().includes(q)) && sourceShows(source, "stave");
  const extensionRowShows = (r: ExtensionKeyRow): boolean => extensionRowMatches(r, q) && sourceShows(source, r.source);

  const extensionRowCount = extensionGroups.reduce((n, g) => n + g.rows.length, 0);
  const totalCount = listCommands().length + EDITOR_OWNED_KEYS.length + extensionRowCount;
  const editorMatchCount = EDITOR_OWNED_KEYS.filter((k) => editorKeyMatches(k.name)).length;
  const extensionMatchCount = extensionGroups.reduce((n, g) => n + g.rows.filter(extensionRowShows).length, 0);

  // Which categories to render (command cats + the synthetic Editor group + one per extension).
  const showCat = (cat: string): boolean => {
    if (searching) return true;
    return activeCat === "all" || activeCat === cat;
  };

  const sourceTag = (s: KeySource, testId: string): React.ReactNode => (
    <span
      className={`tag kb-src${s.startsWith("extension:") ? " ext" : ""}`}
      data-testid={testId}
      data-source={s}
      title="Source"
    >
      {sourceLabel(s, extensions)}
    </span>
  );

  /** "Inside the code, Vim uses this key", under a Stave command or editor key an extension takes. */
  const clashBadge = (c: CommandKeys, testId: string): React.ReactNode => {
    const clashes = extensionClashes(c, taken);
    if (!clashes.length) return null;
    return (
      <div className="conflict" data-testid={testId}>
        <IconWarn /> {clashLine(clashes)}
      </div>
    );
  };

  const renderChord = (r: Row): React.ReactNode => {
    const capturing = capturingId === r.cmd.id;
    // Every chord the command answers to, not just the first (#1795): "Delete
    // section" is Delete OR Backspace, and showing one would hide the key a Mac
    // keyboard actually sends.
    const chords = r.binding ? getKeybindingsFor(r.cmd) : [];
    return (
      <button
        className={`chord${capturing ? " capturing" : ""}${r.binding ? "" : " unbound"}`}
        data-testid={`chord-${r.cmd.id}`}
        onClick={() => setCapturingId(capturing ? null : r.cmd.id)}
        title={r.binding ? "Click to rebind" : "Click to bind"}
      >
        {capturing ? (
          <kbd>Press keys…</kbd>
        ) : chords.length ? (
          chords.map((chord, c) => (
            <React.Fragment key={chord}>
              {c > 0 ? <span className="kb-or">or</span> : null}
              {keybindingTokens(chord).map((t, i) => <kbd key={i}>{t}</kbd>)}
            </React.Fragment>
          ))
        ) : (
          <kbd>Add binding</kbd>
        )}
      </button>
    );
  };

  const renderCommandRow = (r: Row): React.ReactNode => {
    const conflicts = r.binding ? conflictsForCommand(r.cmd.id) : [];
    const overridden = isKeybindingOverridden(r.cmd.id);
    return (
      <div className="kb-row" key={r.cmd.id}>
        <div className="kb-cmd">
          <div className="kb-name">{r.cmd.title}</div>
          {/* A scoped command only works inside its panel — say where (#1795). */}
          {r.cmd.where || (r.cmd.scope && r.cmd.description) ? (
            <div className="kb-when" data-testid={`when-${r.cmd.id}`}>{r.cmd.where ?? r.cmd.description}</div>
          ) : null}
          {conflicts.length ? (
            <div className="conflict" data-testid={`conflict-${r.cmd.id}`}>
              <IconWarn /> Also bound to{" "}
              <strong style={{ margin: "0 3px" }}>{conflicts.map((c) => c.title).join(", ")}</strong> — one will win.
            </div>
          ) : null}
          {clashBadge(commandKeys(r.cmd), `ext-conflict-${r.cmd.id}`)}
        </div>
        <div className="kb-right">
          {sourceTag(rowSource(r), `source-${r.cmd.id}`)}
          {overridden ? (
            <button
              className="kb-reset"
              title="Reset to default"
              data-testid={`reset-${r.cmd.id}`}
              onClick={() => setKeybindingOverride(r.cmd.id, null)}
            >
              ↺
            </button>
          ) : null}
          {renderChord(r)}
        </div>
      </div>
    );
  };

  /** One of an extension's keys: read-only, with the toggle between the extension and Stave. */
  const renderExtensionRow = (r: ExtensionKeyRow): React.ReactNode => {
    const id = `${r.extensionId}-${r.key}`;
    return (
      <div
        className={`kb-row${r.givenBack ? " given" : ""}`}
        key={id}
        data-testid={`ext-key-${id}`}
        data-given-back={r.givenBack ? "true" : "false"}
      >
        <div className="kb-cmd">
          <div className="kb-name">{r.name}</div>
          <div className="kb-when" data-testid={`ext-where-${id}`}>
            inside the code · {whereLine(r.givenBack, r.extensionName)}
          </div>
          {r.staveCommands.length ? (
            <div className="kb-when">
              {r.givenBack ? "Runs" : "Outside the code, runs"} Stave’s {r.staveCommands.join(", ")}
            </div>
          ) : null}
        </div>
        <div className="kb-right">
          <button
            type="button"
            className="kb-give"
            data-testid={`ext-toggle-${id}`}
            aria-pressed={r.givenBack}
            onClick={() => toggleExtensionKey(r, r.extensionId)}
          >
            {toggleLabel(r.givenBack, r.extensionName)}
          </button>
          {sourceTag(r.source, `source-${id}`)}
          <span className="chord system" title="Declared by the extension; not rebindable here">
            {keybindingTokens(r.key).map((t, i) => <kbd key={i}>{t}</kbd>)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <>
      <nav className="nav">
        <div className="nav-eyebrow">Commands</div>
        <button className="nav-item" aria-current={!searching && activeCat === "all"} onClick={() => setActiveCat("all")}>
          <span>All</span>
          <span className="nav-count">{totalCount}</span>
        </button>
        {commandCats.map((cat) => (
          <button key={cat} className="nav-item" aria-current={!searching && activeCat === cat} onClick={() => setActiveCat(cat)}>
            <span>{cat}</span>
            <span className="nav-count">{byCat.get(cat)!.length}</span>
          </button>
        ))}
        <button
          className="nav-item"
          aria-current={!searching && activeCat === EDITOR_OWNED_CATEGORY}
          onClick={() => setActiveCat(EDITOR_OWNED_CATEGORY)}
        >
          <span>{EDITOR_OWNED_CATEGORY}</span>
          <span className="nav-count">{EDITOR_OWNED_KEYS.length}</span>
        </button>
        {extensionGroups.length ? <div className="nav-eyebrow">Extensions</div> : null}
        {extensionGroups.map((g) => {
          const cat = extensionSource(g.manifest.id);
          return (
            <button
              key={cat}
              className="nav-item"
              data-testid={`keys-nav-${cat}`}
              aria-current={!searching && activeCat === cat}
              onClick={() => setActiveCat(cat)}
            >
              <span>{g.manifest.name}</span>
              <span className="nav-count">{g.rows.length}</span>
            </button>
          );
        })}
      </nav>

      <div className="content" tabIndex={-1} data-testid="keys-content">
        <div className="src-filter" role="group" aria-label="Source" data-testid="source-filter">
          <span>Source</span>
          {sourceOptions(extensions).map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={source === o.id}
              data-testid={`source-filter-${o.id}`}
              onClick={() => setSource(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {hasAnyKeybindingOverride() ? (
          <div className="grp-head" style={{ paddingTop: 10 }}>
            <button className="reset" data-testid="reset-all-keybindings" onClick={() => resetAllKeybindings()}>
              ↺ Reset all keybindings
            </button>
          </div>
        ) : null}

        {commandCats.map((cat) => {
          if (!showCat(cat)) return null;
          const rows = (byCat.get(cat) ?? []).filter(rowMatches);
          if (rows.length === 0) return null;
          return (
            <section className="grp" key={cat} data-testid={`keys-section-${cat}`}>
              <div className="grp-head"><div className="grp-title">{cat}</div></div>
              {rows.map(renderCommandRow)}
            </section>
          );
        })}

        {/* B3 — read-only editor-owned Monaco keys. */}
        {showCat(EDITOR_OWNED_CATEGORY) && editorMatchCount > 0 ? (
          <section className="grp" data-testid={`keys-section-${EDITOR_OWNED_CATEGORY}`}>
            <div className="grp-head">
              <div className="grp-title">{EDITOR_OWNED_CATEGORY}</div>
              <span className="badge">Owned by the code editor</span>
            </div>
            <div className="grp-note">
              These live in the Monaco editor, not the command registry — shown for reference, not yet rebindable here.
            </div>
            {EDITOR_OWNED_KEYS.filter((k) => editorKeyMatches(k.name)).map((k) => (
              <div className="kb-row" key={k.name}>
                <div className="kb-cmd">
                  <div className="kb-name">{k.name}</div>
                  {clashBadge(
                    { id: k.name, title: k.name, chords: [k.chord], overridden: false },
                    `ext-conflict-${k.name}`,
                  )}
                </div>
                <div className="kb-right">
                  {sourceTag("stave", `source-${k.name}`)}
                  <span className="chord system" data-testid={`system-${k.name}`}>
                    {keybindingTokens(k.chord).map((t, i) => <kbd key={i}>{t}</kbd>)}
                  </span>
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {/* #2545 — each switched-on extension's keys: read-only, inside the code. */}
        {extensionGroups.map((g) => {
          const cat = extensionSource(g.manifest.id);
          const rows = g.rows.filter(extensionRowShows);
          if (!showCat(cat) || rows.length === 0) return null;
          return (
            <section className="grp" key={cat} data-testid={`keys-section-${cat}`}>
              <div className="grp-head">
                <div className="grp-title">{g.manifest.name}</div>
                <span className="badge">From the {g.manifest.name} extension</span>
              </div>
              <div className="grp-note">
                Keys {g.manifest.name} uses inside the code while it is on. They are not your shortcuts and can’t
                be rebound here; give one back and Stave’s own command runs there instead. The same choice is on
                the extension’s page.
              </div>
              {rows.map(renderExtensionRow)}
            </section>
          );
        })}

        {commandCats.every((cat) => (byCat.get(cat) ?? []).filter(rowMatches).length === 0) &&
        editorMatchCount === 0 &&
        extensionMatchCount === 0 ? (
          <div className="empty" data-testid="keys-empty">
            {searching ? <>No shortcuts match “{query}”.</> : source === "you" ? <>You haven’t changed any shortcuts yet.</> : <>No shortcuts here.</>}
          </div>
        ) : null}
      </div>
    </>
  );
}
