"use client";

/**
 * Console panel — activity-bar sidebar that renders the engineLog
 * history with per-runtime / per-level filters, search, and clickable
 * "Did you mean" suggestion chips. Designed after p5.js's console +
 * Sonic Pi's log view — accessible but not forced on the user.
 *
 * Subscribes to `subscribeLog` for live updates. Auto-scrolls to the
 * newest entry unless the user has scrolled up (follow-lock pattern —
 * matches browser devtools).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clearLog,
  getLogHistory,
  subscribeLog,
  getFixedMarkers,
  subscribeFixed,
  makeFixedKey,
  type LogEntry,
  type LogLevel,
  type RuntimeId,
} from "@stave/editor";

const RUNTIME_LABELS: Record<string, string> = {
  strudel: "Strudel",
  sonicpi: "Sonic Web",
  p5: "p5.js",
  hydra: "Hydra",
  stave: "Stave",
};

const RUNTIME_COLORS: Record<string, string> = {
  strudel: "#93c5fd",
  sonicpi: "#a78bfa",
  p5: "#fde68a",
  hydra: "#86efac",
  stave: "#c4b5fd",
};

const LEVEL_ICONS: Record<LogLevel, string> = {
  info: "ⓘ",
  warn: "⚠",
  error: "✖",
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  info: "var(--text-tertiary)",
  warn: "#f59e0b",
  error: "#ef4444",
};

type RuntimeFilter = "all" | RuntimeId;

export function ConsolePanel({
  onReveal,
}: {
  /** #2182 — go to an entry's line; the same handler the error toast uses. */
  onReveal?: (entry: LogEntry) => void;
} = {}): React.ReactElement {
  const [entries, setEntries] = useState<readonly LogEntry[]>(getLogHistory);
  const [runtimeFilter, setRuntimeFilter] = useState<RuntimeFilter>("all");
  const [levelFilter, setLevelFilter] = useState<
    Record<LogLevel, boolean>
  >({ info: true, warn: true, error: true });
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [followTail, setFollowTail] = useState(true);
  // Live mode: hide log entries emitted before the last successful eval
  // for that `(runtime, source)` — "only show what's currently broken".
  // Off by default so the full history stays the default experience.
  const [liveMode, setLiveMode] = useState(false);
  const [fixedMarkers, setFixedMarkers] = useState<ReadonlyMap<string, number>>(
    getFixedMarkers,
  );
  const listRef = useRef<HTMLDivElement>(null);
  const lastUserScrollTs = useRef(0);

  useEffect(() => {
    return subscribeLog((entry, history) => {
      setEntries([...history]);
      void entry;
    });
  }, []);

  useEffect(() => {
    return subscribeFixed((_marker, markers) => {
      setFixedMarkers(new Map(markers));
    });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (!levelFilter[e.level]) return false;
      if (runtimeFilter !== "all" && e.runtime !== runtimeFilter) return false;
      if (liveMode) {
        // Hide entries whose `(runtime, source)` has a newer fix marker.
        // Also honor a runtime-wide marker (no source) as a fallback.
        // Strict `<` (not `<=`) so an entry emitted in the same ms as
        // the fix still surfaces — `Date.now()` granularity collapses
        // real ordering and we'd rather show a stale error than hide
        // a fresh one.
        const fixTs =
          fixedMarkers.get(makeFixedKey(e.runtime, e.source)) ??
          fixedMarkers.get(makeFixedKey(e.runtime, undefined)) ??
          0;
        if (e.ts < fixTs) return false;
      }
      if (q) {
        const hay =
          `${e.message} ${e.source ?? ""} ${e.suggestion?.name ?? ""}`
            .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, runtimeFilter, levelFilter, query, liveMode, fixedMarkers]);

  // Auto-scroll to bottom when tailing. The user scrolling up pauses
  // follow; scrolling back to near-bottom re-enables it.
  useEffect(() => {
    if (!followTail || !listRef.current) return;
    const el = listRef.current;
    el.scrollTop = el.scrollHeight;
  }, [filtered, followTail]);

  const onListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    lastUserScrollTs.current = Date.now();
    setFollowTail(nearBottom);
  }, []);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyAll = useCallback(async () => {
    const text = filtered
      .map((e) => {
        const ts = new Date(e.ts).toISOString().slice(11, 19);
        const rt = RUNTIME_LABELS[e.runtime] ?? e.runtime;
        const src = e.source ? ` (${e.source})` : "";
        // #2170 — "try" only names a symbol; a hint's link copies as its address.
        const sug = e.suggestion?.name
          ? ` [try ${e.suggestion.name}]`
          : e.suggestion?.linkLabel
          ? ` [see ${e.suggestion.docsUrl}]`
          : "";
        return `[${ts}] [${e.level.toUpperCase()}] [${rt}]${src} ${e.message}${sug}`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard may be denied; ignore */
    }
  }, [filtered]);

  return (
    <div style={styles.root} data-sidebar data-testid="console-panel">
      <div style={styles.header}>CONSOLE</div>

      <div style={styles.toolbar}>
        <input
          type="text"
          placeholder="Filter log…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={styles.search}
          data-testid="console-search"
        />
        <button
          title="Copy visible entries"
          onClick={copyAll}
          style={styles.btn}
        >
          ⧉
        </button>
        <button
          title="Clear log"
          onClick={() => clearLog()}
          style={styles.btn}
          data-testid="console-clear"
        >
          ⌧
        </button>
      </div>

      <div style={styles.filterRow}>
        <RuntimeChip
          label="All"
          active={runtimeFilter === "all"}
          count={entries.length}
          onClick={() => setRuntimeFilter("all")}
          color="var(--text-secondary)"
        />
        {(["strudel", "sonicpi", "p5", "hydra"] as RuntimeId[]).map((r) => {
          const count = entries.filter((e) => e.runtime === r).length;
          if (count === 0) return null;
          return (
            <RuntimeChip
              key={r}
              label={RUNTIME_LABELS[r]}
              active={runtimeFilter === r}
              count={count}
              onClick={() => setRuntimeFilter(r)}
              color={RUNTIME_COLORS[r] ?? "var(--text-secondary)"}
            />
          );
        })}
      </div>

      <div style={styles.filterRow}>
        {(["error", "warn", "info"] as LogLevel[]).map((lvl) => {
          const count = entries.filter((e) => e.level === lvl).length;
          return (
            <button
              key={lvl}
              onClick={() =>
                setLevelFilter((p) => ({ ...p, [lvl]: !p[lvl] }))
              }
              style={{
                ...styles.levelBtn,
                opacity: levelFilter[lvl] ? 1 : 0.35,
                color: LEVEL_COLORS[lvl],
                borderColor: levelFilter[lvl]
                  ? LEVEL_COLORS[lvl]
                  : "var(--border-subtle)",
              }}
              title={`${lvl} (${count})`}
            >
              {LEVEL_ICONS[lvl]} {count}
            </button>
          );
        })}
        <span style={styles.spacer} />
        <button
          type="button"
          onClick={() => setLiveMode((v) => !v)}
          title={
            liveMode
              ? "Live mode on — hiding errors you've already fixed. Click to show full history."
              : "Live mode off — showing full history. Click to hide errors once fixed."
          }
          style={{
            ...styles.liveBtn,
            color: liveMode ? "#86efac" : "var(--text-tertiary)",
            borderColor: liveMode ? "#86efac" : "var(--border-subtle)",
            background: liveMode ? "rgba(134,239,172,0.08)" : "transparent",
          }}
          data-testid="console-live"
          aria-pressed={liveMode}
        >
          <span
            style={{
              ...styles.liveDot,
              background: liveMode ? "#86efac" : "var(--text-tertiary)",
              opacity: liveMode ? 1 : 0.5,
            }}
          />
          live
        </button>
        <label style={styles.follow} title="Auto-scroll to newest entry">
          <input
            type="checkbox"
            checked={followTail}
            onChange={(e) => setFollowTail(e.target.checked)}
            style={{ marginRight: 4 }}
          />
          tail
        </label>
      </div>

      <div
        ref={listRef}
        onScroll={onListScroll}
        style={styles.list}
        data-testid="console-list"
      >
        {filtered.length === 0 && (
          <div style={styles.empty}>
            {entries.length === 0
              ? "No log entries yet. Runtime errors and warnings will appear here."
              : liveMode && fixedMarkers.size > 0
                ? "All clear — every earlier error has been fixed."
                : "No entries match the current filters."}
          </div>
        )}
        {filtered.map((e) => {
          const time = new Date(e.ts).toISOString().slice(11, 19);
          const isExpanded = expanded.has(e.id);
          // #2182 — a row that knows its line takes you there. Clicks on the
          // hint link or the stack toggle keep their own job, and a drag that
          // selects the message's text doesn't count as a click.
          const reveal = onReveal && e.source && e.line != null
            ? () => onReveal(e)
            : undefined;
          return (
            <div
              key={e.id}
              data-testid="console-row"
              data-level={e.level}
              data-runtime={e.runtime}
              data-line={e.line ?? undefined}
              style={reveal ? { ...styles.row, cursor: "pointer" } : styles.row}
              title={reveal ? `Go to line ${e.line}` : undefined}
              role={reveal ? "link" : undefined}
              tabIndex={reveal ? 0 : undefined}
              onClick={reveal && ((ev) => {
                if ((ev.target as Element).closest("a, button")) return;
                if (window.getSelection()?.toString()) return;
                reveal();
              })}
              onKeyDown={reveal && ((ev) => {
                if (ev.key === "Enter" && ev.target === ev.currentTarget) reveal();
              })}
            >
              <div style={styles.rowHead}>
                <span style={styles.time}>{time}</span>
                <span
                  style={{
                    ...styles.badge,
                    color:
                      RUNTIME_COLORS[e.runtime] ?? "var(--text-tertiary)",
                    borderColor:
                      RUNTIME_COLORS[e.runtime] ?? "var(--border)",
                  }}
                >
                  {RUNTIME_LABELS[e.runtime] ?? e.runtime}
                </span>
                <span
                  style={{ ...styles.levelIcon, color: LEVEL_COLORS[e.level] }}
                  aria-label={e.level}
                >
                  {LEVEL_ICONS[e.level]}
                </span>
                {e.source && (
                  <span style={styles.source} title={e.source}>
                    {shortenPath(e.source)}
                    {e.line ? `:${e.line}` : ""}
                  </span>
                )}
                {(e.count ?? 1) > 1 && (
                  <span
                    style={styles.repeatBadge}
                    data-testid="console-repeat-count"
                    title={`Repeated ${e.count} times`}
                  >
                    ×{e.count}
                  </span>
                )}
              </div>
              <div style={styles.message}>{e.message}</div>
              {e.suggestion && (
                // #2172 — a hint with only an example has no address; an empty
                // href would open this page again, so it is drawn without one.
                <a
                  href={e.suggestion.docsUrl || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.suggestion}
                  data-testid="console-suggestion"
                >
                  <span style={styles.suggestionArrow}>↪</span>
                  <code style={styles.suggestionName}>
                    {e.suggestion.name || e.suggestion.linkLabel}
                  </code>
                  {e.suggestion.description && (
                    <span style={styles.suggestionDesc}>
                      {e.suggestion.description}
                    </span>
                  )}
                  {e.suggestion.example && (
                    <code style={styles.suggestionExample}>
                      {e.suggestion.example}
                    </code>
                  )}
                </a>
              )}
              {e.stack && (
                <>
                  <button
                    onClick={() => toggleExpanded(e.id)}
                    style={styles.stackToggle}
                  >
                    {isExpanded ? "▾ Hide stack" : "▸ Show stack"}
                  </button>
                  {isExpanded && (
                    <pre style={styles.stack}>{e.stack}</pre>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RuntimeChip({
  label,
  active,
  count,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        ...styles.runtimeChip,
        color: active ? color : "var(--text-tertiary)",
        borderColor: active ? color : "var(--border-subtle)",
        background: active ? "rgba(255,255,255,0.04)" : "transparent",
      }}
    >
      {label}
      <span style={styles.chipCount}>{count}</span>
    </button>
  );
}

function shortenPath(p: string): string {
  // Strip `preset/` prefix and any deep nested paths; keep the leaf file.
  const slash = p.lastIndexOf("/");
  return slash >= 0 ? p.slice(slash + 1) : p;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    // Width is owned by SidePanel (#1367). This panel used to pin itself to
    // 360, which is what made the left region a different size on the Console
    // tab than on every other one.
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-panel)",
    borderRight: "1px solid var(--border-subtle)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    minWidth: 0,
  },
  header: {
    padding: "10px 14px",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.8,
    color: "var(--text-secondary)",
    borderBottom: "1px solid var(--border-subtle)",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border-subtle)",
  },
  search: {
    flex: 1,
    background: "var(--bg-app)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 3,
    padding: "4px 8px",
    fontSize: 11,
    color: "var(--text-primary)",
    outline: "none",
    fontFamily: "inherit",
  },
  btn: {
    background: "transparent",
    border: "1px solid var(--border-subtle)",
    borderRadius: 3,
    color: "var(--text-tertiary)",
    padding: "2px 8px",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  filterRow: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 12px",
    borderBottom: "1px solid var(--border-subtle)",
    flexWrap: "wrap" as const,
  },
  runtimeChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 8px",
    borderRadius: 3,
    border: "1px solid var(--border-subtle)",
    background: "transparent",
    fontSize: 10,
    fontFamily: "inherit",
    cursor: "pointer",
    letterSpacing: 0.3,
  },
  chipCount: {
    fontSize: 9,
    opacity: 0.7,
    padding: "0 2px",
  },
  levelBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    padding: "2px 8px",
    borderRadius: 3,
    border: "1px solid var(--border-subtle)",
    background: "transparent",
    fontSize: 10,
    fontFamily: "inherit",
    cursor: "pointer",
    letterSpacing: 0.3,
  },
  spacer: { flex: 1 },
  follow: {
    display: "inline-flex",
    alignItems: "center",
    color: "var(--text-tertiary)",
    fontSize: 10,
    letterSpacing: 0.3,
    cursor: "pointer",
  },
  liveBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 8px",
    borderRadius: 3,
    border: "1px solid var(--border-subtle)",
    fontSize: 10,
    fontFamily: "inherit",
    cursor: "pointer",
    letterSpacing: 0.3,
  },
  liveDot: {
    display: "inline-block",
    width: 6,
    height: 6,
    borderRadius: "50%",
  },
  list: {
    flex: 1,
    overflowY: "auto",
    padding: "4px 0",
  },
  empty: {
    padding: "20px 14px",
    color: "var(--text-tertiary)",
    fontSize: 11,
    lineHeight: 1.5,
  },
  row: {
    padding: "6px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    fontSize: 11,
    color: "var(--text-primary)",
  },
  rowHead: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 3,
  },
  time: {
    color: "var(--text-tertiary)",
    fontFamily: 'var(--font-mono), ui-monospace, monospace',
    fontSize: 10,
  },
  badge: {
    display: "inline-block",
    padding: "0 5px",
    border: "1px solid var(--border)",
    borderRadius: 2,
    fontSize: 9,
    letterSpacing: 0.4,
    textTransform: "uppercase" as const,
    flexShrink: 0,
  },
  levelIcon: {
    fontSize: 12,
    flexShrink: 0,
  },
  // #563 — "×N" repeat badge: identical entries coalesce into one row whose
  // count ticks up instead of flooding the panel.
  repeatBadge: {
    display: "inline-block",
    padding: "0 5px",
    borderRadius: 8,
    fontSize: 9,
    fontWeight: 700 as const,
    fontFamily: 'var(--font-mono), ui-monospace, monospace',
    background: "var(--surface-3, rgba(255,255,255,0.08))",
    color: "var(--text-secondary)",
    flexShrink: 0,
    marginLeft: "auto",
  },
  source: {
    color: "var(--text-tertiary)",
    fontSize: 10,
    fontFamily: 'var(--font-mono), ui-monospace, monospace',
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    marginLeft: "auto",
  },
  message: {
    color: "var(--text-primary)",
    fontFamily: 'var(--font-mono), ui-monospace, monospace',
    whiteSpace: "pre-wrap" as const,
    lineHeight: 1.4,
    wordBreak: "break-word" as const,
  },
  suggestion: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    padding: "6px 8px",
    marginTop: 4,
    background: "rgba(139,92,246,0.08)",
    border: "1px solid rgba(139,92,246,0.25)",
    borderRadius: 3,
    color: "var(--text-primary)",
    textDecoration: "none",
    fontSize: 10,
  },
  suggestionArrow: {
    color: "var(--accent)",
  },
  suggestionName: {
    fontFamily: 'var(--font-mono), ui-monospace, monospace',
    color: "var(--accent-hover, #c4b5fd)",
    fontSize: 11,
    fontWeight: 500,
  },
  suggestionDesc: {
    color: "var(--text-secondary)",
    fontSize: 10,
    lineHeight: 1.4,
  },
  suggestionExample: {
    fontFamily: 'var(--font-mono), ui-monospace, monospace',
    color: "var(--text-tertiary)",
    fontSize: 10,
  },
  stackToggle: {
    background: "transparent",
    border: "none",
    color: "var(--text-tertiary)",
    fontSize: 10,
    padding: "4px 0 0 0",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  stack: {
    margin: "4px 0 0 0",
    padding: "6px 8px",
    background: "var(--bg-app)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 3,
    fontFamily: 'var(--font-mono), ui-monospace, monospace',
    fontSize: 10,
    color: "var(--text-tertiary)",
    whiteSpace: "pre-wrap" as const,
    overflowX: "auto" as const,
  },
};
