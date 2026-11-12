import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { bootApp } from './_appBoot'

/**
 * #2148 — Vim keybindings in the code editor, as an extension, through the real gestures.
 *
 * The issue's "Done when", one test each:
 *  - switched on from the Extensions view: normal, insert and visual modes work, the bar
 *    under the editor shows the mode, `:` opens in that editor's bar, `:w` shows the
 *    message; and Vim's code is fetched only once it is switched on;
 *  - Play and Stop work from normal mode and from insert mode;
 *  - two panes side by side each have their own bar, and `:` opens in the one typed in;
 *  - in the history view (a commit checked out, and the history tab) motions, search and
 *    yank work and edits are refused; the diff has no Vim;
 *  - handing a key back makes it run the Stave command again (driven through the stored
 *    "handed back" setting, which Vim and the key dispatcher read on every keystroke).
 *    Off a Mac, Vim's Ctrl keys are Stave's Ctrl keys, so this one runs as Windows;
 *  - switched off: no bar, no taken keys, the editor exactly as before, and the person's
 *    own shortcuts (`stave:keybindings`) untouched throughout.
 *
 * Screenshots of each state go to the test's output folder.
 */

test.use({
  // Play has to start sound without a click first
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
})

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const TEXT = ['kick: s("bd*4")', 'hats: s("hh*8")', 'bass: note("c2").s("sawtooth")'].join('\n')

type MonacoWindow = {
  monaco?: {
    editor?: {
      getEditors?: () => Array<{
        getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void; getValue: () => string } | null
        getValue: () => string
        getPosition: () => { lineNumber: number; column: number } | null
        setPosition: (p: { lineNumber: number; column: number }) => void
        getRawOptions: () => Record<string, unknown>
        hasTextFocus: () => boolean
        getDomNode: () => HTMLElement | null
        focus: () => void
      }>
    }
  }
}

/** Switch Vim on (or off) before the page loads, the way a saved switch does. */
async function vimAtLoad(page: Page | BrowserContext, on: boolean): Promise<void> {
  await page.addInitScript((v) => {
    try {
      window.localStorage.setItem('stave:extensions', JSON.stringify(v ? ['vim'] : []))
    } catch {
      /* private mode */
    }
  }, on)
}

/** The code editor in the active pane: put known text in it, focus it, cursor at the top. */
async function seed(page: Page, text = TEXT): Promise<void> {
  await page.evaluate((t) => {
    const eds = (window as unknown as MonacoWindow).monaco?.editor?.getEditors?.() ?? []
    const ed = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    ed?.getModel()?.setValue(t)
    ed?.setPosition({ lineNumber: 1, column: 1 })
    ed?.focus()
  }, text)
}

/** The text and cursor of the editor that has the focus. */
function focused(page: Page): Promise<{ text: string; line: number; column: number } | null> {
  return page.evaluate(() => {
    const eds = (window as unknown as MonacoWindow).monaco?.editor?.getEditors?.() ?? []
    const ed = eds.find((e) => e.hasTextFocus())
    if (!ed) return null
    const p = ed.getPosition()
    return { text: ed.getValue(), line: p?.lineNumber ?? 0, column: p?.column ?? 0 }
  })
}

const bars = (page: Page) => page.locator('[data-vim-bar]')
const modeOf = (page: Page, i = 0) => bars(page).nth(i).locator('[data-vim-mode]')

async function clickCode(page: Page, i = 0): Promise<void> {
  await page.locator('[data-workspace-view="editor"] .monaco-editor .view-lines').nth(i).click()
}

async function openExtensionsView(page: Page): Promise<void> {
  // the icon toggles the view: click it only while the view is shut
  if (!(await page.locator('[data-extensions-panel]').isVisible())) {
    await page.locator('[data-activity-bar] [data-panel-id="extensions"]').click()
  }
  await expect(page.locator('[data-extensions-panel]')).toBeVisible()
}

async function flipVimInView(page: Page, on: boolean): Promise<void> {
  await openExtensionsView(page)
  const row = page.locator('[data-extension-row="vim"]')
  await row.locator('[data-extension-switch="vim"]').click()
  await expect(row).toHaveAttribute('data-on', String(on))
}

async function isPlaying(page: Page): Promise<boolean> {
  const b = page.locator('[data-testid="strudel-chrome-transport"]')
  await expect(b).toHaveCount(1)
  return ((await b.first().innerText()) || '').includes('Stop')
}

test('switched on from the view: modes, the bar, the : line and the :w message; its code fetched only then', async ({ page }) => {
  test.setTimeout(120_000)
  const vimFetches: string[] = []
  page.on('request', (r) => {
    if (/editor_dist_vim|\/vim\.js/.test(r.url())) vimFetches.push(r.url())
  })
  await vimAtLoad(page, false)
  await bootApp(page)
  // Off: no bar, and Vim's code has not been fetched.
  await expect(bars(page)).toHaveCount(0)
  expect(vimFetches).toEqual([])

  await flipVimInView(page, true)
  await expect(bars(page)).toHaveCount(1)
  expect(vimFetches.length).toBeGreaterThan(0)

  await clickCode(page)
  await seed(page)
  await expect(modeOf(page)).toHaveText('-- NORMAL --')

  // normal mode: motions and an edit
  await page.keyboard.type('w')
  expect((await focused(page))?.column).toBe(5) // to the ":" after "kick"
  await page.keyboard.type('j')
  expect((await focused(page))?.line).toBe(2)
  // the keys typed so far show on the right of the bar
  await page.keyboard.type('2')
  await expect(bars(page).first().locator('[data-vim-keys]')).toHaveText('2')
  await page.keyboard.type('x')
  await expect(bars(page).first().locator('[data-vim-keys]')).toHaveText('')
  expect((await focused(page))?.text.split('\n')[1]).toBe('hatss("hh*8")')
  await page.keyboard.type('u')
  expect((await focused(page))?.text).toBe(TEXT)
  await page.screenshot({ path: test.info().outputPath('normal.png') })

  // insert mode
  await page.keyboard.type('0i')
  await expect(modeOf(page)).toHaveText('-- INSERT --')
  await page.keyboard.type('xx')
  await page.screenshot({ path: test.info().outputPath('insert.png') })
  await page.keyboard.press('Escape')
  await expect(modeOf(page)).toHaveText('-- NORMAL --')
  expect((await focused(page))?.text.split('\n')[1]).toBe('xxhats: s("hh*8")')
  await page.keyboard.type('u')
  expect((await focused(page))?.text).toBe(TEXT)

  // visual mode, visual line mode, and a yank put back with p
  await page.keyboard.type('v')
  await expect(modeOf(page)).toHaveText('-- VISUAL --')
  await page.keyboard.press('Escape')
  await page.keyboard.type('V')
  await expect(modeOf(page)).toHaveText('-- VISUAL LINE --')
  await page.keyboard.type('y')
  await expect(modeOf(page)).toHaveText('-- NORMAL --')
  await page.keyboard.type('p')
  expect((await focused(page))?.text.split('\n')).toEqual([
    'kick: s("bd*4")',
    'hats: s("hh*8")',
    'hats: s("hh*8")',
    'bass: note("c2").s("sawtooth")',
  ])
  await page.keyboard.type('u')

  // `:` opens in this editor's bar; Enter runs it
  await page.keyboard.type(':')
  const input = bars(page).first().locator('[data-vim-input]')
  await expect(input).toBeFocused()
  await expect(modeOf(page)).toBeHidden()
  await page.keyboard.type('%s/hh/oh/g')
  await page.screenshot({ path: test.info().outputPath('command-line.png') })
  await page.keyboard.press('Enter')
  await expect(input).toHaveCount(0)
  await expect(modeOf(page)).toHaveText('-- NORMAL --')
  expect((await focused(page))?.text).toBe(TEXT.replace('hh', 'oh'))

  // Esc closes the : line without running it
  await page.keyboard.type(':')
  await page.keyboard.type('%s/oh/hh/g')
  await page.keyboard.press('Escape')
  await expect(input).toHaveCount(0)
  expect((await focused(page))?.text).toBe(TEXT.replace('hh', 'oh'))

  // :w and :wa say Stave saves as you type, and change nothing (the tab stays open)
  for (const cmd of ['w', 'wa', 'wall']) {
    await page.keyboard.type(`:${cmd}`)
    await page.keyboard.press('Enter')
    await expect(bars(page).first().locator('[data-vim-message]')).toHaveText('Stave saves as you type')
  }
  await page.screenshot({ path: test.info().outputPath('write-message.png') })
  expect((await focused(page))?.text).toBe(TEXT.replace('hh', 'oh'))
  // the message goes after a few seconds
  await expect(bars(page).first().locator('[data-vim-message]')).toHaveText('', { timeout: 8_000 })
})

test('Play and Stop work from normal mode and from insert mode', async ({ page }) => {
  test.setTimeout(120_000)
  await vimAtLoad(page, true)
  await bootApp(page)
  await expect(bars(page)).toHaveCount(1)
  await clickCode(page)
  await seed(page, 'note("c3 e3 g3").s("sine")')
  await expect(modeOf(page)).toHaveText('-- NORMAL --')

  await page.keyboard.press(`${MOD}+Enter`)
  await expect.poll(() => isPlaying(page), { timeout: 15_000 }).toBe(true)
  await page.keyboard.press(`${MOD}+.`)
  await expect.poll(() => isPlaying(page), { timeout: 15_000 }).toBe(false)

  await page.keyboard.type('A')
  await expect(modeOf(page)).toHaveText('-- INSERT --')
  await page.keyboard.press(`${MOD}+Enter`)
  await expect.poll(() => isPlaying(page), { timeout: 15_000 }).toBe(true)
  await page.keyboard.press(`${MOD}+.`)
  await expect.poll(() => isPlaying(page), { timeout: 15_000 }).toBe(false)
  // still in insert mode, and neither key typed anything
  await expect(modeOf(page)).toHaveText('-- INSERT --')
  expect((await focused(page))?.text).toBe('note("c3 e3 g3").s("sine")')
})

test('two panes side by side each have their own bar, and : opens in the one typed in', async ({ page }) => {
  test.setTimeout(120_000)
  await vimAtLoad(page, true)
  await bootApp(page)
  // split right (a new, empty pane), then open a sketch in it
  await page.locator('[data-testid^="group-split-"]:not([data-testid^="group-split-down-"])').first().click()
  await expect(page.locator('[data-workspace-group]')).toHaveCount(2)
  await page.locator('[data-workspace-group]').nth(1).click({ position: { x: 40, y: 200 } })
  await page.locator('[data-sidebar]').getByText('spiral.p5', { exact: true }).click()
  await expect(page.locator('[data-workspace-view="editor"]')).toHaveCount(2)
  await expect(bars(page)).toHaveCount(2)
  // each bar sits inside its own editor
  for (let i = 0; i < 2; i++) {
    await expect(page.locator('[data-workspace-view="editor"]').nth(i).locator('[data-vim-bar]')).toHaveCount(1)
  }
  await clickCode(page, 1)
  await page.keyboard.type('i')
  const second = page.locator('[data-workspace-view="editor"]').nth(1)
  const first = page.locator('[data-workspace-view="editor"]').nth(0)
  await expect(second.locator('[data-vim-mode]')).toHaveText('-- INSERT --')
  await expect(first.locator('[data-vim-mode]')).toHaveText('-- NORMAL --')
  await page.keyboard.press('Escape')
  await page.keyboard.type(':')
  await expect(second.locator('[data-vim-input]')).toBeFocused()
  await expect(first.locator('[data-vim-input]')).toHaveCount(0)
  await page.keyboard.type('noh')
  await page.screenshot({ path: test.info().outputPath('two-panes.png') })
  await page.keyboard.press('Escape')
})

test(':q closes only the tab of the pane it was typed in; :wq too; :qa closes every code tab', async ({ page }) => {
  test.setTimeout(150_000)
  await vimAtLoad(page, true)
  await bootApp(page)
  const editors = page.locator('[data-workspace-view="editor"]')
  // two panes: the song on the left, a sketch on the right
  await page.locator('[data-testid^="group-split-"]:not([data-testid^="group-split-down-"])').first().click()
  await expect(page.locator('[data-workspace-group]')).toHaveCount(2)
  await page.locator('[data-workspace-group]').nth(1).click({ position: { x: 40, y: 200 } })
  await page.locator('[data-sidebar]').getByText('spiral.p5', { exact: true }).click()
  await expect(editors).toHaveCount(2)
  const fileOf = (i: number) => editors.nth(i).getAttribute('data-file-id')
  const left = await fileOf(0)
  const right = await fileOf(1)

  // :q in the right pane closes the sketch's tab, and the song stays
  await clickCode(page, 1)
  await page.keyboard.type(':q')
  await page.keyboard.press('Enter')
  await expect(page.locator(`[data-workspace-view="editor"][data-file-id="${right}"]`)).toHaveCount(0)
  await expect(page.locator(`[data-workspace-view="editor"][data-file-id="${left}"]`)).toHaveCount(1)
  // no message: closing is all it does
  await expect(page.locator('[data-vim-message]').filter({ hasText: 'Stave saves as you type' })).toHaveCount(0)

  // :wq closes this tab too (opened in the one pane left; closing it shows the tab
  // beside it, as closing it with its × does)
  await page.locator('[data-sidebar]').getByText('spiral.p5', { exact: true }).click()
  await expect(page.locator(`[data-workspace-view="editor"][data-file-id="${right}"]`)).toHaveCount(1)
  await page.locator(`[data-workspace-view="editor"][data-file-id="${right}"] .monaco-editor .view-lines`).click()
  await page.keyboard.type(':wq')
  await page.keyboard.press('Enter')
  await expect(page.locator(`[data-workspace-view="editor"][data-file-id="${right}"]`)).toHaveCount(0)
  await expect(editors).toHaveCount(1)
  await page.locator('[data-sidebar]').getByText('pattern.strudel', { exact: true }).click()
  await expect(page.locator(`[data-workspace-view="editor"][data-file-id="${left}"]`)).toHaveCount(1)

  // two panes again, then :qa closes every code tab in both
  await page.locator('[data-testid^="group-split-"]:not([data-testid^="group-split-down-"])').first().click()
  await page.locator('[data-workspace-group]').last().click({ position: { x: 40, y: 200 } })
  await page.locator('[data-sidebar]').getByText('spiral.p5', { exact: true }).click()
  await expect(editors).toHaveCount(2)
  await clickCode(page, 0)
  await page.keyboard.type(':qa')
  await page.keyboard.press('Enter')
  await expect(editors).toHaveCount(0)
  // the workspace is still there to open a file in again
  await expect(page.locator('[data-workspace-group]').first()).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('after-qa.png') })
})

test('Esc in the code is Vim’s first: leaving insert or visual mode, or the : line, does nothing else', async ({ page }) => {
  // The Esc audit (#2148): no Stave handler takes Escape before the code editor does, so
  // Vim sees every Esc. One handler that runs after it is zen mode's (leave zen on Esc);
  // it must hear only an Esc Vim had no use for.
  test.setTimeout(120_000)
  await vimAtLoad(page, true)
  await bootApp(page)
  const inZen = async () => (await page.locator('[data-activity-bar]').count()) === 0
  await clickCode(page)
  await seed(page)
  await page.keyboard.press(`${MOD}+Alt+z`)
  await expect.poll(inZen).toBe(true)

  for (const [into, mode] of [
    ['i', '-- INSERT --'],
    ['v', '-- VISUAL --'],
  ] as const) {
    await page.keyboard.type(into)
    await expect(modeOf(page)).toHaveText(mode)
    await page.keyboard.press('Escape')
    await expect(modeOf(page)).toHaveText('-- NORMAL --')
    await page.waitForTimeout(300)
    expect(await inZen(), `Esc out of ${mode} must not also leave zen mode`).toBe(true)
  }
  await page.keyboard.type(':')
  await expect(bars(page).first().locator('[data-vim-input]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(bars(page).first().locator('[data-vim-input]')).toHaveCount(0)
  await page.waitForTimeout(300)
  expect(await inZen(), 'Esc closing the : line must not also leave zen mode').toBe(true)

  // An Esc that cancels a half-typed command (an operator, a count, a register) is Vim's
  // alone too (#2557): it cancels, and zen mode stays.
  for (const half of ['d', '2', '"a', 'c2']) {
    await page.keyboard.type(half)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    expect(await inZen(), `Esc cancelling "${half}" must not also leave zen mode`).toBe(true)
  }
  // … and it did cancel: the next keys are a fresh command (`w` moves, nothing is deleted)
  const text = (await focused(page))?.text
  await page.keyboard.type('d')
  await page.keyboard.press('Escape')
  await page.keyboard.type('w')
  expect((await focused(page))?.text).toBe(text)

  // In normal mode with nothing to cancel, Esc is Stave's as before: zen mode ends.
  await page.keyboard.press('Escape')
  await expect.poll(inZen).toBe(false)
})

test('one insert is one undo step, as in Vim; two inserts are two', async ({ page }) => {
  // #2557: Monaco closes an undo step between a word and a space, before Enter and before
  // Backspace. In Vim, everything typed between entering insert mode and Esc is one change.
  test.setTimeout(120_000)
  await vimAtLoad(page, true)
  await bootApp(page)
  await clickCode(page)
  await seed(page)
  await expect(modeOf(page)).toHaveText('-- NORMAL --')
  const text = async () => (await focused(page))?.text

  // i … Esc, with words, spaces, Enter and Backspace in it: one u undoes all of it
  await page.keyboard.type('i')
  await expect(modeOf(page)).toHaveText('-- INSERT --')
  await page.keyboard.type('one two  three')
  await page.keyboard.press('Enter')
  await page.keyboard.type('four')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('r five // six')
  await page.keyboard.press('Escape')
  await expect(modeOf(page)).toHaveText('-- NORMAL --')
  const typed = await text()
  expect(typed).toBe(`one two  three\nfour five // six${TEXT}`)
  await page.keyboard.type('u')
  expect(await text()).toBe(TEXT)
  // and Ctrl+R puts all of it back, in one step
  await page.keyboard.press('Control+r')
  expect(await text()).toBe(typed)
  await page.keyboard.type('u')
  expect(await text()).toBe(TEXT)

  // a command that edits and then inserts (cw, o) is one change with what is typed after it
  await seed(page)
  await page.keyboard.type('cw')
  await expect(modeOf(page)).toHaveText('-- INSERT --')
  await page.keyboard.type('snare drum')
  await page.keyboard.press('Escape')
  expect((await text())?.split('\n')[0]).toBe('snare drum: s("bd*4")')
  await page.keyboard.type('u')
  expect(await text()).toBe(TEXT)
  await page.keyboard.type('o')
  await page.keyboard.type('lead: note("e4 g4")')
  await page.keyboard.press('Escape')
  expect((await text())?.split('\n')).toHaveLength(4)
  await page.keyboard.type('u')
  expect(await text()).toBe(TEXT)

  // two inserts are two changes: u undoes only the second
  await page.keyboard.type('gg0ifirst ')
  await page.keyboard.press('Escape')
  const afterFirst = await text()
  await page.keyboard.type('Asecond one')
  await page.keyboard.press('Escape')
  await page.keyboard.type('u')
  expect(await text()).toBe(afterFirst)
  await page.keyboard.type('u')
  expect(await text()).toBe(TEXT)
})

test('Esc with the suggestion list open closes the list first and stays in insert mode', async ({ page }) => {
  // #2557: as in VS Code's Vim, and as Esc does with Vim off.
  test.setTimeout(120_000)
  await vimAtLoad(page, true)
  await bootApp(page)
  await clickCode(page)
  await seed(page)
  await page.keyboard.type('o')
  await expect(modeOf(page)).toHaveText('-- INSERT --')
  await page.keyboard.type('n')
  await page.keyboard.press('Control+Space')
  const list = page.locator('[data-workspace-view="editor"] .monaco-editor .suggest-widget.visible')
  await expect(list).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('suggest-open.png') })

  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  await expect(modeOf(page)).toHaveText('-- INSERT --')
  // nothing was typed or taken by that Esc
  expect((await focused(page))?.text.split('\n')[1]).toBe('n')
  await page.screenshot({ path: test.info().outputPath('suggest-closed-still-insert.png') })

  // with the list shut, Esc leaves insert mode as always
  await page.keyboard.press('Escape')
  await expect(modeOf(page)).toHaveText('-- NORMAL --')
})

test('history: motions, search and yank work, edits are refused; the diff has no Vim', async ({ page }) => {
  test.setTimeout(150_000)
  await vimAtLoad(page, true)
  await bootApp(page, { e2eHooks: true })
  await clickCode(page)
  await seed(page)
  // commit it, so there is a past version to look at
  await page.locator('[data-activity-bar] [aria-label="Version History"]').click()
  await expect(page.locator('[data-history-commit-list]')).toBeVisible()
  await page.locator('[data-history-commit-now]').click()
  await page.locator('[data-history-commit-label]').fill('for vim')
  await page.locator('[data-history-commit-save]').click()
  const commit = page.locator('[data-history-commit]').first()
  await expect(commit).toBeVisible()
  const commitId = (await commit.getAttribute('data-history-commit'))!
  const fileId = (await page.locator('[data-workspace-view="editor"]').first().getAttribute('data-file-id'))!

  const PAST_VERSION = 'This is a past version, so it can’t be changed here'

  /**
   * In a read-only editor with Vim: moving, search and yank work; nothing changes the text.
   * The first edit tried (`firstEdit`) says why nothing happened (#2557).
   */
  async function readOnlyChecks(root: ReturnType<Page['locator']>, shot: string, firstEdit: string): Promise<void> {
    await expect(root.locator('[data-vim-bar]')).toHaveCount(1)
    await expect(root.locator('[data-vim-readonly-note]')).toHaveText('read-only')
    await root.locator('.monaco-editor .view-lines').click()
    await page.keyboard.type('gg0')
    const start = await focused(page)
    expect(start?.line).toBe(1)
    // motions
    await page.keyboard.type('jw')
    expect(await focused(page)).toMatchObject({ line: 2, column: 5 })
    // search
    await page.keyboard.type('/sawtooth')
    await page.keyboard.press('Enter')
    expect((await focused(page))?.line).toBe(3)
    // yank: no error, no message, and a put is refused like every edit
    await page.keyboard.type('yy')
    await expect(root.locator('[data-vim-message][data-vim-error]')).toHaveCount(0)
    await expect(root.locator('[data-vim-message]')).toHaveText('')
    // the first edit says why nothing happens
    await page.keyboard.type(firstEdit)
    await expect(root.locator('[data-vim-message]')).toHaveText(PAST_VERSION)
    await expect(root.locator('[data-vim-mode]')).toHaveText('-- NORMAL --')
    await page.screenshot({ path: test.info().outputPath(`readonly-message-${firstEdit}.png`) })
    // edits: x, dd, p, >>, undo, insert mode, :s — the text stays as it was
    await page.keyboard.type('xddp>>uu')
    await page.keyboard.type('i')
    await expect(root.locator('[data-vim-mode]')).toHaveText('-- NORMAL --')
    await page.keyboard.type('zz')
    await page.keyboard.type(':%s/bd/sd/g')
    await page.keyboard.press('Enter')
    expect((await focused(page))?.text).toBe(start?.text)
    await page.screenshot({ path: test.info().outputPath(shot) })
  }

  // 1. a commit checked out: the code editor shows it read-only
  await page.locator(`[data-history-checkout-btn="${commitId}"]`).click()
  await expect(page.locator('[data-editor-timetravel-banner]')).toBeVisible()
  await readOnlyChecks(page.locator('[data-workspace-view="editor"]').first(), 'history-checkout.png', 'x')
  await page.locator('[data-editor-timetravel-exit]').click()
  await expect(page.locator('[data-editor-timetravel-banner]')).toHaveCount(0)

  // 2. the history view tab
  await page.evaluate(
    ([c, f]) => (window as unknown as { __staveOpenHistoryTab: (r: object) => void }).__staveOpenHistoryTab({ mode: 'view', commitId: c, fileId: f }),
    [commitId, fileId] as const,
  )
  const view = page.locator(`[data-history-view-overlay="${commitId}"]`)
  await expect(view).toBeVisible()
  await readOnlyChecks(view, 'history-view.png', 'i')
  // :q in the history view closes that history tab, and nothing else
  await view.locator('.monaco-editor .view-lines').click()
  await page.keyboard.type(':q')
  await page.keyboard.press('Enter')
  await expect(view).toHaveCount(0)
  // only that tab: a code editor tab shows in its place, and the song's tab is still open
  await expect(page.locator('[data-workspace-view="editor"]')).toHaveCount(1)
  await expect(page.locator('[data-workspace-group]').getByText('pattern.strudel', { exact: true })).toBeVisible()

  // 3. the diff: no Vim
  await commit.locator('[data-history-commit-toggle]').click()
  await commit.locator('[data-history-file-diff]').first().click()
  const diff = page.locator('[data-history-diff-overlay]')
  await expect(diff.locator('.monaco-diff-editor')).toBeVisible()
  await expect(diff.locator('[data-vim-bar]')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('history-diff.png') })
})

test.describe('off a Mac, where Vim’s Ctrl keys are Stave’s Ctrl keys', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  })

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32', configurable: true })
    })
  })

  const sidePanel = (page: Page) => page.locator('[data-side-panel]')
  const quickOpen = (page: Page) => page.locator('input[placeholder="Search files by name..."]')

  async function handBack(page: Page, key: string, back: boolean | null): Promise<void> {
    await page.evaluate(
      ([k, b]) => {
        const raw = window.localStorage.getItem('stave:extension-keys')
        const all = raw ? JSON.parse(raw) : {}
        const own = { ...(all.vim ?? {}) }
        if (b === null) delete own[k as string]
        else own[k as string] = b
        all.vim = own
        window.localStorage.setItem('stave:extension-keys', JSON.stringify(all))
      },
      [key, back] as const,
    )
  }

  test('Ctrl+[ and Ctrl+C leave insert mode; u and Ctrl+R undo and redo one whole insert; Esc after d stays with Vim', async ({ page }) => {
    // #2557, the emulated part of the Windows/Linux check: the Ctrl keys that are Stave's
    // or the browser's off a Mac (Ctrl+R reloads, Ctrl+C copies) are Vim's in the code.
    test.setTimeout(120_000)
    await vimAtLoad(page, true)
    await bootApp(page)
    await page.evaluate(() => ((window as unknown as { __stayed: boolean }).__stayed = true))
    await clickCode(page)
    await seed(page)
    await expect(modeOf(page)).toHaveText('-- NORMAL --')
    for (const out of ['Control+BracketLeft', 'Control+c']) {
      await page.keyboard.type('i')
      await expect(modeOf(page)).toHaveText('-- INSERT --')
      await page.keyboard.press(out)
      await expect(modeOf(page), `${out} leaves insert mode`).toHaveText('-- NORMAL --')
    }
    await page.keyboard.type('Ahello there')
    await page.keyboard.press('Enter')
    await page.keyboard.type('more')
    await page.keyboard.press('Control+c')
    await expect(modeOf(page)).toHaveText('-- NORMAL --')
    const typed = (await focused(page))?.text
    expect(typed).toBe(TEXT.replace('\n', 'hello there\nmore\n'))
    await page.keyboard.type('u')
    expect((await focused(page))?.text).toBe(TEXT)
    await page.keyboard.press('Control+r')
    expect((await focused(page))?.text).toBe(typed)
    // d then Esc: cancelled, and the Esc is Vim's (nothing else hears it)
    const heard: string[] = []
    await page.exposeFunction('__heardEsc', (k: string) => heard.push(k))
    await page.evaluate(() =>
      window.addEventListener('keydown', (e) => e.key === 'Escape' && (window as unknown as { __heardEsc: (k: string) => void }).__heardEsc('esc')),
    )
    await page.keyboard.type('d')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect.poll(() => heard.length).toBe(1) // only the second, with nothing to cancel
    expect(await page.evaluate(() => (window as unknown as { __stayed?: boolean }).__stayed)).toBe(true)
  })

  test('handing a key back makes it run the Stave command again; switched off, every key is as before', async ({ page }) => {
    test.setTimeout(150_000)
    // the person's own shortcut, which nothing here may touch
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        window.localStorage.setItem('stave:keybindings', JSON.stringify({ 'stave.view.splitRight': 'mod+alt+\\' }))
        sessionStorage.setItem('seeded', '1')
      }
    })
    await vimAtLoad(page, true)
    await bootApp(page)
    const shortcuts = () => page.evaluate(() => window.localStorage.getItem('stave:keybindings'))
    const before = await shortcuts()
    expect(before).toBe(JSON.stringify({ 'stave.view.splitRight': 'mod+alt+\\' }))
    await expect(sidePanel(page)).toHaveCount(1)
    await clickCode(page)
    await seed(page)
    await expect(modeOf(page)).toHaveText('-- NORMAL --')

    // Ctrl+B is Vim's (a page up): the sidebar stays
    await page.keyboard.press('Control+b')
    await page.waitForTimeout(300)
    await expect(sidePanel(page)).toHaveCount(1)

    // handed back: Ctrl+B is Toggle Sidebar again, and Vim leaves it alone
    await handBack(page, 'ctrl+b', true)
    await page.keyboard.press('Control+b')
    await expect(sidePanel(page)).toHaveCount(0)
    await page.keyboard.press('Control+b')
    await expect(sidePanel(page)).toHaveCount(1)
    await clickCode(page)
    await seed(page)

    // Ctrl+P is handed back by default: quick open, and Vim does not move the cursor
    await page.keyboard.type('j')
    expect((await focused(page))?.line).toBe(2)
    await page.keyboard.press('Control+p')
    await expect(quickOpen(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(quickOpen(page)).toHaveCount(0)
    await clickCode(page)
    await seed(page)
    await page.keyboard.type('j')
    // given to Vim, Ctrl+P is Vim's "up a line" and quick open stays shut
    await handBack(page, 'ctrl+p', false)
    const line = (await focused(page))!.line
    await page.keyboard.press('Control+p')
    await page.waitForTimeout(300)
    await expect(quickOpen(page)).toHaveCount(0)
    expect((await focused(page))?.line).toBe(line - 1)
    await handBack(page, 'ctrl+p', null)

    // Stave's other keys are never Vim's: the command palette …
    await page.keyboard.press('Control+Shift+p')
    const palette = page.locator('input[placeholder="Type a command..."]')
    await expect(palette).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)
    await clickCode(page)
    await seed(page)
    // … and Ctrl+Z undoes an edit Vim made
    await page.keyboard.type('x')
    expect((await focused(page))?.text).toBe(TEXT.slice(1))
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await focused(page))?.text).toBe(TEXT)

    // Play is Ctrl+Enter here, handed back: it plays from normal and insert mode
    await page.keyboard.press('Control+Enter')
    await expect.poll(() => isPlaying(page), { timeout: 15_000 }).toBe(true)
    await page.keyboard.press('Control+.')
    await expect.poll(() => isPlaying(page), { timeout: 15_000 }).toBe(false)

    // Switched off: no bar, no taken keys (Ctrl+B is Toggle Sidebar, Ctrl+P quick open,
    // with the handed-back setting cleared), and the editor as before.
    await handBack(page, 'ctrl+b', null)
    await flipVimInView(page, false)
    await expect(bars(page)).toHaveCount(0)
    await clickCode(page)
    await page.keyboard.press('Control+b')
    await expect(sidePanel(page)).toHaveCount(0)
    await page.keyboard.press('Control+b')
    await expect(sidePanel(page)).toHaveCount(1)
    expect(await shortcuts()).toBe(before)
  })
})

test('switched off: no bar, the editor exactly as before, and the person’s shortcuts untouched', async ({ page }) => {
  test.setTimeout(120_000)
  await vimAtLoad(page, false)
  await bootApp(page)
  const state = () =>
    page.evaluate(() => {
      const eds = (window as unknown as MonacoWindow).monaco?.editor?.getEditors?.() ?? []
      const ed = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
      // what the editor does with its cursor (Monaco's resolved options, not what was set)
      const opt = (window as unknown as { monaco: { editor: { EditorOption: Record<string, number> } } }).monaco.editor.EditorOption
      const get = (k: string) => (ed as unknown as { getOption(o: number): unknown }).getOption(opt[k])
      const bar = document.querySelector('[data-workspace-view="editor"] [data-editor-bar]')
      // the editor's own context keys (Monaco's scoped context for this editor), #2557
      const svc = (ed as unknown as { _contextKeyService: { _myContextId: number; getContextValuesContainer(id: number): { _value: Record<string, unknown> } } })._contextKeyService
      const own = svc.getContextValuesContainer(svc._myContextId)._value
      return {
        contextKeys: Object.fromEntries(Object.keys(own).sort().map((k) => [k, own[k]])),
        cursorStyle: get('cursorStyle'),
        cursorBlinking: get('cursorBlinking'),
        cursorWidth: get('cursorWidth'),
        barChildren: bar?.childElementCount ?? -1,
        barHeight: (bar as HTMLElement | null)?.offsetHeight ?? -1,
        shortcuts: window.localStorage.getItem('stave:keybindings'),
      }
    })
  // Monaco makes some of an editor's context keys lazily, when the page is first idle (the
  // suggestion list's, for one), so "before" is read once the editor's keys have settled.
  let before = await state()
  await expect
    .poll(async () => {
      await page.waitForTimeout(750)
      const now = await state()
      const same = JSON.stringify(now) === JSON.stringify(before)
      before = now
      return same
    }, { timeout: 20_000 })
    .toBe(true)
  expect(before.barChildren).toBe(0)
  expect(before.barHeight).toBe(0)

  await flipVimInView(page, true)
  await expect(bars(page)).toHaveCount(1)
  const on = await state()
  // Vim's block cursor, solid (Monaco's numbers for 'block' and 'solid')
  expect(on.cursorStyle).not.toBe(before.cursorStyle)
  expect(on.cursorBlinking).not.toBe(before.cursorBlinking)
  expect(on.shortcuts).toBe(before.shortcuts)
  // monaco-vim's own context key is on the editor while Vim is
  expect(on.contextKeys).toHaveProperty('insertMode')
  expect(before.contextKeys).not.toHaveProperty('insertMode')

  await flipVimInView(page, false)
  await expect(bars(page)).toHaveCount(0)
  expect(await state()).toEqual(before)
  // switching Vim off from the view leaves the keyboard in the view: nothing pulls it into
  // a code editor (nothing here clicked into the code first, which would hide that)
  await page.waitForTimeout(300)
  const focusIn = await page.evaluate(() => ({
    inCode: !!document.activeElement?.closest('.monaco-editor'),
    inView: !!document.activeElement?.closest('[data-extensions-panel]'),
  }))
  expect(focusIn.inCode).toBe(false)

  // typing types again
  await clickCode(page)
  await seed(page, 'x')
  await page.keyboard.press('End')
  await page.keyboard.type('ij')
  expect((await focused(page))?.text).toBe('xij')
})
