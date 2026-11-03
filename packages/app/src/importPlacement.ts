/**
 * importPlacement.ts — where an imported share's files land in the project that is open
 * (#2288).
 *
 * An import no longer makes a project of its own. Its files go into the project the
 * person has open, under `shared/<when the share was made>/`, keeping their names, their
 * subfolders and their order. Pure: it decides paths, ids and orders; the caller writes.
 *
 * ⚠ Every file gets a NEW id. `createWorkspaceFile` overwrites a file with the same id,
 * and a share of your own project carries your files' ids — importing it with them would
 * silently replace the very files it was made from.
 */

export interface ImportedFile {
  id: string
  path: string
  language: string
  content: string
}

export interface ImportSource {
  /** ms since epoch: when the share was made */
  sharedAt: number
  files: readonly ImportedFile[]
  /** folder path (root = "") → file ids in order */
  fileOrder: Readonly<Record<string, readonly string[]>>
  /** parent folder path (root = "") → subfolder names in order */
  subfolderOrder: Readonly<Record<string, readonly string[]>>
}

export interface Placement {
  /** `shared/<name>`: the folder everything went into */
  folder: string
  files: ImportedFile[]
  fileOrder: Record<string, string[]>
  /** includes the new folder's place under `shared` */
  subfolderOrder: Record<string, string[]>
  /** the file to open afterwards: the share's last pattern (else its last file); null for an empty share */
  open: string | null
}

export const SHARED_DIR = 'shared'

const two = (n: number): string => String(n).padStart(2, '0')

/**
 * `2026-11-03 14-05`, in local time. No `:` — a project is exported as a zip, and a colon
 * is not a legal file name everywhere the zip may be unpacked.
 */
export function folderNameFor(sharedAt: number): string {
  const d = new Date(sharedAt)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}-${two(d.getMinutes())}`
}

/**
 * Where `source` lands, given the paths already in the project and the subfolder order
 * already set under `shared`. A name already taken under `shared/` gets ` (2)`, ` (3)`…,
 * so two imports never mix or overwrite.
 */
export function placeImport(
  source: ImportSource,
  existingPaths: readonly string[],
  sharedOrder: readonly string[],
  newId: () => string,
): Placement {
  const taken = new Set<string>()
  for (const p of existingPaths) {
    if (!p.startsWith(`${SHARED_DIR}/`)) continue
    const name = p.slice(SHARED_DIR.length + 1).split('/')[0]
    if (name) taken.add(name)
  }
  for (const n of sharedOrder) taken.add(n)
  const base = folderNameFor(source.sharedAt)
  let name = base
  for (let i = 2; taken.has(name); i++) name = `${base} (${i})`
  const folder = `${SHARED_DIR}/${name}`
  const under = (p: string): string => (p === '' ? folder : `${folder}/${p}`)

  const ids = new Map<string, string>()
  const files = source.files.map((f) => {
    const id = newId()
    ids.set(f.id, id)
    return { ...f, id, path: under(f.path) }
  })

  const fileOrder: Record<string, string[]> = {}
  for (const [dir, order] of Object.entries(source.fileOrder)) {
    fileOrder[under(dir)] = order.flatMap((id) => (ids.has(id) ? [ids.get(id)!] : []))
  }
  const subfolderOrder: Record<string, string[]> = {}
  for (const [dir, names] of Object.entries(source.subfolderOrder)) subfolderOrder[under(dir)] = [...names]
  subfolderOrder[SHARED_DIR] = [...sharedOrder.filter((n) => n !== name), name]

  return { folder, files, fileOrder, subfolderOrder, open: lastFile(source, ids) }
}

/** a file that plays: what an import opens when it has one */
const PATTERN_LANGUAGES = new Set(['strudel', 'sonicpi'])

/**
 * The last pattern in the share — the last at its top in its order, else the last it
 * lists — so what opens is something you can play. A share with no pattern opens its
 * last file. A whole project shared carries its sketches too, and the last of those
 * is rarely what the sender meant you to see.
 */
function lastFile(source: ImportSource, ids: ReadonlyMap<string, string>): string | null {
  const byId = new Map(source.files.map((f) => [f.id, f]))
  const top = (source.fileOrder[''] ?? []).filter((id) => byId.has(id)).map((id) => byId.get(id)!)
  const playable = (fs: readonly ImportedFile[]): ImportedFile | undefined => [...fs].reverse().find((f) => PATTERN_LANGUAGES.has(f.language))
  const pick = playable(top) ?? playable(source.files) ?? top[top.length - 1] ?? source.files[source.files.length - 1]
  return pick === undefined ? null : ids.get(pick.id) ?? null
}
