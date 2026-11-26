/**
 * #1476 PROBE — step 1: why does a `$:` chain spanning blank lines and
 * interleaved `//` lines parse to an EMPTY `Code`?
 *
 * Observation only. No assertions that could pass vacuously — every arm
 * PRINTS what it got.
 */
import { describe, it } from 'vitest'
import { parseStrudel } from '../parseStrudel'

function show(label: string, code: string): void {
  let out: unknown
  try {
    out = parseStrudel(code)
  } catch (e) {
    out = { THREW: String(e) }
  }
  // eslint-disable-next-line no-console
  console.log(`\n===== ${label} =====\n${code}\n----- IR -----\n${JSON.stringify(out, null, 1)}`)
}

describe('#1476 probe', () => {
  it('A. the corpus document, verbatim', () => {
    show('A verbatim', `$: note("[C G], <D Fb B C A>*[0.5,2]")
  .sound("sawtooth").cpm(30).gain(.4)
  .room(1)
.roomsize("10")

  // $: note("F")
  //   .sound("piano").cpm(30)
  //  .lpf(800)

.slow(".1275").gain(.8)`)
  })

  it('B. same, but the comment carries no `$:`', () => {
    show('B no label in comment', `$: note("[C G]")
  .room(1)
.roomsize("10")

  // note("F")
  //   .sound("piano")

.slow(".1275").gain(.8)`)
  })

  it('C. minimal: blank line + one comment line + blank line between methods', () => {
    show('C minimal', `$: note("c")
.room(1)

  // hi

.slow(".5")`)
  })

  it('D. control: comment line with NO surrounding blank lines', () => {
    show('D no blanks', `$: note("c")
.room(1)
  // hi
.slow(".5")`)
  })

  it('E. control: blank lines but NO comment', () => {
    show('E blanks only', `$: note("c")
.room(1)

.slow(".5")`)
  })

  it('F. control: no blanks, no comment', () => {
    show('F plain', `$: note("c")
.room(1)
.slow(".5")`)
  })
})
