/**
 * quietAdds.ts — files added without each opening a tab (#2288).
 *
 * The editor opens a tab for every file added to the project (`StrudelEditorClient`'s
 * file-list sync), which is right for a file you create. An import adds many files at
 * once and then opens the one it means you to see; one tab per imported file would bury
 * it. Files added inside `withoutAutoOpen` are not opened by that sync.
 *
 * Synchronous on purpose: the file list is announced when the struct batch's
 * transaction commits, which happens before `fn` returns.
 */
let depth = 0

export function withoutAutoOpen<T>(fn: () => T): T {
  depth++
  try {
    return fn()
  } finally {
    depth--
  }
}

/** true while files are being added that should not each open a tab */
export function addsAreQuiet(): boolean {
  return depth > 0
}
