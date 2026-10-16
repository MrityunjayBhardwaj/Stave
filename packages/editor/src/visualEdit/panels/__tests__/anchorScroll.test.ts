import { describe, expect, it } from 'vitest'

import { scrollVerdict } from '../anchorScroll'

const rect = (top: number, left = 100, h = 28, w = 120) => ({ top, left, bottom: top + h, right: left + w })
const panel = { top: 580, left: 0, bottom: 720, right: 1280 }

describe('scrollVerdict (#2088)', () => {
  it('ignores a scroll that left the trigger where the menu was placed from', () => {
    // the late event of a scroll that happened before the menu opened
    expect(scrollVerdict(rect(653), rect(653), panel)).toBe('ignore')
    expect(scrollVerdict(rect(653), rect(653.3), panel)).toBe('ignore')
  })

  it('follows a trigger that moved but is still in view', () => {
    expect(scrollVerdict(rect(653), rect(600), panel)).toBe('follow')
    expect(scrollVerdict(rect(653, 100), rect(653, 60), panel)).toBe('follow')
  })

  it('closes once the trigger has left the scrolled box', () => {
    expect(scrollVerdict(rect(653), rect(540), panel)).toBe('close') // bottom 568 <= 580
    expect(scrollVerdict(rect(653), rect(720), panel)).toBe('close') // top at the box's bottom
  })

  it('keeps a trigger that is only partly in view', () => {
    expect(scrollVerdict(rect(653), rect(560), panel)).toBe('follow') // bottom 588 > 580
  })

  it('treats an unplaced menu as moved', () => {
    expect(scrollVerdict(null, rect(653), panel)).toBe('follow')
  })
})
