/**
 * PROBE (#1463, untracked): does a step-count change move an ARRANGED song's length?
 * `measureSongLength` answers from `songExtent` first when the document is arranged.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import { parseStrudel } from '../parseStrudel'
import { songExtent } from '../songExtent'

describe('#1463 extent probe', () => {
  it('measures', () => {
    const lines = ['<0.2 0.8>', '<0.2 0.8 0.5>', '<0.2 0.8 0.5 1>'].map((steps) => {
      const code = `arrange([4, s("bd").gain("${steps}")], [4, s("hh")])`
      return `X ${code} | songExtent ${JSON.stringify(songExtent(parseStrudel(code) as never))}`
    })
    lines.push(`X control loop | songExtent ${JSON.stringify(songExtent(parseStrudel('$: s("hh*4").gain("<0.2 0.8 0.5>")') as never))}`)
    fs.writeFileSync(process.env.PROBE_OUT ?? '/dev/stdout', lines.join('\n') + '\n')
  })
})
