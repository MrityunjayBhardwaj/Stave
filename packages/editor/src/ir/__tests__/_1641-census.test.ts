/** #1641 probe — how many archive documents use each region call. Inert (underscore). */
import { it } from 'vitest'
import { loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'
const CALLS = ['begin', 'end', 'speed', 'stretch', 'chop', 'slice', 'fit', 'loopAt', 'splice', 'striate']
// drop // comments but not :// inside strings: only a // at line start or after whitespace
const strip = (c: string) => c.split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')
it('census', async () => {
  const docs = await loadEveryCorpusDocument()
  const raw: Record<string, number> = {}, code: Record<string, number> = {}
  for (const k of CALLS) { raw[k] = 0; code[k] = 0 }
  for (const { code: src } of docs) for (const k of CALLS) {
    const re = new RegExp('\\.' + k + '\\s*\\(')
    if (re.test(src)) raw[k]++
    if (re.test(strip(src))) code[k]++
  }
  // control: a call that must be common, and a made-up one that must be 0
  const ctl = docs.filter((d) => /\.gain\s*\(/.test(d.code)).length, fake = docs.filter((d) => /\.zzqq\s*\(/.test(d.code)).length
  console.log('docs=' + docs.length + ' control .gain=' + ctl + ' control .zzqq=' + fake)
  for (const k of CALLS) console.log(k.padEnd(8), 'docs(raw)=' + raw[k], 'docs(comments stripped)=' + code[k])
}, 600000)
