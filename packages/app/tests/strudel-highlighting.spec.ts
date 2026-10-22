// #849 — structural Strudel syntax highlighting: every call is colored by
// SHAPE (not from a fixed vocabulary), so controls absent from the curated
// docs index still highlight, while comments/keywords keep priority.
import { test, expect, type Page } from '@playwright/test'

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 15_000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
      return (m?.editor?.getEditors?.()?.length ?? 0) > 0
    },
    { timeout: 15_000 },
  )
}

async function setStrudelCode(page: Page, code: string): Promise<void> {
  const ok = await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null
      focus: () => void
    }>
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    if (!target) return false
    target.getModel()?.setValue(c)
    target.focus()
    return true
  }, code)
  expect(ok).toBe(true)
  await page.waitForTimeout(300)
}

// Read the ACTUAL Monarch token types the editor assigns, keyed by token text.
async function tokenTypes(page: Page, code: string): Promise<Array<{ text: string; type: string }>> {
  return page.evaluate((src) => {
    const monaco = (window as unknown as { monaco: { editor: { tokenize: (t: string, l: string) => Array<Array<{ offset: number; type: string }>> } } }).monaco
    const lines = src.split('\n')
    const out: Array<{ text: string; type: string }> = []
    monaco.editor.tokenize(src, 'strudel').forEach((lineTokens, i) => {
      const line = lines[i] ?? ''
      lineTokens.forEach((t, j) => {
        const end = j + 1 < lineTokens.length ? lineTokens[j + 1].offset : line.length
        out.push({ text: line.slice(t.offset, end), type: t.type })
      })
    })
    return out
  }, code)
}

test('colors controls absent from the docs vocab, keeps comments/mini intact', async ({ page }) => {
  await boot(page)
  const code = [
    '$: s("bd*2 hh").crush(4).size(0.8).lpf(800)',
    '  .coarse(2).delaytime(0.25)',
    'note("c3 e3 g3") // gain(0.5) in a comment',
  ].join('\n')
  await setStrudelCode(page, code)
  const tokens = await tokenTypes(page, code)
  const typeOf = (text: string): string | undefined => tokens.find((t) => t.text === text)?.type

  // Controls NOT in the 57-entry docs vocab must still be colored as functions.
  for (const ctrl of ['crush', 'size', 'coarse', 'delaytime']) {
    expect(typeOf(ctrl), `${ctrl} should be strudel.function`).toContain('strudel.function')
  }
  // Bare calls too.
  expect(typeOf('s')).toContain('strudel.function')
  expect(typeOf('note')).toContain('strudel.function')
  // Mini-notation inside strings is unaffected.
  expect(typeOf('bd')).toContain('strudel.mini.note')
  // Comments keep priority: `gain(` inside a comment is NOT a function.
  expect(tokens.find((t) => t.text.includes('gain'))?.type).toContain('comment')
})

test('mini-notation: every element colored, sample index, and backtick strings (#851)', async ({ page }) => {
  await boot(page)
  const code = [
    'note("c3 e3 g3")',   // #851: e3/g3 were swallowed by the greedy fallback
    's("bd:3 hh*2")',      // #851: `:` sample index is an operator
    'note(`a3 c4 e4`)',    // #851: backtick strings tokenize as mini-notation
  ].join('\n')
  await setStrudelCode(page, code)
  const tokens = await tokenTypes(page, code)
  const typeOf = (text: string): string | undefined => tokens.find((t) => t.text === text)?.type

  // Every note element re-enters the note rule — not just the first.
  for (const n of ['c3', 'e3', 'g3']) {
    expect(typeOf(n), `${n} should be mini.note`).toContain('strudel.mini.note')
  }
  // Sample-index `:` is an operator; the index digit is a number.
  expect(typeOf(':')).toContain('strudel.mini.operator')
  // Backtick (template) strings now tokenize as mini-notation too.
  for (const n of ['a3', 'c4', 'e4']) {
    expect(typeOf(n), `backtick ${n} should be mini.note`).toContain('strudel.mini.note')
  }
})

test('JS syntax: keywords / identifiers / operators are distinct (#853)', async ({ page }) => {
  await boot(page)
  const code = [
    'let bpm = 120',
    'const melody = note("c3 e3").every(4, x => x.fast(2))',
  ].join('\n')
  await setStrudelCode(page, code)
  const tokens = await tokenTypes(page, code)
  const typeOf = (text: string): string | undefined => tokens.find((t) => t.text === text)?.type

  // Keywords (borrowed from Monaco's list) color as keyword…
  expect(typeOf('let')).toContain('keyword')
  expect(typeOf('const')).toContain('keyword')
  // …distinct from plain variables, which are identifiers.
  expect(typeOf('bpm')).toContain('identifier')
  expect(typeOf('melody')).toContain('identifier')
  expect(typeOf('x')).toContain('identifier')
  // Operators get the operator color (`=`, `=>`).
  expect(typeOf('=')).toContain('keyword.operator')
  expect(typeOf('=>')).toContain('keyword.operator')
  // Strudel functions still win over the identifier rule.
  expect(typeOf('note')).toContain('strudel.function')
  expect(typeOf('every')).toContain('strudel.function')
  expect(typeOf('fast')).toContain('strudel.function')
})

test('member access: .method( is a call, .property is not (#855)', async ({ page }) => {
  await boot(page)
  const code = 'note("c3").fast(2).currentTime'
  await setStrudelCode(page, code)
  const tokens = await tokenTypes(page, code)
  const typeOf = (text: string): string | undefined => tokens.find((t) => t.text === text)?.type

  // A called method stays a function…
  expect(typeOf('fast')).toContain('strudel.function')
  // …but a bare property access is NOT a function (plain identifier).
  expect(typeOf('currentTime')).toContain('identifier')
  expect(typeOf('currentTime')).not.toContain('strudel.function')
})

test('every tempo setter is coloured as tempo, not only setcps/setCps (#1954)', async ({ page }) => {
  await boot(page)
  // setcps is the control: it was coloured before the fix. `plain` is an ordinary identifier.
  const setters = ['setcps', 'setCps', 'setcpm', 'setCpm']
  const code = [...setters.map((s) => `${s}(1)`), 'const plain = 1'].join('\n')
  await setStrudelCode(page, code)

  const tokens = await tokenTypes(page, code)
  for (const s of setters) {
    expect(tokens.find((t) => t.text === s)?.type, `${s} token`).toContain('strudel.tempo')
  }

  // What the user sees: the rendered colour of each name, against the control and a plain word.
  const colour = (text: string) =>
    page.evaluate((t) => {
      const span = [...document.querySelectorAll('.monaco-editor .view-line span span')].find(
        (el) => el.textContent === t,
      )
      return span ? getComputedStyle(span).color : null
    }, text)
  const control = await colour('setcps')
  const plain = await colour('plain')
  expect(control, 'setcps is rendered').not.toBeNull()
  expect(control, 'the tempo colour differs from a plain identifier').not.toBe(plain)
  for (const s of setters) expect(await colour(s), `${s} colour`).toBe(control)
})
