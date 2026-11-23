/**
 * projectLibraries — where a sketch's renderer reads the project's
 * `stave.libs.json` text from (#2639).
 *
 * A port the host fills in: the studio registers a reader over its workspace
 * (the file at the project root named `stave.libs.json`); a host whose files
 * aren't in the workspace (the gallery's preview frame) registers its own.
 * With none registered, a project has no libraries.
 *
 * The text is read when a three.js renderer is made (makeThreeRenderer) and
 * travels with it: to the main-thread renderer as an argument, to the sketch
 * worker inside its mount message (`libs`).
 */

export type ProjectLibrariesSource = () => string | null

let source: ProjectLibrariesSource | null = null

/** Set where the libraries text comes from; `null` = no libraries. */
export function setProjectLibrariesSource(next: ProjectLibrariesSource | null): void {
  source = next
}

/** The current project's `stave.libs.json` text, or null when it has none. */
export function currentProjectLibrariesText(): string | null {
  try {
    return source?.() ?? null
  } catch {
    return null
  }
}
