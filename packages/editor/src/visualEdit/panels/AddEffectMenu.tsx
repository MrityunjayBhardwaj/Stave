/**
 * AddEffectMenu — the "＋ More" popover over the full effect catalog (#575).
 *
 * Sits next to the favorite buttons. Opens a grouped, searchable list of every
 * effect in `effectCatalog`; each row is a toggle (✓ when present), so the menu
 * is the unified add *and* remove surface for the long tail. No document state —
 * `present` (the chain's method names) drives the ✓, `onToggle` does the write.
 *
 * The popover is rendered through a portal to `document.body` and positioned by
 * the button's viewport rect — the Mixer-console expand drawer is strip-height
 * with `overflow: hidden`, so an in-flow `absolute` menu would be clipped. It
 * flips above the button when there's more room there, and closes on scroll/
 * resize (the fixed position would otherwise drift).
 */
import * as React from 'react'
import { createPortal } from 'react-dom'

import { useAnchorScroll } from './anchorScroll'
import { EFFECT_GROUPS, isEffectActive, type Effect } from './effectCatalog'

const MENU_WIDTH = 230

export function AddEffectMenu({
  present,
  onToggle,
}: {
  /** method names currently in the chain (drives the ✓ state, alias-aware) */
  present: ReadonlySet<string>
  /** add the effect if absent, remove it if present */
  onToggle: (e: Effect) => void
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [pos, setPos] = React.useState<{ top: number; left: number; maxHeight: number } | null>(null)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)

  // Position the portal off the button's viewport rect; flip up if cramped.
  const place = React.useCallback((): void => {
    const b = btnRef.current?.getBoundingClientRect()
    if (!b) return
    const margin = 8
    const below = window.innerHeight - b.bottom - margin
    const above = b.top - margin
    const openUp = below < 200 && above > below
    const maxHeight = Math.min(300, Math.max(120, openUp ? above : below))
    setPos({
      top: openUp ? Math.max(margin, b.top - 4 - maxHeight) : b.bottom + 4,
      left: Math.max(margin, Math.min(b.left, window.innerWidth - MENU_WIDTH - margin)),
      maxHeight,
    })
  }, [])

  React.useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

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

  // An ancestor scroll (the drawer body, the page) would drift the
  // fixed-position menu off its button: it follows the button instead, and
  // closes once the button scrolls out of view. The menu's own list scroll
  // never counts — the user must be able to browse the long tail (#2088).
  const close = React.useCallback((): void => setOpen(false), [])
  useAnchorScroll(open, btnRef, menuRef, place, close)

  const q = query.trim().toLowerCase()
  const groups = EFFECT_GROUPS.map(
    ([group, effects]) =>
      [
        group,
        q
          ? effects.filter(
              (e) => e.label.toLowerCase().includes(q) || e.method.toLowerCase().includes(q),
            )
          : effects,
      ] as const,
  ).filter(([, effects]) => effects.length > 0)

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            data-mixer-add-effect-menu
            style={{
              position: 'fixed',
              zIndex: 1000,
              top: pos.top,
              left: pos.left,
              width: MENU_WIDTH,
              maxHeight: pos.maxHeight,
              overflowY: 'auto',
              padding: 6,
              borderRadius: 6,
              border: '1px solid var(--border, #3a3a42)',
              background: 'var(--background-elevated, #26262c)',
              boxShadow: '0 6px 20px rgba(0, 0, 0, 0.4)',
              fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            }}
          >
            <input
              autoFocus
              data-mixer-add-effect-search
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search effects…"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '4px 8px',
                marginBottom: 4,
                fontSize: 12,
                borderRadius: 4,
                border: '1px solid var(--border, #3a3a42)',
                background: 'var(--background, #1c1c20)',
                color: 'var(--foreground, #e6e6ea)',
              }}
            />
            {groups.map(([group, effects]) => (
              <div key={group}>
                <div
                  style={{
                    fontSize: 9,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: 'var(--foreground-muted, #6a6a72)',
                    margin: '6px 4px 2px',
                  }}
                >
                  {group}
                </div>
                {effects.map((e) => {
                  const active = isEffectActive(present, e)
                  return (
                    <button
                      key={e.method}
                      type="button"
                      data-mixer-add-effect-item={e.method}
                      aria-pressed={active}
                      onClick={() => onToggle(e)}
                      style={{
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
                        background: active ? 'var(--background, #1c1c20)' : 'transparent',
                        color: 'var(--foreground, #e6e6ea)',
                      }}
                    >
                      <span style={{ width: 12, color: 'var(--accent, #6ea8fe)' }}>
                        {active ? '✓' : ''}
                      </span>
                      {e.label}
                    </button>
                  )
                })}
              </div>
            ))}
            {groups.length === 0 && (
              <div style={{ padding: 8, fontSize: 11, color: 'var(--foreground-muted, #a0a0aa)' }}>
                No effects match “{query}”.
              </div>
            )}
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-mixer-add-effect
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Add effect"
        style={{
          padding: '3px 10px',
          fontSize: 11,
          borderRadius: 4,
          cursor: 'pointer',
          border: '1px solid var(--border, #3a3a42)',
          background: 'var(--background-elevated, #26262c)',
          color: 'var(--foreground, #e6e6ea)',
        }}
      >
        ＋ More ▾
      </button>
      {menu}
    </>
  )
}
