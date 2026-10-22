import { startsNamedTrack, startsTopLevelBlockRaw } from '../visualizers/blockScan'
// the dependency-free leaf, not the entry: see boundary.exceptions.json (#1921)
import { LABEL_HEAD } from '../codeView/ir/trackId'

export interface VizLineRequest {
  vizId: string
  /** 1-indexed source line the zone anchors AFTER (the block's last line). */
  afterLine: number
  /** First 120 whitespace-normalized chars of the block — reorder detection. */
  contentHash: string
  options?: Record<string, unknown>
}

/**
 * Map each captured inline-viz request (`captureId → vizId`) to the source line
 * its zone anchors after. Pure function of (requests, code, vizOptions) —
 * extracted from `StrudelEngine.buildVizRequestsWithLines` so the `$:` / named
 * line-scan is unit-testable without a browser (#725).
 *
 * A top-level track is one of two forms, and BOTH key schemes must agree with
 * `StrudelEngine`'s `.p()` capture wrapper:
 *   - anonymous `$:` → keyed positionally `$0/$1/…` (capture rewrites `$`-ids)
 *   - named `label:` → keyed by the label name (`drums:` → `.p('drums')` → key
 *     `'drums'`); Strudel's transpiler turns `x: y` into `y.p('x')`.
 *
 * `anonIndex` advances for EVERY `$:` line (viz or not), matching the capture
 * side; named blocks never consume a `$N` slot. Object-literal props inside a
 * block are indented, so `startsNamedTrack` (column-0) never mistakes them for a
 * track — see its KNOWN LIMIT.
 */
export function scanVizRequestLines(
  requests: Map<string, string>,
  code: string,
  vizOptions?: Map<string, Record<string, unknown>>,
): Map<string, VizLineRequest> {
  const result = new Map<string, VizLineRequest>()
  const lines = code.split('\n')
  let anonIndex = 0

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const isAnon = raw.trim().startsWith('$:')
    // Named track: a column-0 labeled statement that isn't the anonymous form.
    // Any JS identifier (#1683): the key must equal the engine's `.p('節奏')`.
    const namedMatch = isAnon ? null : LABEL_HEAD.exec(raw)
    if (!isAnon && !namedMatch) continue

    const key = isAnon ? `$${anonIndex++}` : namedMatch![1]

    const vizId = requests.get(key)
    if (!vizId) continue

    // Last line of this block: forward to the next top-level block start
    // (anonymous / tempo setter / soloed OR another named track). Blank + comment
    // lines inside the block are allowed.
    let lastLineIdx = i
    for (let j = i + 1; j < lines.length; j++) {
      if (startsTopLevelBlockRaw(lines[j])) break
      const next = lines[j].trim()
      if (next !== '' && !next.startsWith('//')) lastLineIdx = j
    }

    const blockLines = lines
      .slice(i, lastLineIdx + 1)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    const contentHash = blockLines.slice(0, 120)

    const options = vizOptions?.get(key)
    result.set(key, {
      vizId,
      afterLine: lastLineIdx + 1,
      contentHash,
      ...(options ? { options } : {}),
    })
  }

  return result
}
