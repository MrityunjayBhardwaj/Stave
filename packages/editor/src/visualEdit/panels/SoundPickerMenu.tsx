/**
 * SoundPickerMenu — a searchable popover for sound assignment (#827), replacing
 * the native grouped `<select>` the instrument (#514) and kit (#515) pickers used
 * to be. With the live registry now enumerating ~487 melodic sounds (and the GM
 * families of #807), a native dropdown is clumsy to scan; this mirrors the ＋More
 * effects menu right next to it — a trigger + search box + category tags with
 * counts + the grouped, filtered list.
 *
 * Drop-in for the old `SoundSelect`: same props (`label`/`groups`/`value`/
 * `placeholder`/`onChange`/`onAudition`). Behaviour preserved — a hand-typed
 * value outside the catalog still shows on the trigger (the write-back accepts
 * any string, PV141 #6); picking auditions the sound (audition-on-select, #805);
 * the ▶ button previews the current value without changing it.
 *
 * Positioning/dismiss logic mirrors AddEffectMenu: portaled to <body> and
 * placed off the trigger's viewport rect (the Mixer-console drawer is
 * `overflow:hidden`, so an in-flow menu would clip), flips up when cramped, and
 * closes on outside-click / Escape / resize. An ancestor scroll moves it with
 * its trigger and closes it only when the trigger leaves view (#2088).
 */
import * as React from 'react'
import { createPortal } from 'react-dom'

import { useAnchorScroll } from './anchorScroll'
import type { SoundGroup } from './soundCatalog'
import { categoryCounts, filterGroups, totalOptions } from './soundPickerFilter'

const MENU_WIDTH = 230

// Blink doesn't honour `scrollbarWidth: 'none'` inline, so inject a one-time
// rule to hide the category row's horizontal scrollbar (it still scrolls). Same
// pattern as WorkspaceShell's tabbar.
let catScrollStyleInjected = false
function ensureCatScrollStyle(): void {
  if (catScrollStyleInjected) return
  if (typeof document === 'undefined') return
  const el = document.createElement('style')
  el.setAttribute('data-stave-style', 'sound-picker-cats')
  el.textContent = '[data-mixer-sound-cats]::-webkit-scrollbar{display:none;width:0;height:0}'
  document.head.appendChild(el)
  catScrollStyleInjected = true
}

export function SoundPickerMenu({
  label,
  groups,
  value,
  summary,
  refusal,
  placeholder,
  onChange,
  onAudition,
  renderTrigger,
}: {
  label: string
  groups: SoundGroup[]
  value: string
  /** what the trigger reads instead of `value` — a pattern of several sounds (#2226) */
  summary?: string
  /** why no pick may be written here; the menu says so instead of listing sounds (#2226) */
  refusal?: string
  placeholder: string
  onChange: (v: string) => void
  /** When set, render a ▶ button that previews the current value without
   *  changing it (#805), and audition each pick on select. */
  onAudition?: (v: string) => void
  /**
   * Draw your own trigger instead of the labelled box (#2226: a block of the roll's
   * sound lane opens this menu). Give the button `ref` and call `toggle` on click.
   */
  renderTrigger?: (t: { ref: React.RefObject<HTMLButtonElement>; open: boolean; toggle: () => void }) => React.ReactElement
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState<string | null>(null)
  const [pos, setPos] = React.useState<{ top: number; left: number; maxHeight: number } | null>(null)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const lc = label.toLowerCase()

  // The label to show on the trigger: the catalog label for a known value, the
  // raw string for a hand-typed one, or the placeholder when unset.
  const currentLabel =
    summary ?? (groups.flatMap((g) => g.options).find((o) => o.value === value)?.label || value || placeholder)

  const place = React.useCallback((): void => {
    const b = btnRef.current?.getBoundingClientRect()
    if (!b) return
    const margin = 8
    const below = window.innerHeight - b.bottom - margin
    const above = b.top - margin
    const openUp = below < 240 && above > below
    const maxHeight = Math.min(340, Math.max(160, openUp ? above : below))
    setPos({
      top: openUp ? Math.max(margin, b.top - 4 - maxHeight) : b.bottom + 4,
      left: Math.max(margin, Math.min(b.left, window.innerWidth - MENU_WIDTH - margin)),
      maxHeight,
    })
  }, [])

  React.useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  // Reset the transient search/category each time the menu opens.
  React.useEffect(() => {
    if (open) {
      ensureCatScrollStyle()
      setQuery('')
      setCategory(null)
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    const dismiss = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', dismiss)
    }
  }, [open])

  // An outside scroll keeps the menu on its trigger, and closes it only once
  // the trigger has scrolled out of view (#2088).
  const close = React.useCallback((): void => setOpen(false), [])
  useAnchorScroll(open, btnRef, menuRef, place, close)

  const pick = (v: string): void => {
    onChange(v)
    if (v) onAudition?.(v)
    setOpen(false)
  }

  const cats = categoryCounts(groups)
  const total = totalOptions(groups)
  const shown = filterGroups(groups, query, category)

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            data-mixer-sound-menu={lc}
            style={{
              position: 'fixed',
              zIndex: 1000,
              top: pos.top,
              left: pos.left,
              width: MENU_WIDTH,
              maxHeight: pos.maxHeight,
              display: 'flex',
              flexDirection: 'column',
              padding: 6,
              borderRadius: 6,
              border: '1px solid var(--border, #3a3a42)',
              background: 'var(--background-elevated, #26262c)',
              boxShadow: '0 6px 20px rgba(0, 0, 0, 0.4)',
              fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            }}
          >
            {refusal ? (
              <div
                data-mixer-sound-refusal={lc}
                style={{ padding: 6, fontSize: 12, lineHeight: 1.4, color: 'var(--foreground, #e6e6ea)' }}
              >
                {refusal}
              </div>
            ) : (
            <>
            <input
              autoFocus
              data-mixer-sound-search={lc}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                flexShrink: 0,
                padding: '4px 8px',
                marginBottom: 4,
                fontSize: 12,
                borderRadius: 4,
                border: '1px solid var(--border, #3a3a42)',
                background: 'var(--background, #1c1c20)',
                color: 'var(--foreground, #e6e6ea)',
              }}
            />
            {/* Category tags with counts (All + one per category). Capped at 2
                rows that scroll horizontally — the kit picker has ~12
                manufacturers, which would otherwise stack into many rows and
                push the list down. A column-flow grid with 2 rows lays chips out
                top-then-bottom per column; the row overflows sideways. */}
            {cats.length > 1 && (
              <div
                data-mixer-sound-cats
                style={{
                  display: 'grid',
                  gridAutoFlow: 'column',
                  gridTemplateRows: 'repeat(2, auto)',
                  gridAutoColumns: 'max-content',
                  gap: 3,
                  marginBottom: 4,
                  overflowX: 'auto',
                  // Explicit hidden so `overflowX:auto` doesn't compute overflowY
                  // to `auto` and add a vertical scrollbar; the 2 rows fit exactly.
                  overflowY: 'hidden',
                  // Firefox ignores the injected `::-webkit-scrollbar` rule, so
                  // hide its scrollbar with the standard prop too (belt still
                  // scrolls). Same dual pattern as WorkspaceShell's tabbar.
                  scrollbarWidth: 'none',
                  paddingBottom: 2,
                  // Keep the natural 2-row height — don't let the tall option list
                  // below shrink this to a sliver (the flex-column default).
                  flexShrink: 0,
                }}
              >
                <CategoryChip
                  label="All"
                  count={total}
                  active={category === null}
                  onClick={() => setCategory(null)}
                  dataValue="all"
                />
                {cats.map((c) => (
                  <CategoryChip
                    key={c.category}
                    label={c.category}
                    count={c.count}
                    active={category === c.category}
                    onClick={() => setCategory((cur) => (cur === c.category ? null : c.category))}
                    dataValue={c.category}
                  />
                ))}
              </div>
            )}
            <div style={{ flex: '1 1 auto', overflowY: 'auto', minHeight: 0 }}>
              {/* "Default" clears to the placeholder (the old empty <option>). */}
              <button
                type="button"
                data-mixer-sound-default={lc}
                onClick={() => pick('')}
                style={{ ...ITEM_STYLE, fontStyle: 'italic', color: 'var(--foreground-muted, #a0a0aa)' }}
              >
                {placeholder}
              </button>
              {shown.map((g) => (
                <div key={g.group}>
                  <div style={GROUP_HEADER_STYLE}>{g.group}</div>
                  {g.options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      data-mixer-sound-option={o.value}
                      aria-pressed={o.value === value}
                      onClick={() => pick(o.value)}
                      style={{
                        ...ITEM_STYLE,
                        background: o.value === value ? 'var(--background, #1c1c20)' : 'transparent',
                      }}
                    >
                      <span style={{ width: 12, flexShrink: 0, color: 'var(--accent, #6ea8fe)' }}>
                        {o.value === value ? '✓' : ''}
                      </span>
                      {o.label}
                    </button>
                  ))}
                </div>
              ))}
              {shown.length === 0 && (
                <div style={{ padding: 8, fontSize: 11, color: 'var(--foreground-muted, #a0a0aa)' }}>
                  No {label.toLowerCase()} matches “{query}”.
                </div>
              )}
            </div>
            </>
            )}
          </div>,
          document.body,
        )
      : null

  if (renderTrigger) {
    return (
      <>
        {renderTrigger({ ref: btnRef, open, toggle: () => setOpen((o) => !o) })}
        {menu}
      </>
    )
  }

  return (
    <label
      data-mixer-sound={lc}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}
    >
      <span style={{ color: 'var(--foreground-muted, #a0a0aa)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', maxWidth: 220 }}>
        <button
          ref={btnRef}
          type="button"
          data-mixer-sound-trigger={lc}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          title={summary ?? (value || placeholder)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            padding: '4px 8px',
            fontSize: 12,
            borderRadius: 4,
            border: '1px solid var(--border, #3a3a42)',
            background: 'var(--background-elevated, #26262c)',
            color: value || summary ? 'var(--foreground, #e6e6ea)' : 'var(--foreground-muted, #a0a0aa)',
            cursor: 'pointer',
            flex: '1 1 auto',
            minWidth: 0,
            textAlign: 'left',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentLabel}
          </span>
          <span style={{ flexShrink: 0, opacity: 0.6 }}>▾</span>
        </button>
        {onAudition && (
          <button
            type="button"
            data-mixer-sound-audition={lc}
            title={value ? `Preview ${value}` : 'Pick a sound to preview'}
            aria-label="Preview sound"
            disabled={!value}
            onClick={() => value && onAudition(value)}
            style={{
              flexShrink: 0,
              width: 24,
              height: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              lineHeight: 1,
              borderRadius: 4,
              border: '1px solid var(--border, #3a3a42)',
              background: 'var(--background-elevated, #26262c)',
              color: value ? 'var(--foreground, #e6e6ea)' : 'var(--text-disabled, #555)',
              cursor: value ? 'pointer' : 'default',
            }}
          >
            ▶
          </button>
        )}
      </div>
      {menu}
    </label>
  )
}

const ITEM_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  textAlign: 'left',
  padding: '4px 6px',
  fontSize: 12,
  borderRadius: 4,
  border: 'none',
  cursor: 'pointer',
  color: 'var(--foreground, #e6e6ea)',
  background: 'transparent',
}

const GROUP_HEADER_STYLE: React.CSSProperties = {
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'var(--foreground-muted, #6a6a72)',
  margin: '6px 4px 2px',
}

function CategoryChip({
  label,
  count,
  active,
  onClick,
  dataValue,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  dataValue: string
}): React.ReactElement {
  return (
    <button
      type="button"
      data-mixer-sound-category={dataValue}
      aria-pressed={active}
      onClick={onClick}
      style={{
        padding: '1px 6px',
        fontSize: 10,
        borderRadius: 9,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: active ? 'var(--accent, #6ea8fe)' : 'var(--border, #3a3a42)',
        background: active ? 'var(--background, #1c1c20)' : 'transparent',
        color: active ? 'var(--foreground, #e6e6ea)' : 'var(--foreground-muted, #a0a0aa)',
      }}
    >
      {label} <span style={{ opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </button>
  )
}
