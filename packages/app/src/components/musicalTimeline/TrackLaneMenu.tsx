'use client'

/**
 * TrackLaneMenu — the track menu on a Song timeline lane's name area (#1738).
 *
 * Opened by a double-click or a right-click on the lane header, at the pointer.
 * Two entries:
 *  - **Type ▸** — a submenu with a radio choice, Waveform / Bars: what the
 *    collapsed lane draws. Waveform is its audio (a sample's file, a synth's own
 *    render); Bars is the notes only.
 *  - **Rename** — the inline rename a double-click on the name used to start.
 *
 * Closing mirrors `TrackSwatchPopover`: outside mousedown (attached a tick late
 * so the opening gesture does not close it), Escape, a resize, and a scroll that
 * moves the lane header, since the menu is placed from the pointer on open.
 */

import type * as React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TrackDisplay } from '@stave/editor'

export interface TrackLaneMenuProps {
  /** Where the opening gesture happened, in client px. */
  readonly x: number
  readonly y: number
  /** The lane header the menu was opened on. A scroll closes the menu only when
   *  it moves this element — see the effect below. */
  readonly anchor: HTMLElement
  /** The track's display name, for the menu's accessible label. */
  readonly trackName: string
  /** The lane's current type. */
  readonly display: TrackDisplay
  /** Absent → no Type entry (the timeline has nowhere to save it). */
  readonly onSetDisplay?: (display: TrackDisplay) => void
  /** Absent → no Rename entry (the track has no name the code can take). */
  readonly onRename?: () => void
  readonly onClose: () => void
}

const TYPES: readonly { value: TrackDisplay; label: string }[] = [
  { value: 'waveform', label: 'Waveform' },
  { value: 'bars', label: 'Bars' },
]

const MENU_WIDTH = 140

export function TrackLaneMenu({
  x,
  y,
  anchor,
  trackName,
  display,
  onSetDisplay,
  onRename,
  onClose,
}: TrackLaneMenuProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [typeOpen, setTypeOpen] = useState(false)
  // #2082 — the menu grows down from the pointer. Measured once mounted, it
  // moves up when it would cross the bottom of the window, ending 8 px above
  // it as its left edge is kept 8 px inside. The Type submenu opens beside the
  // first row, so it stays within the menu's own height.
  const [top, setTop] = useState(y)
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0
    setTop(Math.max(8, Math.min(window.innerHeight - 8 - height, y)))
  }, [y])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Placed from the pointer, so a scroll that MOVES the header leaves the menu
    // behind: close it then. Only then — a double-click's first click jumps to
    // the track's code, and the editor's own scroll events arrive after the
    // menu opens; closing on those shut the menu before it was ever seen.
    const onScroll = (e: Event) => {
      const t = e.target
      if (t === document || (t instanceof Node && t.contains(anchor))) onClose()
    }
    const onResize = () => onClose()
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [onClose, anchor])

  const left =
    typeof window !== 'undefined' ? Math.max(8, Math.min(window.innerWidth - 8 - MENU_WIDTH * 2, x)) : x

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`${trackName} track menu`}
      data-full-song-lane-menu={trackName}
      style={{ ...styles.menu, left, top }}
      // The menu is mounted beside the grid; keep its clicks out of the header's
      // jump-to-code and the grid's selection handlers.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {onSetDisplay && (
        <div style={{ position: 'relative' }} onMouseEnter={() => setTypeOpen(true)} onMouseLeave={() => setTypeOpen(false)}>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={typeOpen}
            data-full-song-lane-menu-type
            onClick={() => setTypeOpen((o) => !o)}
            style={{ ...styles.item, ...(typeOpen ? styles.itemActive : null) }}
          >
            <span>Type</span>
            <span aria-hidden>▸</span>
          </button>
          {typeOpen && (
            <div role="menu" aria-label="Type" data-full-song-lane-menu-types style={{ ...styles.menu, ...styles.submenu }}>
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={display === t.value}
                  data-full-song-lane-menu-display={t.value}
                  onClick={() => {
                    onSetDisplay(t.value)
                    onClose()
                  }}
                  style={styles.item}
                >
                  <span aria-hidden style={styles.radio}>{display === t.value ? '●' : '○'}</span>
                  <span style={{ flex: 1 }}>{t.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {onRename && (
        <button
          type="button"
          role="menuitem"
          data-full-song-lane-menu-rename
          onClick={() => {
            onClose()
            onRename()
          }}
          style={styles.item}
        >
          <span>Rename</span>
        </button>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  menu: {
    position: 'fixed',
    zIndex: 1000,
    minWidth: MENU_WIDTH,
    background: 'var(--bg-elevated, #1a1a1a)',
    border: '1px solid var(--border-strong, #333)',
    borderRadius: 4,
    padding: '4px 0',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.45)',
    display: 'flex',
    flexDirection: 'column',
  },
  submenu: {
    position: 'absolute',
    left: '100%',
    top: -5,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    width: '100%',
    padding: '4px 10px',
    fontSize: 12,
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    color: 'var(--text, #ddd)',
    cursor: 'pointer',
  },
  itemActive: {
    background: 'var(--accent-soft, rgba(117,186,255,0.18))',
  },
  radio: {
    width: 12,
    fontSize: 10,
  },
}
