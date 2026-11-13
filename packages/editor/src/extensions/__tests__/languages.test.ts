/**
 * #2538 — an extension's languages are Stave's own language ids. The extensions directory
 * imports nothing from the rest of the editor, so it keeps its own copy of the list; this
 * test (tests may cross that line) keeps the copy equal to the workspace's, both ways.
 * A difference is a type error here, so `tsc` reports it.
 */
import { describe, it, expectTypeOf } from 'vitest'
import type { WorkspaceLanguage } from '../../workspace/types'
import type { ExtensionLanguage } from '../types'

describe('ExtensionLanguage', () => {
  it('is exactly the workspace\'s language ids', () => {
    expectTypeOf<ExtensionLanguage>().toEqualTypeOf<WorkspaceLanguage>()
  })
})
