"use client";

import React, { useEffect, useRef, useState } from "react";
import type { ProjectMeta } from "@stave/editor";
import { START_SCREEN_RECENT_LIMIT, openedAgo } from "../startScreen";

interface StartScreenProps {
  open: boolean;
  /** the project that is open behind the screen */
  activeProject: ProjectMeta;
  /** every project, most recently opened first; may still be loading (empty) */
  projects: readonly ProjectMeta[];
  /** the remembered "show this when Stave starts" choice */
  showAtStart: boolean;
  onShowAtStartChange: (show: boolean) => void;
  onClose: () => void;
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
  onOpenArchive: () => void;
  /** the full project list, when there are more than fit here */
  onBrowseProjects: () => void;
}

/**
 * The start screen (#2019): what you were working on, and how to start
 * something new. Laid over the editor once Stave is ready — the last project
 * is already loaded behind it, so closing it costs nothing.
 */
export function StartScreen({
  open, activeProject, projects, showAtStart, onShowAtStartChange,
  onClose, onOpenProject, onNewProject, onOpenArchive, onBrowseProjects,
}: StartScreenProps) {
  const continueRef = useRef<HTMLButtonElement>(null);
  // One reading of the clock per opening, so the rows do not disagree with
  // each other and nothing re-renders to keep "3 minutes ago" exact.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    continueRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // The open project comes from the app, not from the list: the list arrives a
  // moment after the app does, and "Continue" must be there from the first frame.
  // The list's copy is preferred once it is in, since it carries the fresh stamp.
  const current = projects.find((p) => p.id === activeProject.id) ?? activeProject;
  const others = projects.filter((p) => p.id !== activeProject.id);
  const shown = others.slice(0, START_SCREEN_RECENT_LIMIT - 1);
  const more = others.length - shown.length;

  return (
    <div style={styles.backdrop} onClick={onClose} data-start-screen="backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-screen-title"
        style={styles.card}
        onClick={(e) => e.stopPropagation()}
        data-start-screen="root"
      >
        <div style={styles.header}>
          <div id="start-screen-title" style={styles.wordmark}>Stave</div>
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div style={styles.columns}>
          <section style={styles.column} aria-labelledby="start-screen-recent">
            <h2 id="start-screen-recent" style={styles.sectionLabel}>Recent projects</h2>
            <div style={styles.list}>
              <button
                ref={continueRef}
                style={{ ...styles.row, ...styles.rowCurrent }}
                onClick={onClose}
                data-start-screen="continue"
              >
                <span style={styles.rowText}>
                  <span style={styles.rowName}>{current.name}</span>
                  <span style={styles.rowMeta}>{openedAgo(current.lastOpenedAt, now)}</span>
                </span>
                <span style={styles.rowAction}>Continue</span>
              </button>
              {shown.map((p) => (
                <button
                  key={p.id}
                  style={styles.row}
                  onClick={() => onOpenProject(p.id)}
                  data-start-screen="project"
                >
                  <span style={styles.rowText}>
                    <span style={styles.rowName}>{p.name}</span>
                    <span style={styles.rowMeta}>{openedAgo(p.lastOpenedAt, now)}</span>
                  </span>
                </button>
              ))}
              {more > 0 && (
                <button style={styles.linkBtn} onClick={onBrowseProjects}>
                  {more} more project{more === 1 ? "" : "s"}…
                </button>
              )}
            </div>
          </section>

          <section style={styles.column} aria-labelledby="start-screen-new">
            <h2 id="start-screen-new" style={styles.sectionLabel}>Start</h2>
            <div style={styles.list}>
              <button style={styles.action} onClick={onNewProject}>
                <span style={styles.rowName}>New project…</span>
                <span style={styles.rowMeta}>
                  From a template: a starter workspace, a full song, a sketch, or blank.
                </span>
              </button>
              <button style={styles.action} onClick={onOpenArchive}>
                <span style={styles.rowName}>Open a project archive…</span>
                <span style={styles.rowMeta}>A .zip exported from Stave, with its files and takes.</span>
              </button>
            </div>
          </section>
        </div>

        <div style={styles.footer}>
          <label style={styles.checkLabel}>
            <input
              type="checkbox"
              checked={showAtStart}
              onChange={(e) => onShowAtStartChange(e.target.checked)}
            />
            Show this when Stave starts
          </label>
          <span style={styles.hint}>It is always under Help → Start Screen.</span>
        </div>
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed" as const,
    inset: 0,
    background: "var(--bg-overlay)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
    fontFamily: "system-ui, -apple-system, sans-serif",
    padding: 16,
    boxSizing: "border-box" as const,
  },
  card: {
    width: 760,
    maxWidth: "100%",
    maxHeight: "100%",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    display: "flex",
    flexDirection: "column" as const,
    color: "var(--text-chrome)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "18px 12px 14px 24px",
    borderBottom: "1px solid var(--border-subtle)",
  },
  wordmark: {
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.5px",
    color: "var(--accent-strong)",
  },
  closeBtn: {
    width: 44,
    height: 44,
    background: "none",
    border: "none",
    color: "var(--text-icon)",
    fontSize: 24,
    cursor: "pointer",
    lineHeight: 1,
  },
  columns: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 24,
    padding: "20px 24px",
    overflow: "auto",
    flex: 1,
    minHeight: 0,
  },
  column: {
    flex: "1 1 300px",
    minWidth: 0,
  },
  sectionLabel: {
    margin: "0 0 10px",
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "var(--text-tertiary)",
    fontWeight: 600,
  },
  list: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 52,
    padding: "8px 12px",
    background: "var(--bg-panel)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    color: "var(--text-chrome)",
    fontFamily: "inherit",
    textAlign: "left" as const,
    cursor: "pointer",
  },
  rowCurrent: {
    border: "1px solid var(--accent)",
    background: "var(--bg-hover)",
  },
  rowText: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    minWidth: 0,
  },
  rowName: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  rowMeta: {
    fontSize: 12,
    color: "var(--text-tertiary)",
    lineHeight: 1.4,
  },
  rowAction: {
    flex: "none",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent-strong)",
  },
  action: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    minHeight: 52,
    padding: "10px 12px",
    background: "var(--bg-panel)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    color: "var(--text-chrome)",
    fontFamily: "inherit",
    textAlign: "left" as const,
    cursor: "pointer",
  },
  linkBtn: {
    alignSelf: "flex-start",
    minHeight: 32,
    padding: "4px 2px",
    background: "none",
    border: "none",
    color: "var(--accent-strong)",
    fontFamily: "inherit",
    fontSize: 12,
    cursor: "pointer",
  },
  footer: {
    display: "flex",
    flexWrap: "wrap" as const,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 24px",
    borderTop: "1px solid var(--border-subtle)",
    fontSize: 12,
    color: "var(--text-tertiary)",
  },
  checkLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "var(--text-chrome)",
    cursor: "pointer",
    minHeight: 32,
  },
  hint: {
    color: "var(--text-tertiary)",
  },
};
