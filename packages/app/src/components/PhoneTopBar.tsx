"use client";

import React, { useEffect, useRef, useSyncExternalStore } from "react";
import {
  getBottomPanelState,
  listBottomPanelTabs,
  setBottomPanelOpen,
  showBottomPanelTab,
  subscribeToBottomPanelState,
  subscribeToBottomPanelTabs,
} from "@stave/editor";
import { Icon } from "./Icon";
import { useRulerUnits } from "../state/rulerUnits";
import { useDisplayMeter } from "../state/displayMeter";
import { positionAsDrawn } from "./musicalTimeline/songAxis";
import { readDrawnSongFrame } from "../state/drawnSongFrame";
import { transportReadout } from "./transportReadout";

/**
 * The phone's top bar (#2001, #2035): the button that opens the drawer, which file
 * this is, and where the song has got to.
 *
 * The desktop's menu bar puts eleven controls in a 28 px strip; on a 390 px screen
 * most of them are off its right edge and the rest are too small to hit. Everything
 * that strip holds and this one does not — the menus, the full readout, the status,
 * frame-rate and audio lamps, the time signature — is in the drawer.
 *
 * Held sideways it also carries the view switch (#2003, below).
 *
 * There is no Play here (#2035). The editor's own bar, just below, has it beside live
 * mode and the backdrop picker, sized for a finger; a second one up here was the same
 * button twice.
 */

const TOUCH = 44;

/** the switch's first entry: the code, which is the panel being closed */
const CODE_VIEW = "code";

// `listBottomPanelTabs` hands back a new array each call; the switch needs the same
// one until the list changes, so it is kept here and replaced when the registry says so.
let panelTabs = listBottomPanelTabs();
function subscribeToPanelTabs(changed: () => void): () => void {
  return subscribeToBottomPanelTabs(() => {
    panelTabs = listBottomPanelTabs();
    changed();
  });
}
const getPanelTabs = () => panelTabs;

/**
 * Held sideways (#2003): Code · Timeline · Pattern · Mixer. One of them has the whole
 * screen under the editor's bar.
 *
 * The entries after Code are the bottom panel's own tabs, read from its registry, so a
 * tab added there is here. Which is chosen is the panel's own state — closed is Code —
 * the same state the upright sheet reads, so turning the phone keeps the view.
 */
function ViewSwitch() {
  const tabs = useSyncExternalStore(subscribeToPanelTabs, getPanelTabs, getPanelTabs);
  // subscribed with THIS package's React, through the store's plain functions: a hook
  // exported by the editor package runs on the editor's copy of React, which the app's
  // unit tests do not render with
  const { open, activeTabId } = useSyncExternalStore(subscribeToBottomPanelState, getBottomPanelState, getBottomPanelState);
  const chosen = open ? activeTabId ?? tabs[0]?.id ?? CODE_VIEW : CODE_VIEW;
  const entries = [{ id: CODE_VIEW, title: "Code" }, ...tabs.map((t) => ({ id: t.id, title: t.title }))];
  return (
    <div style={styles.views} role="tablist" aria-label="View" data-phone-view-switch>
      {entries.map((v) => (
        <button
          key={v.id}
          type="button"
          role="tab"
          aria-selected={chosen === v.id}
          data-phone-view={v.id}
          style={{ ...styles.view, ...(chosen === v.id ? styles.viewOn : {}) }}
          onClick={() => (v.id === CODE_VIEW ? setBottomPanelOpen(false) : showBottomPanelTab(v.id))}
        >
          {v.title}
        </button>
      ))}
    </div>
  );
}

interface PhoneTopBarProps {
  readonly fileName: string | null;
  readonly onOpenDrawer: () => void;
  /** the phone is held sideways: the bar also carries the view switch (#2003) */
  readonly sideways: boolean;
  readonly getSongPosition: () => number | null;
  readonly getCps: () => number | null;
}

export function PhoneTopBar({
  fileName,
  onOpenDrawer,
  sideways,
  getSongPosition,
  getCps,
}: PhoneTopBarProps) {
  const cycleMode = useRulerUnits() === "cycles";
  const meter = useDisplayMeter();

  // the readout is written straight to the DOM a few times a second, as the desktop's
  // is, so the shell does not re-render to move a number
  const lineRef = useRef<HTMLSpanElement>(null);
  const live = useRef({ getSongPosition, getCps, cycleMode, meter });
  live.current = { getSongPosition, getCps, cycleMode, meter };
  useEffect(() => {
    const write = (): void => {
      const { getSongPosition: pos, getCps: cps, cycleMode: inCycle, meter: m } = live.current;
      const r = transportReadout(positionAsDrawn(pos(), readDrawnSongFrame()), cps(), inCycle, m);
      const text = `${r.positionLabel} ${r.position} · ${r.tempo} ${r.tempoLabel}`;
      if (lineRef.current && lineRef.current.textContent !== text) lineRef.current.textContent = text;
    };
    write();
    const id = window.setInterval(write, 100);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div style={styles.bar} data-phone-top-bar data-phone-top-held={sideways ? "sideways" : "upright"}>
      <button type="button" style={styles.square} aria-label="Open project and menus" data-phone-top="drawer" onClick={onOpenDrawer}>
        <Icon name="menu" size="20px" />
      </button>

      <div style={styles.title}>
        <span style={styles.file} data-phone-top="file">
          {fileName ?? "No file open"}
        </span>
        <span style={styles.line} ref={lineRef} data-phone-top="readout" />
      </div>

      {sideways && <ViewSwitch />}

    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    flex: "none",
    minHeight: TOUCH + 4,
    boxSizing: "border-box",
    // the notch is the shell's to clear (#2007, page.tsx); this is only the bar's own edge
    paddingLeft: 2,
    paddingRight: 6,
    background: "var(--bg-chrome)",
    borderBottom: "1px solid var(--border-subtle)",
    color: "var(--text-chrome)",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  square: {
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
  title: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 2,
    padding: "0 4px",
  },
  views: {
    display: "flex",
    flex: "none",
    alignItems: "center",
    gap: 2,
  },
  view: {
    minWidth: TOUCH,
    height: TOUCH,
    padding: "0 12px",
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    color: "var(--text-secondary)",
    fontFamily: "inherit",
    fontSize: 13,
    cursor: "pointer",
  },
  // the whole `borderBottom` again, not just its colour: a colour set beside the
  // shorthand is cleared to the text's colour when it is taken away, and every view
  // that had been chosen kept a grey line. No bold either — it changes the width.
  viewOn: {
    color: "var(--text-primary)",
    borderBottom: "2px solid var(--accent, #7c7cff)",
  },
  file: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  line: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
    fontFamily: 'var(--font-mono, ui-monospace, "SF Mono", Menlo, Consolas, monospace)',
    color: "var(--text-secondary)",
  },
};
