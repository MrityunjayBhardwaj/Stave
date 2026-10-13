"use client";

import React, { useEffect, useState } from "react";
import { listPanels, subscribeToPanels, type Panel } from "../panels/registry";
import { Icon } from "./Icon";
import type { Menu, MenuEntry } from "./menuModel";

/**
 * The phone's drawer (#2000): everything the desktop keeps in its left rail, side
 * panel and menu bar, behind one button.
 *
 * On a phone held upright the rail and side panel take 284 of ~390 px and leave the
 * code about a hundred. So on a phone they are not drawn beside the code; they are
 * drawn here, over it, and only while asked for.
 *
 * NOTHING IS LEFT OUT, and both halves are so by construction:
 *   - the tabs across the top are the panel registry's — the list the rail draws —
 *     so a panel added to the rail is in the drawer;
 *   - the Menu tab draws the list the desktop menu bar draws (`menuModel`).
 *
 * The drawer has no state of its own about WHICH panel is showing: that is the shell's
 * `activePanelId`, the same one the rail writes. So everything in the app that opens a
 * panel — the eval lamp opening the Console, "File History", a sound picker opening
 * the Library — opens the drawer on it, with no second list of call sites to keep.
 */

/** the drawer's own tab, beside the registry's panels */
export const PHONE_MENU_TAB = "phone-menu";

const READOUT_WRAP = `
  [data-phone-drawer-readout] .stave-lcd { flex-wrap: wrap; height: auto; max-width: 100%; }
  [data-phone-drawer-readout] .stave-lcd-seg { height: 22px; }
`;

/** the smallest thing a finger can hit reliably */
const TOUCH = 44;

interface PhoneDrawerProps {
  /** the panel showing, or `PHONE_MENU_TAB`; null = closed */
  readonly openOn: string | null;
  readonly projectName: string;
  readonly onSelect: (id: string) => void;
  readonly onClose: () => void;
  /** the panel's content — the same element the side panel would hold */
  readonly renderPanel: (id: string) => React.ReactNode;
  readonly menus: readonly Menu[];
  /** drawn at the top of the Menu tab: the full transport readout */
  readonly readout: React.ReactNode;
  /** the phone is held sideways: spend one row above the panel, not two (#2003) */
  readonly sideways?: boolean;
}

export function PhoneDrawer({ openOn, projectName, onSelect, onClose, renderPanel, menus, readout, sideways = false }: PhoneDrawerProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeToPanels(() => setTick((t) => t + 1)), []);
  const panels: Panel[] = React.useMemo(() => listPanels(), [tick]);

  // unread counts, as on the rail
  const [, setBadgeTick] = useState(0);
  useEffect(() => {
    const unsubs = panels.filter((p) => p.badge).map((p) => p.badge!.subscribe(() => setBadgeTick((t) => t + 1)));
    return () => {
      for (const u of unsubs) u();
    };
  }, [panels]);

  useEffect(() => {
    if (openOn === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openOn, onClose]);

  // Held sideways (#2003) the screen is about 360 px tall, and a row for the project's
  // name above a row of tabs is a quarter of it. So sideways there is one row: the
  // tabs, with Close at its end. The project's name is at the top of the Menu tab.
  const oneRow = sideways;

  if (openOn === null) return null;

  const closeButton = (
    <button type="button" style={styles.iconButton} aria-label="Close" data-phone-drawer-close onClick={onClose}>
      <Icon name="close" size="18px" />
    </button>
  );

  return (
    <div style={styles.layer} data-phone-drawer-layer>
      {/* a tap beside the drawer closes it */}
      <div style={styles.scrim} data-phone-drawer-scrim onClick={onClose} />
      <div style={styles.drawer} data-phone-drawer role="dialog" aria-label="Project and menus">
        {!oneRow && (
          <div style={styles.head}>
            <span style={styles.project} data-phone-drawer-project>
              {projectName}
            </span>
            {closeButton}
          </div>
        )}

        <div style={styles.tabs} role="tablist" aria-label="Panels" data-phone-drawer-tabs>
          {panels.map((p) => {
            const count = p.badge?.get() ?? 0;
            const tone = count > 0 ? p.badge?.tone?.() ?? "danger" : "danger";
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={openOn === p.id}
                aria-label={count > 0 ? `${p.title}, ${count} unread` : p.title}
                data-phone-drawer-tab={p.id}
                style={{ ...styles.tab, ...(openOn === p.id ? styles.tabOn : {}) }}
                onClick={() => {
                  if (openOn !== p.id) p.badge?.clear?.();
                  onSelect(p.id);
                }}
              >
                <Icon name={p.icon} size="20px" />
                {count > 0 && (
                  <span
                    aria-hidden="true"
                    data-panel-badge={p.id}
                    data-badge-tone={tone}
                    style={{ ...styles.badge, background: tone === "warning" ? "var(--warning-fg, #d7a531)" : "var(--danger-fg, #e5484d)" }}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            role="tab"
            aria-selected={openOn === PHONE_MENU_TAB}
            aria-label="Menu"
            data-phone-drawer-tab={PHONE_MENU_TAB}
            style={{ ...styles.tab, ...(openOn === PHONE_MENU_TAB ? styles.tabOn : {}) }}
            onClick={() => onSelect(PHONE_MENU_TAB)}
          >
            <Icon name="ellipsis" size="20px" />
          </button>
          {oneRow && closeButton}
        </div>

        <div style={styles.body} data-phone-drawer-body={openOn}>
          {openOn === PHONE_MENU_TAB ? (
            <div style={styles.menuScroll}>
              {oneRow && (
                <div style={{ ...styles.project, flex: "none", padding: "10px 16px 0" }} data-phone-drawer-project>
                  {projectName}
                </div>
              )}
              <div style={styles.readout} data-phone-drawer-readout>
                {/* the desktop's readout is one row about 520 px long; here its cells
                    wrap onto as many rows as the drawer needs, so none is cut off */}
                <style>{READOUT_WRAP}</style>
                {readout}
              </div>
              {menus.map((m) => (
                <section key={m.id} data-phone-menu={m.id} aria-label={m.label}>
                  <div style={styles.menuTitle}>{m.label}</div>
                  <MenuRows entries={m.items} onRan={onClose} depth={0} />
                </section>
              ))}
            </div>
          ) : (
            renderPanel(openOn)
          )}
        </div>
      </div>
    </div>
  );
}

/** A menu's entries as full-width rows; a submenu is opened out in place, indented. */
function MenuRows({ entries, onRan, depth }: { entries: readonly MenuEntry[]; onRan: () => void; depth: number }) {
  return (
    <>
      {entries.map((e, i) => {
        if (e.kind === "divider") return <div key={i} style={styles.divider} />;
        if (e.kind === "submenu") {
          return (
            <div key={i} role="group" aria-label={e.label}>
              <div style={{ ...styles.subTitle, paddingLeft: 16 + depth * 14 }}>{e.label}</div>
              <MenuRows entries={e.items} onRan={onRan} depth={depth + 1} />
            </div>
          );
        }
        return (
          <button
            key={i}
            type="button"
            data-stave-menu-item
            disabled={e.disabled}
            style={{ ...styles.row, paddingLeft: 16 + depth * 14, ...(e.disabled ? styles.rowOff : {}) }}
            onClick={() => {
              // the drawer goes first: what the item opens (a dialog, a picker) must not
              // open underneath it
              onRan();
              e.run();
            }}
          >
            <span style={styles.rowLabel}>{e.label}</span>
            {e.shortcut && !/[⌘⇧⌥⌃]/.test(e.shortcut) && <span style={styles.rowNote}>{e.shortcut}</span>}
          </button>
        );
      })}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  layer: {
    position: "fixed",
    inset: 0,
    zIndex: 9000,
    display: "flex",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  scrim: {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
  },
  drawer: {
    position: "relative",
    width: "min(86vw, 360px)",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-panel)",
    borderRight: "1px solid var(--border-strong)",
    boxShadow: "4px 0 16px rgba(0,0,0,0.4)",
    color: "var(--text-chrome)",
    // a notch or a rounded corner must not sit over the first tab
    paddingTop: "env(safe-area-inset-top)",
    paddingLeft: "env(safe-area-inset-left)",
    paddingBottom: "env(safe-area-inset-bottom)",
    boxSizing: "border-box",
  },
  head: {
    display: "flex",
    alignItems: "center",
    minHeight: TOUCH,
    paddingLeft: 16,
    borderBottom: "1px solid var(--border-subtle)",
    flex: "none",
  },
  project: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  iconButton: {
    width: TOUCH,
    height: TOUCH,
    flex: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "none",
    border: "none",
    color: "var(--text-chrome)",
    cursor: "pointer",
  },
  tabs: {
    display: "flex",
    flex: "none",
    borderBottom: "1px solid var(--border-subtle)",
    background: "var(--bg-chrome)",
  },
  tab: {
    position: "relative",
    flex: "1 1 0",
    minWidth: 0,
    height: TOUCH,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "none",
    border: "none",
    color: "var(--text-icon-muted)",
    cursor: "pointer",
  },
  tabOn: {
    color: "var(--text-primary)",
    boxShadow: "inset 0 -2px 0 var(--accent, #7c7cff)",
  },
  badge: {
    position: "absolute",
    top: 6,
    right: "calc(50% - 18px)",
    minWidth: 14,
    height: 14,
    padding: "0 3px",
    borderRadius: 7,
    color: "#fff",
    fontSize: 9,
    fontWeight: 700,
    lineHeight: "14px",
    textAlign: "center",
    boxSizing: "border-box",
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  menuScroll: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
  },
  readout: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    padding: "10px 12px",
    borderBottom: "1px solid var(--border-subtle)",
  },
  menuTitle: {
    padding: "12px 16px 4px",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "var(--text-secondary)",
  },
  subTitle: {
    paddingTop: 8,
    paddingRight: 16,
    paddingBottom: 2,
    fontSize: 11,
    color: "var(--text-muted)",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    width: "100%",
    minHeight: TOUCH,
    paddingTop: 0,
    paddingBottom: 0,
    paddingRight: 16,
    background: "none",
    border: "none",
    color: "var(--text-chrome)",
    fontSize: 14,
    textAlign: "left",
    cursor: "pointer",
  },
  rowOff: {
    color: "var(--text-disabled)",
    cursor: "default",
  },
  rowLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowNote: {
    flex: "none",
    fontSize: 11,
    color: "var(--text-muted)",
  },
  divider: {
    height: 1,
    background: "var(--border-subtle)",
    margin: "4px 0",
  },
};
