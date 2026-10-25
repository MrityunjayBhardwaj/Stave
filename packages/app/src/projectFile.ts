/**
 * What a Stave project file is called (#2231).
 *
 * The file is a zip with `stave.json` inside, named `.stave` so it reads as a
 * project and is not unzipped by the browser or the desktop on the way in.
 * Archives exported before #2231 end in `.zip` and still open; the bytes of
 * the two are the same.
 *
 * Stems are NOT project files: `<project>-stems.zip` is for other apps, and a
 * single one dropped on the sidebar goes to the importer, which refuses it for
 * having no `stave.json`.
 */

export const PROJECT_FILE_EXTENSION = ".stave";

/** The file picker's `accept`: the new name, the old one, and the zip MIME
 *  type some pickers filter by. */
export const PROJECT_FILE_ACCEPT = ".stave,.zip,application/zip";

/** The download name for a project: `<name>.stave`. */
export function projectFileName(projectName: string): string {
  const safeName = projectName.replace(/[^a-z0-9_-]+/gi, "_");
  return `${safeName || "stave-project"}${PROJECT_FILE_EXTENSION}`;
}

/** Whether a file is offered to the project importer by its name. */
export function isProjectFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(PROJECT_FILE_EXTENSION) || lower.endsWith(".zip");
}
