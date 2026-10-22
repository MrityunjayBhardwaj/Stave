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
 * - B3: editor-owned Monaco keys render as read-only "System" rows in an
 *   "Editor" category — searchable, but not rebindable (dispatcher-skipped).
 */
export function KeyboardShortcutsPanel({ query }: KeyboardShortcutsPanelProps) {
  const [ver, force] = useState(0);
  const tick = () => force((t) => t + 1);
  const [activeCat, setActiveCat] = useState("all");
  const [capturingId, setCapturingId] = useState<string | null>(null);

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

  const rowMatches = (r: Row): boolean =>
    !q || `${r.cmd.category ?? ""} ${r.cmd.title}`.toLowerCase().includes(q);
  const editorKeyMatches = (name: string): boolean => !q || name.toLowerCase().includes(q);

  const totalCount = listCommands().length + EDITOR_OWNED_KEYS.length;
  const editorMatchCount = EDITOR_OWNED_KEYS.filter((k) => editorKeyMatches(k.name)).length;

  // Which categories to render (command cats + the synthetic Editor group).
  const showCat = (cat: string): boolean => {
    if (searching) return true;
    return activeCat === "all" || activeCat === cat;
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
        </div>
        <div className="kb-right">
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
      </nav>

      <div className="content" tabIndex={-1} data-testid="keys-content">
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
                <div className="kb-cmd"><div className="kb-name">{k.name}</div></div>
                <div className="kb-right">
                  <span className="tag">System</span>
                  <span className="chord system" data-testid={`system-${k.name}`}>
                    {keybindingTokens(k.chord).map((t, i) => <kbd key={i}>{t}</kbd>)}
                  </span>
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {searching &&
        commandCats.every((cat) => (byCat.get(cat) ?? []).filter(rowMatches).length === 0) &&
        editorMatchCount === 0 ? (
          <div className="empty">No shortcuts match “{query}”.</div>
        ) : null}
      </div>
    </>
  );
}
