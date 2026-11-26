import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
const j = (n: unknown) => JSON.stringify(n, (k, v) => (k === 'loc' ? undefined : v))
describe('#1548 block comments', () => {
  it('prints IR', () => {
    console.log('\nI arrange + /* commented arm */\n' + j(parseStrudel(`$: arrange(\n  [8, s("bd")],\n  [8, s("hh")],\n  /* [4, s("x")] */\n)`)))
    console.log('\nI2 arrange + /* commented arm */, NO trailing comma\n' + j(parseStrudel(`$: arrange(\n  [8, s("bd")],\n  [8, s("hh")]\n  /* [4, s("x")] */\n)`)))
    console.log('\nH stack + /* commented arg */\n' + j(parseStrudel(`$: stack(\n  s("bd"),\n  s("hh"),\n  /* s("x") */\n)`)))
    expect(true).toBe(true)
  })
})
