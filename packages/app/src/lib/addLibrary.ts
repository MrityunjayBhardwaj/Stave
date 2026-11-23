/**
 * Add Library… (#2643): put one of the tested libraries into the project's
 * `stave.libs.json`, with the hash of what its URL serves right now.
 *
 * The library is fetched and hashed first; the file is read and written only
 * after that, so a failed fetch changes nothing, and an edit made while the
 * fetch was running isn't overwritten. Other entries and the file's layout are
 * kept (withLibraryDeclaration).
 */
import {
  createWorkspaceFile,
  declarationFor,
  listWorkspaceFiles,
  setContent,
  withLibraryDeclaration,
  LIBS_FILE,
  type CatalogueEntry,
  type LoadLibraryGraphOptions,
} from "@stave/editor";

export type AddLibraryResult =
  | { ok: true; created: boolean; text: string }
  | { ok: false; message: string };

function newFileId(): string {
  return `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function addLibraryToProject(
  entry: CatalogueEntry,
  options: LoadLibraryGraphOptions = {},
): Promise<AddLibraryResult> {
  let decl;
  try {
    decl = await declarationFor(entry, options);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Couldn't add ${entry.title}: ${why}. ${LIBS_FILE} was not changed.` };
  }
  // Read the file now, after the fetch: it may have been edited meanwhile.
  const file = listWorkspaceFiles().find((f) => f.path === LIBS_FILE);
  const edit = withLibraryDeclaration(file?.content ?? null, entry.name, decl);
  if (!edit.ok) return { ok: false, message: `Couldn't add ${entry.title}: ${edit.message}` };
  if (file) setContent(file.id, edit.text);
  else createWorkspaceFile(newFileId(), LIBS_FILE, edit.text, "json");
  return { ok: true, created: !file, text: edit.text };
}
