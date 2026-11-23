/**
 * #2642 — libraries travel with gallery entries.
 *
 * A three.js sketch imports a library by the name its docs use
 * (`import { SplatMesh } from '@sparkjsdev/spark'`), and the project says where
 * that name loads from in its root `stave.libs.json` (#2639). A gallery entry
 * that leaves the file behind can't play: the sketch would be refused for an
 * undeclared name. So:
 *
 *  - `withLibrariesFile` adds the project's `stave.libs.json` to what an entry
 *    carries whenever a carried sketch imports a name that isn't one of
 *    Stave's own modules (`three`, `three/addons/…`). The file goes as it is,
 *    byte for byte: its hashes pin what the library serves.
 *  - `entryLibraries` lists, for the entry page, each declared library a
 *    carried sketch imports, with the host it loads from ("loads
 *    @sparkjsdev/spark from esm.sh"). A declared name nothing imports isn't
 *    listed: nothing loads it.
 */
import { compileThreeSketch, LIBS_FILE, parseLibraryDeclarations } from "@stave/editor";
import type { GalleryManifest } from "./types";

type ManifestFile = GalleryManifest["files"][number];

/** A sketch file: a `.three` path, or a file whose language says three. */
function isSketch(f: Pick<ManifestFile, "path" | "language">): boolean {
  return f.path.toLowerCase().endsWith(".three") || f.language === "three";
}

/** Stave's own modules: never declared, never fetched. */
function isHostModule(spec: string): boolean {
  return spec === "three" || spec.startsWith("three/");
}

/** A bare name (not a URL or a path): only those can be declared in stave.libs.json. */
function isBareName(spec: string): boolean {
  if (spec.startsWith(".") || spec.startsWith("/")) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(spec);
}

/** The bare, non-Stave names the sketches among `files` import, in first-seen order. */
export function libraryNamesImported(files: ReadonlyArray<Pick<ManifestFile, "path" | "language" | "content">>): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (!isSketch(f)) continue;
    for (const { spec } of compileThreeSketch(f.content).imports) {
      if (isHostModule(spec) || !isBareName(spec) || out.includes(spec)) continue;
      out.push(spec);
    }
  }
  return out;
}

/** The project's root `stave.libs.json`, if it has one. */
export function librariesFileOf<F extends Pick<ManifestFile, "path">>(files: readonly F[]): F | undefined {
  return files.find((f) => f.path === LIBS_FILE);
}

/**
 * `keep` plus the project's `stave.libs.json` when a kept sketch imports a
 * library and the file isn't kept already. Appended last, so the entry's first
 * file is still the one it was published for.
 */
export function withLibrariesFile(project: GalleryManifest, keep: readonly ManifestFile[]): ManifestFile[] {
  const libsFile = librariesFileOf(project.files);
  if (!libsFile || keep.some((f) => f.id === libsFile.id)) return [...keep];
  if (libraryNamesImported(keep).length === 0) return [...keep];
  return [...keep, libsFile];
}

/** One library an entry loads, as the entry page shows it. */
export interface EntryLibrary {
  /** The import name, as the sketch writes it. */
  name: string;
  /** Where it loads from: the declared URL's host. */
  host: string;
  url: string;
  /** Whether the declaration pins the library's contents with a hash. */
  pinned: boolean;
}

/**
 * What the entry page says about libraries: each one a carried sketch imports
 * that the entry's `stave.libs.json` declares, or why the file can't be read.
 * Empty when no sketch imports a library.
 */
export function entryLibraries(
  files: ReadonlyArray<Pick<ManifestFile, "path" | "language" | "content">>,
): { libraries: EntryLibrary[]; problem: string | null } {
  const used = libraryNamesImported(files);
  if (used.length === 0) return { libraries: [], problem: null };
  const parsed = parseLibraryDeclarations(librariesFileOf(files)?.content ?? null);
  if (!parsed.ok) return { libraries: [], problem: parsed.message };
  const libraries: EntryLibrary[] = [];
  for (const name of used) {
    const decl = parsed.libs[name];
    if (!decl) continue;
    libraries.push({ name, host: new URL(decl.url).host, url: decl.url, pinned: typeof decl.sha384 === "string" });
  }
  return { libraries, problem: null };
}
