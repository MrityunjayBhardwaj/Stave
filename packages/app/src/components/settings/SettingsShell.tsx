"use client";

import React, { useEffect, useRef, useState } from "react";
import { SETTINGS_ROOT_CLASS, SETTINGS_SHELL_CSS } from "./shellStyles";
import { IconSearch } from "./icons";

export interface ShellTabDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  searchPlaceholder: string;
  /** Renders the pane innards (nav + content) for this surface. */
  render: (query: string) => React.ReactNode;
}

interface SettingsShellProps {
  open: boolean;
  onClose: () => void;
  /** Controlled active tab so File-menu items can open a specific surface. */
  activeTab: string;
  onTabChange: (id: string) => void;
  tabs: ShellTabDef[];
  /**
   * #2556 — what the search box holds when the window opens or the tab changes: empty
   * unless the opener asks for a search (an extension's page opens Settings on
   * `@ext:<id>`).
   */
  initialQuery?: string;
}

/**
 * The unified settings window (#739 A1). One shell, N surfaces (Settings /
 * Keyboard Shortcuts) selected by title-bar tabs. Owns the window chrome +
 * the shared search box; each surface renders its own nav + content via
 * `render(query)`. Styling lives in shellStyles.ts, scoped under the
 * `.stave-settings` root.
 */
export function SettingsShell({ open, onClose, activeTab, onTabChange, tabs, initialQuery = "" }: SettingsShellProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the search when the surface changes or the window (re)opens: to what the opener
  // asked for, else empty.
  useEffect(() => { setQuery(initialQuery); }, [activeTab, open, initialQuery]);

  // Escape closes the window. Capture-phase listeners inside a surface (the
  // keybinding capture) stopPropagation first, so this only fires when idle.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  return (
    <div
      className={`${SETTINGS_ROOT_CLASS} settings-backdrop`}
      onClick={onClose}
      data-testid="settings-shell"
    >
      <style>{SETTINGS_SHELL_CSS}</style>
      <div className="shell" role="dialog" aria-label="Stave settings" onClick={(e) => e.stopPropagation()}>
        <div className="titlebar" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              className="tab"
              role="tab"
              aria-selected={t.id === active.id}
              data-testid={`settings-tab-${t.id}`}
              onClick={() => onTabChange(t.id)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
          <div className="spacer" />
          <button className="xbtn" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <div className="searchwrap">
          <div className="search">
            <IconSearch />
            <input
              ref={inputRef}
              type="text"
              value={query}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder={active.searchPlaceholder}
              data-testid="settings-search"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  // Clear-first: Escape empties the search before closing.
                  e.stopPropagation();
                  setQuery("");
                }
              }}
            />
            {query ? <kbd className="esc">esc</kbd> : null}
          </div>
        </div>

        <div className="pane">{active.render(query)}</div>
      </div>
    </div>
  );
}
