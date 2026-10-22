/**
 * #1648 — the file name each stem gets, from the SAME names the mixer strips and
 * the Song timeline show (`buildStripModels` → `StripModel.name`).
 *
 * The engine keys a stem by `captureId` (`d1`, `drums`, `$0`, …). `$0` means
 * nothing to someone opening a folder of WAVs, so the name is the strip's, joined
 * on the captureId the strip already carries for its meter. A stem the strips
 * cannot name (no matching strip) falls back to its id, and the song-level stem
 * has its own name.
 *
 * Names are made safe for a file system and unique; each file is numbered in
 * document order so a folder sorts the way the song reads.
 */
import { detectAllChunks } from '../../codeView'
import { buildStripModels } from '../../codeView'
import { SONG_LEVEL_STEM } from '../../engine/stemSplit'

/** What a song-level stem (sound `all(...)` adds that no track owns) is called. */
export const SONG_LEVEL_STEM_NAME = 'song-level'

function safe(name: string): string {
  const cleaned = name.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'track'
}

/**
 * #1666 — how many stems this document DECLARES, read from its text.
 *
 * The engine only knows its tracks once the document has been evaluated, and
 * the Bounce dialog is routinely opened before that ever happens — so a count
 * taken from the engine alone reads 0 for a thirteen-track song and the stems
 * ceiling does not apply. The source always knows: the same strips that give
 * each stem its name are one per track.
 *
 * 0 when the chunker cannot read the document, which the caller treats as "no
 * answer" rather than "no tracks".
 */
export function countStemTracks(code: string): number {
  try {
    return new Set(buildStripModels(detectAllChunks(code), code).map((s) => s.captureId)).size
  } catch {
    return 0
  }
}

/** `ids` in order → file names like `01-drums.wav`, unique within the set. */
export function stemFileNames(code: string, ids: readonly string[]): string[] {
  const byCapture = new Map<string, string>()
  try {
    for (const s of buildStripModels(detectAllChunks(code), code)) {
      if (!byCapture.has(s.captureId)) byCapture.set(s.captureId, s.name)
    }
  } catch {
    // A document the chunker cannot read still exports; its stems keep their ids.
  }
  const width = String(ids.length).length < 2 ? 2 : String(ids.length).length
  const used = new Set<string>()
  return ids.map((id, i) => {
    const base = safe(id === SONG_LEVEL_STEM ? SONG_LEVEL_STEM_NAME : (byCapture.get(id) ?? id))
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}-${n}`
    used.add(name.toLowerCase())
    return `${String(i + 1).padStart(width, '0')}-${name}.wav`
  })
}
