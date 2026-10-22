/**
 * visualEditSeed — registers the single adaptive "Pattern" tab alongside
 * "Timeline" (#398; collapsed from the original Sequencer / Mixer / Piano Roll
 * trio of #380).
 *
 * Mirrors `seedTabs.ts` (the Timeline placeholder): imported for side-effects
 * from BottomPanel.tsx so the seed runs when the drawer bundle first loads,
 * not at the @stave/editor barrel top level (which would seed in package
 * consumers that never render the drawer). The panel re-registers its id with
 * the live UI; the registry's idempotent replace (DA-05) makes the swap
 * flicker-free.
 *
 * Vocabulary discipline (PV32 / D-06): titles and hints are musician-facing,
 * no IR jargon.
 */
import * as React from 'react'

import { registerBottomPanelTab } from './bottomPanelRegistry'
import { PatternPanel } from '../../visualEdit/panels/PatternPanel'
import { MixerConsolePanel } from '../../visualEdit/mixer/MixerConsolePanel'
import { VISUAL_EDIT_TABS, PATTERN_TAB_ID, MIXER_CONSOLE_TAB_ID } from '../../visualEdit/panels/tabs'
import { PatternSideToggle } from '../../visualEdit/panels/patternSide'

const PANELS: Record<string, () => React.ReactElement> = {
  [PATTERN_TAB_ID]: PatternPanel,
  [MIXER_CONSOLE_TAB_ID]: MixerConsolePanel,
}

/**
 * Register the visual-editing tab(s) with their live panel. Idempotent —
 * re-seeding or the panel re-registering its id just replaces the entry.
 */
export function seedVisualEditTabs(): void {
  for (const tab of VISUAL_EDIT_TABS) {
    const Panel = PANELS[tab.id]
    registerBottomPanelTab({
      id: tab.id,
      title: tab.title,
      icon: tab.icon,
      content: React.createElement(Panel),
      // the Pattern tab's button for its right side panel (#2044)
      headerActions: tab.id === PATTERN_TAB_ID ? React.createElement(PatternSideToggle) : undefined,
    })
  }
}

seedVisualEditTabs()
