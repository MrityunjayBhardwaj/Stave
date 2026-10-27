"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { listWorkspaceFiles } from "@stave/editor";

export interface WorkspaceSearchViewHandle {
  focus: () => void;
}

interface WorkspaceSearchViewProps {
  onOpenFile: (fileId: string) => void;
  /** When true, renders a tighter header for side-panel layout. */
  compact?: boolean;
  /** Fires on Escape so a parent modal can dismiss. */
  onEscape?: () => void;
}

interface Hit {
  fileId: string;
  path: string;
  line: number;
  text: string;
}

const MAX_HITS = 200;

export const WorkspaceSearchView = forwardRef<WorkspaceSearchViewHandle, WorkspaceSearchViewProps>(
  function WorkspaceSearchView({ onOpenFile, compact, onEscape }, ref) {
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const [caseSensitive, setCaseSensitive] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }));

    const hits = useMemo(() => {
      const q = query.trim();
      if (q.length < 2) return [] as Hit[];
      const needle = caseSensitive ? q : q.toLowerCase();
      const out: Hit[] = [];
      const files = listWorkspaceFiles().filter((f) => !f.path.endsWith("/.keep"));
      for (const f of files) {
        if (out.length >= MAX_HITS) break;
        const lines = f.content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (out.length >= MAX_HITS) break;
          const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
          if (hay.includes(needle)) {
            out.push({ fileId: f.id, path: f.path, line: i + 1, text: lines[i] });
          }
        }
      }
      return out;
    }, [query, caseSensitive]);

    useEffect(() => { setActive(0); }, [query]);
    useEffect(() => {
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-search-row="${active}"]`,
      );
      el?.scrollIntoView({ block: "nearest" });
    }, [active]);

    const jump = (h: Hit) => onOpenFile(h.fileId);

    const onKey = (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onEscape?.(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(hits.length - 1, i + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
      else if (e.key === "Enter") {
        e.preventDefault();
        const hit = hits[active];
        if (hit) jump(hit);
      }
    };

    return (
      <div style={compact ? styles.rootCompact : styles.root}>
        <div style={styles.header}>
          <input
            ref={inputRef}
            style={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search in files..."
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
          />
          <button
            style={{ ...styles.caseBtn, ...(caseSensitive ? styles.caseBtnActive : {}) }}
            onClick={() => setCaseSensitive((c) => !c)}
            title="Match case"
          >Aa</button>
        </div>
        <div style={styles.meta}>
          {query.trim().length < 2
            ? "Type at least 2 characters"
            : hits.length >= MAX_HITS
            ? `${MAX_HITS}+ matches`
            : `${hits.length} match${hits.length === 1 ? "" : "es"}`}
        </div>
        <div style={styles.list} ref={listRef}>
          {hits.map((h, i) => (
            <div
              key={`${h.fileId}:${h.line}:${i}`}
              data-search-row={i}
              style={{ ...styles.row, ...(i === active ? styles.rowActive : {}) }}
              onMouseEnter={() => setActive(i)}
              onClick={() => jump(h)}
            >
              <div style={styles.rowSnippet}>{highlight(h.text, query, caseSensitive)}</div>
              <div style={styles.rowLoc}>{h.path}<span style={styles.rowLine}>:{h.line}</span></div>
            </div>
          ))}
        </div>
      </div>
    );
  },
);

function highlight(line: string, query: string, caseSensitive: boolean): React.ReactNode {
  const q = query.trim();
  if (q.length < 2) return line;
  const hay = caseSensitive ? line : line.toLowerCase();
  const needle = caseSensitive ? q : q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i < line.length) {
    const idx = hay.indexOf(needle, i);
    if (idx < 0) { parts.push(line.slice(i)); break; }
    if (idx > i) parts.push(line.slice(i, idx));
    parts.push(<span key={idx} style={{ background: "var(--highlight-bg)", color: "var(--highlight-fg)" }}>{line.slice(idx, idx + q.length)}</span>);
    i = idx + q.length;
  }
  return parts;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: 680,
    maxWidth: "92vw",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  rootCompact: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "stretch",
    borderBottom: "1px solid var(--border-subtle)",
  },
  input: {
    flex: 1,
    // A text input will not shrink below its built-in ~20-character width on
    // its own; without this it pushed the Aa button out past a narrow panel's
    // edge, over the editor (#2254).
    minWidth: 0,
    background: "var(--bg-input)",
    border: "none",
    color: "var(--text-primary)",
    padding: "8px 12px",
    fontSize: 12,
    fontFamily: "inherit",
    outline: "none",
  },
  caseBtn: {
    // the input gives up room first; the button keeps its size (#2254)
    flexShrink: 0,
    background: "var(--bg-input)",
    border: "none",
    borderLeft: "1px solid var(--border-subtle)",
    color: "var(--text-tertiary)",
    padding: "0 10px",
    fontSize: 11,
    fontFamily: "inherit",
    cursor: "pointer",
  },
  caseBtnActive: { color: "var(--text-primary)", background: "var(--bg-active)" },
  meta: {
    padding: "4px 12px",
    fontSize: 10,
    color: "var(--text-muted)",
    borderBottom: "1px solid var(--border-subtle)",
  },
  list: {
    overflowY: "auto",
    padding: "2px 0",
    flex: 1,
  },
  row: {
    display: "block",
    padding: "4px 12px",
    cursor: "pointer",
  },
  rowActive: { background: "var(--bg-active)" },
  rowSnippet: {
    fontSize: 11,
    color: "var(--text-chrome)",
    fontFamily: 'var(--font-mono), ui-monospace, monospace',
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  rowLoc: {
    fontSize: 10,
    color: "var(--text-muted)",
    marginTop: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  rowLine: { color: "var(--text-tertiary)" },
};
