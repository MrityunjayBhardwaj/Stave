"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { TransportLCD } from "./TransportLCD";
import { TimeSignatureControl } from "./TimeSignatureControl";
import { useMenubarLcd } from "../state/menubarLcd";
import { buildMenus, type MenuActions, type MenuEntry } from "./menuModel";

// kept here for the callers that already import it from the menu bar
export { GITHUB_REPO_URL } from "./menuModel";

// Backdrop selection used to live in a menubar bg-indicator + popover here.
// As of #347 the backdrop is per-tab, set from the pattern bar's "set bg"
// dropdown (and VizEditorChrome), so the menubar no longer owns it.
//
// What the menus do is `MenuActions` (#2000): the list of items is built in
// `menuModel`, which the phone's drawer draws as well.
interface MenuBarProps extends MenuActions {
  projectName: string;
  /** Transport LCD data (#857). Fed from the active runtime in StaveApp. */
  isPlaying: boolean;
  /** The song position the playhead reads (#1725), not cycles since Play. */
  getSongPosition: () => number | null;
  getCps: () => number | null;
  /** The active runtime's counts of late notes and audio underruns (#1348). */
  getAudioHealth: () => { lateNotes: number; underruns: number | null } | null;
  /** The active file's last evaluation error, or null (#1348). */
  evalError: string | null;
  /** The eval lamp was pressed: reveal the latest error, or open the Console. */
  onEvalLamp: () => void;
}

type MenuId = "file" | "edit" | "view" | "help" | null;

export function MenuBar({
  projectName: _projectName,
  isPlaying,
  getSongPosition,
  getCps,
  getAudioHealth,
  evalError,
  onEvalLamp,
  ...actions
}: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<MenuId>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const lcdEnabled = useMenubarLcd();

  // Close menu on click outside OR Escape
  useEffect(() => {
    if (!openMenu) return;
    const mouseHandler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("mousedown", mouseHandler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", mouseHandler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [openMenu]);

  const clickItem = useCallback((action: () => void) => {
    setOpenMenu(null);
    action();
  }, []);

  return (
    <div ref={barRef} style={styles.bar}>
      {buildMenus(actions).map((menu) => (
        <MenuButton
          key={menu.id}
          label={menu.label}
          open={openMenu === menu.id}
          onClick={() => setOpenMenu(openMenu === menu.id ? null : menu.id)}
        >
          <MenuEntries entries={menu.items} run={clickItem} />
        </MenuButton>
      ))}

      {lcdEnabled ? (
        <div style={styles.centerSlot}>
          <TransportLCD
            isPlaying={isPlaying}
            getSongPosition={getSongPosition}
            getCps={getCps}
            getAudioHealth={getAudioHealth}
            evalError={evalError}
            onEvalLamp={onEvalLamp}
          />
          <TimeSignatureControl />
        </div>
      ) : (
        <div data-stave-brand style={styles.brand} aria-hidden="true">
          Stave Code
        </div>
      )}

      <div style={styles.spacer} />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

/** A menu's entries, drawn as the dropdown draws them. `run` closes the menu first. */
function MenuEntries({ entries, run }: { entries: readonly MenuEntry[]; run: (action: () => void) => void }) {
  return (
    <>
      {entries.map((e, i) =>
        e.kind === "divider" ? (
          <MenuDivider key={i} />
        ) : e.kind === "submenu" ? (
          <MenuSubmenu key={i} label={e.label}>
            <MenuEntries entries={e.items} run={run} />
          </MenuSubmenu>
        ) : (
          <MenuItem key={i} label={e.label} shortcut={e.shortcut} onClick={() => run(e.run)} disabled={e.disabled} />
        ),
      )}
    </>
  );
}

function MenuButton({
  label, open, onClick, children,
}: {
  label: string;
  open: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={styles.menuButtonWrap}>
      <button
        onClick={onClick}
        style={{ ...styles.menuButton, ...(open ? styles.menuButtonOpen : {}) }}
      >
        {label}
      </button>
      {open && <div style={styles.dropdown}>{children}</div>}
    </div>
  );
}

function MenuItem({
  label, shortcut, onClick, disabled,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      data-stave-menu-item
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{ ...styles.menuItem, ...(disabled ? styles.menuItemDisabled : {}) }}
    >
      <span style={styles.menuItemLabel}>{label}</span>
      {shortcut && <span style={styles.shortcut}>{shortcut}</span>}
    </button>
  );
}

/**
 * A menu item that opens a second list beside it (#2020). It opens on hover and
 * on a press — a press only ever opens, so a mouse that hovered first does not
 * close it again by clicking — and closes when the pointer leaves or the menu does.
 */
function MenuSubmenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={styles.submenuWrap}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        data-stave-menu-item
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        style={{ ...styles.menuItem, ...(open ? styles.menuButtonOpen : {}) }}
      >
        <span>{label}</span>
        <span aria-hidden style={styles.shortcut}>▸</span>
      </button>
      {open && (
        <div role="menu" aria-label={label} style={styles.submenu}>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuDivider() {
  return <div style={styles.divider} />;
}

// ── Styles ─────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  bar: {
    position: "relative" as const,
    display: "flex",
    alignItems: "center",
    height: 28,
    background: "var(--bg-chrome)",
    borderBottom: "1px solid var(--border-subtle)",
    color: "var(--text-chrome)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: 12,
    userSelect: "none",
    paddingLeft: 6,
  },
  brand: {
    position: "absolute" as const,
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    pointerEvents: "none" as const,
    color: "var(--text-secondary)",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: 0.4,
    whiteSpace: "nowrap" as const,
  },
  centerSlot: {
    position: "absolute" as const,
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    // The readout and the signature it counts in read as one cluster.
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  menuButtonWrap: {
    position: "relative" as const,
  },
  menuButton: {
    background: "none",
    border: "none",
    color: "var(--text-chrome)",
    padding: "4px 10px",
    cursor: "pointer",
    fontSize: 12,
    borderRadius: 3,
  },
  menuButtonOpen: {
    background: "var(--bg-hover)",
  },
  dropdown: {
    position: "absolute" as const,
    top: "100%",
    left: 0,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 4,
    padding: "4px 0",
    zIndex: 9998,
    minWidth: 200,
    boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
  },
  menuItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    padding: "5px 14px",
    background: "none",
    border: "none",
    color: "var(--text-chrome)",
    fontSize: 12,
    textAlign: "left" as const,
    cursor: "pointer",
  },
  submenuWrap: {
    position: "relative" as const,
  },
  submenu: {
    position: "absolute" as const,
    top: -5,
    left: "100%",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 4,
    padding: "4px 0",
    zIndex: 9999,
    minWidth: 200,
    maxWidth: 320,
    boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
  },
  menuItemDisabled: {
    color: "var(--text-disabled)",
    cursor: "default",
  },
  menuItemLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    minWidth: 0,
  },
  shortcut: {
    color: "var(--text-muted)",
    fontSize: 11,
    marginLeft: 20,
    flex: "none",
    whiteSpace: "nowrap" as const,
  },
  divider: {
    height: 1,
    background: "var(--border-subtle)",
    margin: "4px 0",
  },
  spacer: {
    flex: 1,
  },
};
