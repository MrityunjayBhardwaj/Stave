"use client";

/**
 * #2511 — the Extensions view in the activity bar, the way VS Code has one.
 *
 * A search box and All / On / Off filters (the Library panel's style), then the groups:
 * Needed by this project (#2512 fills it; hidden while empty), On, Built into Stave, and
 * From the community, which says it is coming later. Clicking a row opens the
 * extension's page as a tab; its Switch button switches it at once.
 *
 * The list is the editor package's (`listedExtensions()`), handed in by the app.
 */
import React, { useMemo, useState } from "react";
import type { ExtensionManifest } from "@stave/editor";
import {
  EXTENSION_FILTERS,
  FILTER_LABELS,
  failedToStart,
  groupExtensions,
  type ExtensionFilter,
  type ExtensionRow,
} from "./extensionsView";
import { useEnabledExtensions, useExtensionFailure } from "./useExtensionSwitches";
import { ExtensionBadges, ExtensionTile, SwitchButton } from "./ExtensionParts";

const NO_NEEDS: ReadonlySet<string> = new Set();

export function ExtensionsPanel({
  manifests,
  needed = NO_NEEDS,
  onOpen,
}: {
  manifests: readonly ExtensionManifest[];
  /** extensions this project uses that are off (#2512) */
  needed?: ReadonlySet<string>;
  /** open the extension's page as a tab */
  onOpen: (id: string) => void;
}) {
  const enabled = useEnabledExtensions();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ExtensionFilter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const groups = useMemo(
    () => groupExtensions(manifests, { enabled, needed, filter, query }),
    [manifests, enabled, needed, filter, query],
  );
  const open = (id: string) => {
    setSelected(id);
    onOpen(id);
  };
  const nothingMatches = !groups.needed.length && !groups.on.length && !groups.builtIn.length;

  return (
    <div style={styles.root} data-sidebar data-extensions-panel>
      <div style={styles.header}>
        <span>EXTENSIONS</span>
      </div>
      <div style={styles.controls}>
        <input
          style={styles.search}
          placeholder="Search extensions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-extensions-search
          aria-label="Search extensions"
        />
        <div style={styles.chipRow} data-filter="extensions-filter" aria-label="Show">
          {EXTENSION_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              style={{ ...styles.chip, ...(filter === f ? styles.chipActive : null) }}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              data-chip={f}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </div>
      <div style={styles.list}>
        {groups.needed.length > 0 && (
          <Group id="needed" title="Needed by this project" rows={groups.needed} selected={selected} onOpen={open} />
        )}
        <Group
          id="on"
          title="On"
          rows={groups.on}
          selected={selected}
          onOpen={open}
          empty={query || filter !== "all" ? null : "None switched on."}
        />
        <Group id="builtin" title="Built into Stave" rows={groups.builtIn} selected={selected} onOpen={open} />
        {nothingMatches && (query || filter !== "all") && (
          <div style={styles.note} data-extensions-empty>
            No extension matches.
          </div>
        )}
        <div style={styles.groupHead} data-extension-group="community">
          From the community
        </div>
        <div style={styles.note}>
          <b style={styles.noteBold}>Coming later.</b> Extensions by other people will be listed and installed here,
          the way VS Code does it.
        </div>
      </div>
    </div>
  );
}

function Group({
  id,
  title,
  rows,
  selected,
  onOpen,
  empty,
}: {
  id: string;
  title: string;
  rows: readonly ExtensionRow[];
  selected: string | null;
  onOpen: (id: string) => void;
  /** what to say when the group is empty; null hides the empty group */
  empty?: string | null;
}) {
  if (!rows.length && !empty) return null;
  return (
    <div data-extension-group={id}>
      <div style={styles.groupHead}>
        {title} <span style={styles.count}>{rows.length}</span>
      </div>
      {rows.length ? (
        rows.map((r) => <Row key={r.id} row={r} selected={selected === r.id} onOpen={onOpen} />)
      ) : (
        <div style={styles.note}>{empty}</div>
      )}
    </div>
  );
}

function Row({ row, selected, onOpen }: { row: ExtensionRow; selected: boolean; onOpen: (id: string) => void }) {
  const failed = failedToStart(row.on, useExtensionFailure(row.id));
  return (
    <div
      role="button"
      tabIndex={0}
      style={{ ...styles.row, ...(selected ? styles.rowSelected : null) }}
      data-extension-row={row.id}
      data-on={row.on ? "true" : "false"}
      data-failed={failed ? "true" : undefined}
      onClick={() => onOpen(row.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(row.id);
        }
      }}
      aria-label={`${row.name}, ${failed ? "couldn't switch on" : row.on ? "on" : "off"}. Open its page`}
    >
      <ExtensionTile manifest={row.manifest} size={36} />
      <div style={styles.rowBody}>
        <div style={styles.rowName}>
          <span>{row.name}</span>
          <ExtensionBadges experimental={row.experimental} on={row.on} failed={failed} />
        </div>
        <div style={{ ...styles.rowDesc, ...styles.ellipsis }} title={row.description}>
          {row.description}
        </div>
        {row.codeNames.length > 0 && (
          <div style={styles.chips}>
            {row.codeNames.map((c) => (
              <code key={c} style={styles.codeChip}>
                {c}
              </code>
            ))}
          </div>
        )}
        <div style={styles.rowFoot}>
          <span style={styles.languages} data-extension-languages={row.id}>
            {row.languages}
          </span>
          <span style={{ flex: 1 }} />
          <SwitchButton id={row.id} name={row.name} on={row.on} where="row" />
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: "100%",
    height: "100%",
    background: "var(--bg-panel)",
    borderRight: "1px solid var(--border-subtle)",
    display: "flex",
    flexDirection: "column",
    fontFamily: "system-ui, -apple-system, sans-serif",
    minHeight: 0,
    color: "var(--text-primary)",
  },
  header: {
    padding: "10px 14px",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.8,
    color: "var(--text-secondary)",
    borderBottom: "1px solid var(--border-subtle)",
  },
  controls: {
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    borderBottom: "1px solid var(--border-subtle)",
  },
  search: {
    width: "100%",
    boxSizing: "border-box",
    padding: "6px 8px",
    fontSize: 12,
    color: "var(--text-primary)",
    background: "var(--bg-input, var(--bg-chrome))",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    outline: "none",
    fontFamily: "inherit",
  },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 4 },
  chip: {
    padding: "2px 8px",
    fontSize: 11,
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    background: "transparent",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border-subtle)",
    borderRadius: 10,
    cursor: "pointer",
    fontFamily: "inherit",
    lineHeight: 1.6,
  },
  chipActive: {
    color: "var(--text-primary)",
    background: "var(--accent-dim, var(--bg-chrome))",
    borderColor: "var(--accent-strong)",
  },
  list: { flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingBottom: 12 },
  groupHead: {
    padding: "10px 14px 6px",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: "var(--text-secondary)",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  count: {
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    fontSize: 10,
    fontWeight: 500,
    color: "var(--text-muted)",
    background: "var(--bg-hover)",
    borderRadius: 8,
    padding: "0 6px",
    letterSpacing: 0,
  },
  note: {
    margin: "2px 12px 4px",
    border: "1px dashed var(--border-strong)",
    borderRadius: 6,
    padding: "9px 11px",
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--text-tertiary)",
  },
  noteBold: { color: "var(--text-secondary)", fontWeight: 600 },
  row: {
    display: "flex",
    gap: 10,
    padding: "9px 12px",
    cursor: "pointer",
    // Longhand, so `rowSelected`'s colour does not mix with a shorthand on re-render.
    borderLeftWidth: 2,
    borderLeftStyle: "solid",
    borderLeftColor: "transparent",
    outlineOffset: -2,
  },
  rowSelected: { background: "var(--accent-dim)", borderLeftColor: "var(--accent-strong)" },
  rowBody: { minWidth: 0, flex: 1 },
  rowName: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "2px 6px", fontWeight: 600, fontSize: 13, minWidth: 0 },
  ellipsis: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  rowDesc: { color: "var(--text-secondary)", fontSize: 12, marginTop: 1 },
  chips: { display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4 },
  codeChip: {
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    fontSize: 10.5,
    color: "var(--text-primary)",
    background: "var(--accent-dim)",
    borderRadius: 3,
    padding: "0 4px",
  },
  rowFoot: { display: "flex", alignItems: "center", gap: 6, marginTop: 6 },
  languages: { fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
};
