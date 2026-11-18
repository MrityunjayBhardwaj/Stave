"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import { shownIndex, usePointerMoved } from "./listHighlight";

/**
 * In-editor docs search — Phase 2 + 3 of the docs initiative.
 *
 * - Fuzzy-searches the 900+ entries across all 4 runtimes using the
 *   `docs-search.json` index Astro publishes alongside the docs site.
 * - Left column: result list. Right column: live preview of the highlighted
 *   row (signature, description, example, upstream link).
 * - Enter opens the docs page for the highlighted row in a new tab;
 *   Ctrl/Cmd+Enter opens the upstream reference instead.
 *
 * Intentionally separate from `CommandPalette` — the preview column and
 * runtime-tagged styling don't fit the one-column command list model.
 */

interface DocsSearchRow {
  runtime: string
  name: string
  signature: string
  description: string
  kind?: string
  category?: string
  /** URL fragment relative to the /docs site (e.g. `/reference/p5/#ellipse`). */
  url: string
  /** Upstream reference link if provided. */
  upstream: string | null
}

interface Props {
  open: boolean
  onClose: () => void
}

// Module-level cache — load once per session.
let cachedIndex: DocsSearchRow[] | null = null
let inflight: Promise<DocsSearchRow[]> | null = null

async function loadIndex(): Promise<DocsSearchRow[]> {
  if (cachedIndex) return cachedIndex
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch("/docs/docs-search.json", { cache: "force-cache" })
      if (!res.ok) throw new Error(`docs-search.json: ${res.status}`)
      const rows = (await res.json()) as DocsSearchRow[]
      cachedIndex = rows
      return rows
    } catch (err) {
      console.warn("[stave] docs search index unavailable:", err)
      cachedIndex = []
      return cachedIndex
    } finally {
      inflight = null
    }
  })()
  return inflight
}

const RUNTIME_LABELS: Record<string, string> = {
  strudel: "Strudel",
  sonicpi: "Sonic Pi",
  p5: "p5.js",
  hydra: "Hydra",
}

const RUNTIME_COLORS: Record<string, string> = {
  strudel: "#93c5fd",
  sonicpi: "#a78bfa",
  p5: "#fde68a",
  hydra: "#86efac",
}

function fuzzyScore(row: DocsSearchRow, q: string): number {
  if (!q) return 1
  const lower = q.toLowerCase()
  const name = row.name.toLowerCase()
  if (name === lower) return 1000
  if (name.startsWith(lower)) return 500 - (name.length - lower.length)
  if (name.includes(lower)) return 200
  const desc = (row.description ?? "").toLowerCase()
  if (desc.includes(lower)) return 50
  const sig = (row.signature ?? "").toLowerCase()
  if (sig.includes(lower)) return 25
  return 0
}

function filter(rows: DocsSearchRow[], q: string): DocsSearchRow[] {
  const tokens = q
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
  if (tokens.length === 0) return rows.slice(0, 80)
  const scored: Array<{ row: DocsSearchRow; score: number }> = []
  for (const row of rows) {
    let total = 0
    for (const t of tokens) {
      const s = fuzzyScore(row, t)
      if (s === 0) {
        total = 0
        break
      }
      total += s
    }
    if (total > 0) scored.push({ row, score: total })
  }
  scored.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
  return scored.slice(0, 80).map((s) => s.row)
}

export function DocsSearchPalette({ open, onClose }: Props): React.ReactElement | null {
  const [index, setIndex] = useState<DocsSearchRow[] | null>(cachedIndex)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery("")
    setActive(0)
    queueMicrotask(() => inputRef.current?.focus())
    if (!index) loadIndex().then(setIndex).catch(() => {})
  }, [open, index])

  const rows = useMemo(() => (index ? filter(index, query) : []), [index, query])

  // #2614 — the highlight never points past the list (the index can load or
  // the query narrow under it), and follows the mouse only when it moves.
  const shown = shownIndex(active, rows.length)
  const pointerMoved = usePointerMoved()

  // Keep the active row in view.
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-docs-row="${shown}"]`,
    )
    el?.scrollIntoView({ block: "nearest" })
  }, [shown])

  if (!open) return null

  const selected = rows[shown]

  const openDocs = (row: DocsSearchRow, upstream = false) => {
    const href = upstream && row.upstream ? row.upstream : `/docs${row.url}`
    window.open(href, "_blank", "noopener,noreferrer")
    onClose()
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      onClose()
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive(Math.min(rows.length - 1, shown + 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive(Math.max(0, shown - 1))
    } else if (e.key === "Enter") {
      if (!selected) return
      e.preventDefault()
      openDocs(selected, e.ctrlKey || e.metaKey)
    }
  }

  return (
    <>
      <div style={styles.backdrop} onClick={onClose} data-testid="docs-search-backdrop" />
      <div style={styles.modal} data-testid="docs-search-modal" role="dialog" aria-modal="true" aria-label="Search documentation">
        <div style={styles.inputRow}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0) }}
            onKeyDown={handleKey}
            placeholder={index ? `Search docs · ${index.length} symbols` : "Loading docs index…"}
            style={styles.input}
            spellCheck={false}
          />
          <span style={styles.hint}>
            ↩ open  ·  ⌘↩ upstream  ·  esc close
          </span>
        </div>
        <div style={styles.body}>
          <div ref={listRef} style={styles.list}>
            {rows.length === 0 && (
              <div style={styles.empty}>
                {index === null
                  ? "Loading index…"
                  : index.length === 0
                  ? "Docs search index not found. Run `pnpm --filter @stave/docs build`."
                  : "No matches."}
              </div>
            )}
            {rows.map((row, i) => (
              <button
                key={`${row.runtime}:${row.name}`}
                data-docs-row={i}
                onMouseMove={(e) => { if (pointerMoved(e)) setActive(i) }}
                onClick={() => openDocs(row)}
                style={{
                  ...styles.row,
                  ...(i === shown ? styles.rowActive : {}),
                }}
              >
                <span
                  style={{
                    ...styles.badge,
                    color: RUNTIME_COLORS[row.runtime] ?? "var(--text-secondary)",
                    borderColor: RUNTIME_COLORS[row.runtime] ?? "var(--border)",
                  }}
                >
                  {RUNTIME_LABELS[row.runtime] ?? row.runtime}
                </span>
                <span style={styles.name}>{row.name}</span>
                <span style={styles.sig}>{row.signature}</span>
              </button>
            ))}
          </div>
          <aside style={styles.preview}>
            {selected ? (
              <>
                <div style={styles.previewTitle}>
                  <span
                    style={{
                      ...styles.badge,
                      color: RUNTIME_COLORS[selected.runtime] ?? "var(--text-secondary)",
                      borderColor: RUNTIME_COLORS[selected.runtime] ?? "var(--border)",
                    }}
                  >
                    {RUNTIME_LABELS[selected.runtime] ?? selected.runtime}
                  </span>
                  <span style={styles.previewName}>{selected.name}</span>
                </div>
                <pre style={styles.previewSig}>{selected.signature}</pre>
                {selected.description && (
                  <p style={styles.previewDesc}>{selected.description}</p>
                )}
                {selected.category && (
                  <div style={styles.previewMeta}>
                    <strong>Category:</strong> {selected.category}
                  </div>
                )}
                {selected.kind && (
                  <div style={styles.previewMeta}>
                    <strong>Kind:</strong> {selected.kind}
                  </div>
                )}
                <div style={styles.previewLinks}>
                  <span>↩ Open docs page</span>
                  {selected.upstream && <span>⌘↩ Upstream reference</span>}
                </div>
              </>
            ) : (
              <div style={styles.empty}>Start typing to search the docs.</div>
            )}
          </aside>
        </div>
      </div>
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    zIndex: 9998,
  },
  modal: {
    position: "fixed" as const,
    top: "12vh",
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(900px, 92vw)",
    maxHeight: "72vh",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 6,
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    zIndex: 9999,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  inputRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border-subtle)",
  },
  input: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
    fontSize: 14,
    fontFamily: "inherit",
  },
  hint: {
    color: "var(--text-tertiary)",
    fontSize: 11,
    whiteSpace: "nowrap" as const,
  },
  body: {
    display: "flex",
    minHeight: 0,
    flex: 1,
  },
  list: {
    flex: "0 0 50%",
    overflow: "auto",
    borderRight: "1px solid var(--border-subtle)",
    padding: "4px 0",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "6px 14px",
    background: "none",
    border: "none",
    color: "var(--text-primary)",
    textAlign: "left" as const,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
  },
  rowActive: {
    background: "var(--bg-hover)",
  },
  badge: {
    display: "inline-block",
    padding: "1px 6px",
    border: "1px solid var(--border)",
    borderRadius: 3,
    fontSize: 9,
    letterSpacing: 0.4,
    textTransform: "uppercase" as const,
    flexShrink: 0,
  },
  name: {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontWeight: 500,
    flexShrink: 0,
  },
  sig: {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    color: "var(--text-tertiary)",
    fontSize: 11,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  preview: {
    flex: 1,
    overflow: "auto",
    padding: "14px 16px",
    color: "var(--text-primary)",
    fontSize: 13,
  },
  previewTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  previewName: {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: 16,
    fontWeight: 600,
  },
  previewSig: {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: 12,
    background: "var(--bg-app)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 3,
    padding: "8px 10px",
    margin: "0 0 10px 0",
    whiteSpace: "pre-wrap" as const,
    overflowX: "auto" as const,
  },
  previewDesc: {
    margin: "6px 0 12px 0",
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  },
  previewMeta: {
    marginTop: 6,
    fontSize: 11,
    color: "var(--text-tertiary)",
  },
  previewLinks: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginTop: 14,
    fontSize: 11,
    color: "var(--text-tertiary)",
  },
  empty: {
    padding: "20px 14px",
    color: "var(--text-tertiary)",
    fontSize: 12,
  },
}
