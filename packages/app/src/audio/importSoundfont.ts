/**
 * importSoundfont — bringing a `.sf2` in, the soundfont sibling of `saveTake`'s
 * `importAudioFiles` (#2662).
 *
 * A soundfont is "another way to get a sound into this project", so it rides the
 * same two gestures as audio (the picker and a drop onto the Library) through the
 * one import owner in `AddAudioButton`. This module is the soundfont half of that
 * owner: validate + register + persist each `.sf2`, independent of the audio path.
 *
 * Order matters: register FIRST (which parses the bytes — an unparseable file
 * throws here) and only then persist, so a bad file is never written to the store.
 *
 * `@stave/editor` is imported LAZILY inside the call, not at module scope — a
 * static import would be dragged into every app unit test that partially mocks
 * `@stave/editor`, hiding real exports behind the mock in a way tsc cannot see.
 */

/** A `.sf2` by extension. The byte sniff (`RIFF/sfbk`) is the parser's job. */
const SF2_RE = /\.sf2$/i

/** Whether a dropped/picked file should go down the soundfont path. */
export function isSoundfontFile(file: File): boolean {
  return SF2_RE.test(file.name)
}

/** One font that made it in. */
export interface SoundfontImported {
  /** The `sf_<name>` key it registered under, minus the prefix (the slug). */
  readonly name: string
  /** How many presets it exposes (selectable with `.n(i)`). */
  readonly presetCount: number
}

/** One font that did not. */
export interface SoundfontFailed {
  readonly filename: string
  readonly error: string
}

export interface SoundfontImportSummary {
  readonly added: readonly SoundfontImported[]
  readonly failed: readonly SoundfontFailed[]
}

/**
 * Register and persist each `.sf2` in `files`. Returns what made it in and what
 * did not — never throws for a single bad font; it is recorded in `failed` and
 * the rest still import.
 */
export async function importSoundfontFiles(
  files: readonly File[],
): Promise<SoundfontImportSummary> {
  const sf2s = files.filter(isSoundfontFile)
  if (sf2s.length === 0) return { added: [], failed: [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ed: any = await import('@stave/editor')
  const added: SoundfontImported[] = []
  const failed: SoundfontFailed[] = []

  for (const file of sf2s) {
    const base = file.name.replace(SF2_RE, '')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      // Register first — this parses the font and throws on a bad/empty one, so a
      // file that will not play is never persisted below.
      const { name, presetCount } = await ed.registerUserSoundfont(base, bytes)
      // Persist the valid bytes so #2661 re-registers it on the next boot.
      await ed.putSoundfont(name, bytes)
      added.push({ name, presetCount })
    } catch (e) {
      failed.push({ filename: file.name, error: String(e) })
    }
  }
  return { added, failed }
}

/** A short human line for the import toast. */
export function summarizeSoundfonts(summary: SoundfontImportSummary): string | null {
  const parts: string[] = []
  for (const f of summary.added) {
    parts.push(
      `Added soundfont “${f.name}” — ${f.presetCount} preset${f.presetCount === 1 ? '' : 's'}`,
    )
  }
  if (summary.failed.length === 1) {
    parts.push(`“${summary.failed[0].filename}” is not a valid .sf2`)
  } else if (summary.failed.length > 1) {
    parts.push(`${summary.failed.length} files were not valid .sf2 soundfonts`)
  }
  return parts.length ? parts.join(' · ') : null
}
