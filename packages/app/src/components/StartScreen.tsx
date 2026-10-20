"use client";

import React, { useEffect, useRef, useState } from "react";
import type { ProjectMeta } from "@stave/editor";
import {
  INTRO_VIDEO,
  START_SCREEN_RECENT_LIMIT,
  introEmbedUrl,
  introPlaysInline,
  introWatchUrl,
  openedAgo,
  readIntroBrowser,
} from "../startScreen";
import type { ProjectTemplate } from "../templates";
import { GITHUB_REPO_URL } from "./MenuBar";
import { TemplateIcon } from "./TemplateIcon";

interface StartScreenProps {
  open: boolean;
  /** shown in the corner of the picture, e.g. "0.5.0" */
  version: string;
  /** the project that is open behind the screen */
  activeProject: ProjectMeta;
  /** every project, most recently opened first; may still be loading (empty) */
  projects: readonly ProjectMeta[];
  /** the templates a new project can start from */
  templates: readonly ProjectTemplate[];
  /** the remembered "show this when Stave starts" choice */
  showAtStart: boolean;
  onShowAtStartChange: (show: boolean) => void;
  onClose: () => void;
  onOpenProject: (id: string) => void;
  /** start a new project from this template, named after it */
  onNewFromTemplate: (template: ProjectTemplate) => void;
  /** the full project list */
  onBrowseProjects: () => void;
  onOpenArchive: () => void;
}

/**
 * The start screen (#2019): a picture you can press to watch the intro film,
 * then two columns — ways to start something new, and what you were working on.
 * Laid over the editor once Stave is ready. The last project is already loaded
 * behind it, so closing it costs nothing.
 */
export function StartScreen({
  open, version, activeProject, projects, templates, showAtStart, onShowAtStartChange,
  onClose, onOpenProject, onNewFromTemplate, onBrowseProjects, onOpenArchive,
}: StartScreenProps) {
  const continueRef = useRef<HTMLButtonElement>(null);
  // One reading of the clock per opening, so the rows do not disagree with
  // each other and nothing re-renders to keep "3 minutes ago" exact.
  const [now, setNow] = useState(() => Date.now());
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    setPlaying(false);
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

  const watch = () => {
    if (introPlaysInline(readIntroBrowser())) setPlaying(true);
    else window.open(introWatchUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div style={styles.backdrop} onClick={onClose} data-start-screen="backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Stave start screen"
        style={styles.card}
        onClick={(e) => e.stopPropagation()}
        data-start-screen="root"
      >
        <div style={styles.hero} data-start-screen="hero">
          {playing ? (
            <iframe
              title={INTRO_VIDEO.title}
              src={introEmbedUrl}
              style={styles.film}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              // Loaded without credentials: the only way a page isolated from other
              // origins may frame YouTube's player. See introPlaysInline.
              {...{ credentialless: "" }}
              data-start-screen="film"
            />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={INTRO_VIDEO.poster} alt="" style={styles.poster} />
              <div style={styles.heroShade} aria-hidden />
              <button style={styles.play} onClick={watch} data-start-screen="play">
                <svg aria-hidden width="11" height="13" viewBox="0 0 12 14" fill="currentColor">
                  <path d="M0 0l12 7-12 7z" />
                </svg>
                Watch the intro
              </button>
              <div style={styles.wordmark}>Stave</div>
              <div style={styles.version}>v{version}</div>
            </>
          )}
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div style={styles.columns}>
          <section style={styles.column} aria-labelledby="start-screen-new">
            <h2 id="start-screen-new" style={styles.sectionLabel}>New project</h2>
            <div style={styles.list}>
              {templates.map((t) => (
                <button
                  key={t.id}
                  style={styles.item}
                  title={t.description}
                  onClick={() => onNewFromTemplate(t)}
                  data-start-screen="template"
                >
                  <TemplateIcon templateId={t.id} />
                  <span style={styles.itemName}>{t.name}</span>
                </button>
              ))}
            </div>
            <div style={{ ...styles.list, ...styles.listGap }}>
              <button style={styles.item} onClick={onBrowseProjects}>
                <FolderIcon />
                <span style={styles.itemName}>Open…</span>
              </button>
              <button style={styles.item} onClick={onOpenArchive}>
                <ArchiveIcon />
                <span style={styles.itemName}>Open a project archive…</span>
              </button>
            </div>
          </section>

          <section style={styles.column} aria-labelledby="start-screen-recent">
            <h2 id="start-screen-recent" style={styles.sectionLabel}>Recent projects</h2>
            <div style={styles.list}>
              <button
                ref={continueRef}
                style={styles.item}
                onClick={onClose}
                data-start-screen="continue"
              >
                <ClockIcon />
                <span style={styles.itemName}>{current.name}</span>
                <span style={styles.itemMeta}>continue</span>
              </button>
              {shown.map((p) => (
                <button
                  key={p.id}
                  style={styles.item}
                  onClick={() => onOpenProject(p.id)}
                  data-start-screen="project"
                >
                  <FileIcon />
                  <span style={styles.itemName}>{p.name}</span>
                  <span style={styles.itemMeta}>{openedAgo(p.lastOpenedAt, now).replace(/^opened /, "")}</span>
                </button>
              ))}
              {more > 0 && (
                <button style={styles.item} onClick={onBrowseProjects} data-start-screen="more">
                  <FolderIcon />
                  <span style={styles.itemName}>{more} more project{more === 1 ? "" : "s"}…</span>
                </button>
              )}
            </div>
            <div style={{ ...styles.list, ...styles.listGap }}>
              <a style={styles.item} href="/docs/" target="_blank" rel="noopener noreferrer">
                <LinkIcon />
                <span style={styles.itemName}>Documentation</span>
              </a>
              <a style={styles.item} href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
                <LinkIcon />
                <span style={styles.itemName}>Source on GitHub</span>
              </a>
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
          <span>Always under Help → Start Screen</span>
        </div>
      </div>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────

const icon = {
  width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  "aria-hidden": true, style: { flex: "none", color: "var(--text-icon)" } as React.CSSProperties,
};
const FileIcon = () => (<svg {...icon}><path d="M14 3H6v18h12V7z" /><path d="M14 3v4h4" /></svg>);
const FolderIcon = () => (<svg {...icon}><path d="M3 6h6l2 2h10v11H3z" /></svg>);
const ArchiveIcon = () => (<svg {...icon}><path d="M4 4h16v4H4z" /><path d="M5 8v12h14V8" /><path d="M10 12h4" /></svg>);
const ClockIcon = () => (<svg {...icon}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
const LinkIcon = () => (<svg {...icon}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>);

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
    width: 434,
    maxWidth: "100%",
    maxHeight: "100%",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    display: "flex",
    flexDirection: "column" as const,
    color: "var(--text-chrome)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    overflow: "auto",
  },
  hero: {
    position: "relative" as const,
    flex: "none",
    width: "100%",
    aspectRatio: "16 / 9",
    background: "#07070d",
    overflow: "hidden",
  },
  poster: {
    position: "absolute" as const,
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover" as const,
    display: "block",
  },
  film: {
    position: "absolute" as const,
    inset: 0,
    width: "100%",
    height: "100%",
    border: "none",
  },
  heroShade: {
    position: "absolute" as const,
    inset: 0,
    // darkens the foot of the picture, where the name, the button and the version sit
    background: "linear-gradient(to top, rgba(7,7,13,0.8) 0%, rgba(7,7,13,0) 38%)",
    pointerEvents: "none" as const,
  },
  wordmark: {
    position: "absolute" as const,
    // At the foot, not the head: the film's opening frame carries its own
    // headline across the top, and at phone width a name up there sits on it.
    bottom: 20,
    left: 14,
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: "-0.5px",
    color: "#ffffff",
  },
  version: {
    position: "absolute" as const,
    bottom: 24,
    right: 14,
    fontSize: 11,
    color: "rgba(255,255,255,0.85)",
  },
  play: {
    position: "absolute" as const,
    left: "50%",
    bottom: 14,
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 36,
    padding: "0 14px",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.5)",
    background: "rgba(7,7,13,0.72)",
    color: "#ffffff",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  closeBtn: {
    position: "absolute" as const,
    top: 4,
    right: 4,
    width: 44,
    height: 44,
    background: "none",
    border: "none",
    color: "#ffffff",
    fontSize: 20,
    cursor: "pointer",
    lineHeight: 1,
    textShadow: "0 1px 4px rgba(0,0,0,0.8)",
  },
  columns: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "12px 20px",
    padding: "12px 16px 10px",
  },
  column: {
    flex: "1 1 170px",
    minWidth: 0,
  },
  sectionLabel: {
    margin: "0 0 4px",
    padding: "0 6px",
    fontSize: 11,
    fontWeight: 500,
    color: "var(--text-tertiary)",
  },
  list: {
    display: "flex",
    flexDirection: "column" as const,
  },
  listGap: {
    marginTop: 10,
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 26,
    padding: "3px 6px",
    background: "none",
    border: "none",
    borderRadius: 4,
    color: "var(--text-chrome)",
    fontFamily: "inherit",
    fontSize: 12,
    textAlign: "left" as const,
    textDecoration: "none",
    cursor: "pointer",
    boxSizing: "border-box" as const,
  },
  itemName: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  itemMeta: {
    flex: "none",
    fontSize: 10,
    color: "var(--text-tertiary)",
    whiteSpace: "nowrap" as const,
  },
  footer: {
    display: "flex",
    flexWrap: "wrap" as const,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "8px 16px 10px 22px",
    borderTop: "1px solid var(--border-subtle)",
    fontSize: 11,
    color: "var(--text-tertiary)",
  },
  checkLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "var(--text-chrome)",
    cursor: "pointer",
    minHeight: 24,
  },
};
