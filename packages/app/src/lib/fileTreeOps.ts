/**
 * fileTreeOps — the Files panel's rules for where things may go (#2089, #2090).
 *
 * Pure: every function takes the project's file list (and, for a placement,
 * the order the tree is SHOWING) and returns a verdict or a plan. The panel
 * applies a plan in one undo step. Keeping the rules here means every action
 * that writes a path — new file, new folder, rename, duplicate, drag, import —
 * asks the same question, and a drop starts from the order the user sees
 * rather than one rebuilt by itself.
 *
 * Folders are implicit: a folder exists while some file lives under it. An
 * empty folder is kept alive by a hidden `.keep` file.
 */

export interface FileRef {
  readonly id: string
  readonly path: string
}

/** One child of a folder in its saved order: `d:<folder name>` or `f:<file id>`. */
export type Entry = string

export type DragItem =
  | { readonly kind: 'file'; readonly fileId: string }
  | { readonly kind: 'folder'; readonly folderPath: string }

export const KEEP = '.keep'

/** The hidden file that keeps an empty folder alive — never shown or opened. */
export function isPlaceholder(path: string): boolean {
  return nameOf(path) === KEEP
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function nameOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? path : path.slice(i + 1)
}

export function join(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name
}

/** How a message names a folder. */
export function where(folder: string): string {
  return folder ? `"${folder}"` : 'the top level'
}

/**
 * Is `path` taken — by a file at exactly that path, or by a folder living
 * there (some file under `path/`)? Files whose ids are in `ignore` don't count
 * (the ones being moved or renamed).
 */
export function pathTaken(files: readonly FileRef[], path: string, ignore: ReadonlySet<string> = new Set()): boolean {
  const under = path + '/'
  return files.some((f) => !ignore.has(f.id) && (f.path === path || f.path.startsWith(under)))
}

/** `a.p5` → `a copy.p5`, then `a copy 2.p5`, … — the first one not taken. */
export function nextFreeCopyPath(files: readonly FileRef[], path: string): string {
  const name = nameOf(path)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  const folder = parentOf(path)
  for (let n = 1; ; n++) {
    const candidate = join(folder, `${stem} copy${n === 1 ? '' : ` ${n}`}${ext}`)
    if (!pathTaken(files, candidate)) return candidate
  }
}

export interface PlaceInput {
  readonly files: readonly FileRef[]
  readonly item: DragItem
  /** the folder the item is dropped into ('' = top level) */
  readonly targetParent: string
  /** the sibling it lands next to, or null to just put it in the folder */
  readonly anchor: Entry | null
  readonly position: 'above' | 'below'
  /** the children of a folder in the order the tree shows them now */
  readonly shownOrder: (folderPath: string) => Entry[]
}

export interface PlacePlan {
  readonly ok: true
  /** files whose path changes (the item, or everything under a folder) */
  readonly renames: { readonly id: string; readonly path: string }[]
  /** a folder emptied by the move, to keep alive with a `.keep` */
  readonly keepFolder: string | null
  /** the target folder's new order, when the drop chose a position */
  readonly order: { readonly parent: string; readonly entries: Entry[] } | null
  /** a moved folder's saved orders (its own and its sub-folders') follow it */
  readonly carryOrders: { readonly from: string; readonly to: string } | null
  /** the item's entry, to drop from the folder it left */
  readonly leftParent: { readonly parent: string; readonly entry: Entry } | null
}

export type PlaceResult = PlacePlan | { readonly ok: false; readonly reason: string | null }

const NOTHING: PlaceResult = { ok: false, reason: null }

/** Plan a drop. `reason: null` = nothing to do, say nothing. */
export function placeItem(input: PlaceInput): PlaceResult {
  const { files, item, targetParent, anchor, position, shownOrder } = input

  let sourceParent: string
  let entry: Entry
  let moved: FileRef[]
  let name: string
  if (item.kind === 'file') {
    const file = files.find((f) => f.id === item.fileId)
    if (!file) return NOTHING
    sourceParent = parentOf(file.path)
    name = nameOf(file.path)
    entry = 'f:' + file.id
    moved = [file]
  } else {
    const p = item.folderPath
    // released on its own row: nothing to do
    if (targetParent === p) return NOTHING
    if (targetParent.startsWith(p + '/')) {
      return { ok: false, reason: `"${nameOf(p)}" can't go inside itself.` }
    }
    sourceParent = parentOf(p)
    name = nameOf(p)
    entry = 'd:' + name
    moved = files.filter((f) => f.path.startsWith(p + '/'))
    if (moved.length === 0) return NOTHING
  }
  if (anchor === entry) return NOTHING

  const moving = sourceParent !== targetParent
  const renames: { id: string; path: string }[] = []
  let carryOrders: PlacePlan['carryOrders'] = null
  let keepFolder: string | null = null
  if (moving) {
    const ignore = new Set(moved.map((f) => f.id))
    const dest = join(targetParent, name)
    if (pathTaken(files, dest, ignore)) {
      return { ok: false, reason: `"${name}" already exists in ${where(targetParent)}.` }
    }
    if (item.kind === 'file') {
      renames.push({ id: moved[0].id, path: dest })
    } else {
      for (const f of moved) renames.push({ id: f.id, path: dest + f.path.slice(item.folderPath.length) })
      carryOrders = { from: item.folderPath, to: dest }
    }
    if (sourceParent && !files.some((f) => !ignore.has(f.id) && f.path.startsWith(sourceParent + '/'))) {
      keepFolder = sourceParent
    }
  }

  let order: PlacePlan['order'] = null
  if (anchor !== null) {
    const shown = shownOrder(targetParent)
    const without = shown.filter((e) => e !== entry)
    const at = without.indexOf(anchor)
    const next =
      at < 0 ? [...without, entry] : [...without.slice(0, at + (position === 'below' ? 1 : 0)), entry, ...without.slice(at + (position === 'below' ? 1 : 0))]
    if (moving || next.join('\n') !== shown.join('\n')) order = { parent: targetParent, entries: next }
  }

  if (!moving && order === null) return NOTHING
  return {
    ok: true,
    renames,
    keepFolder,
    order,
    carryOrders,
    leftParent: moving ? { parent: sourceParent, entry } : null,
  }
}

export interface FolderRenamePlan {
  readonly ok: true
  readonly renames: { readonly id: string; readonly path: string }[]
  readonly carryOrders: { readonly from: string; readonly to: string }
  /** the parent's saved order with the folder's entry renamed in place */
  readonly parentEntry: { readonly parent: string; readonly from: Entry; readonly to: Entry }
}

/** Plan renaming the folder at `oldPath` to `newName` (same parent). */
export function renameFolder(
  files: readonly FileRef[],
  oldPath: string,
  newName: string,
): FolderRenamePlan | { readonly ok: false; readonly reason: string | null } {
  const name = newName.trim()
  if (!name || name === nameOf(oldPath)) return { ok: false, reason: null }
  if (name.includes('/')) return { ok: false, reason: 'A folder name can\'t contain "/".' }
  const parent = parentOf(oldPath)
  const newPath = join(parent, name)
  const moved = files.filter((f) => f.path.startsWith(oldPath + '/'))
  if (pathTaken(files, newPath, new Set(moved.map((f) => f.id)))) {
    return { ok: false, reason: `"${name}" already exists in ${where(parent)}.` }
  }
  return {
    ok: true,
    renames: moved.map((f) => ({ id: f.id, path: newPath + f.path.slice(oldPath.length) })),
    carryOrders: { from: oldPath, to: newPath },
    parentEntry: { parent, from: 'd:' + nameOf(oldPath), to: 'd:' + name },
  }
}

/**
 * The folders a delete would empty without the user deleting them — the
 * parents of the removed files (or of the removed folder) left with nothing
 * in them. They get a `.keep`, so deleting a file never takes its folder too.
 */
export function foldersEmptiedBy(
  files: readonly FileRef[],
  removedIds: ReadonlySet<string>,
  removedFolder: string | null = null,
): string[] {
  const candidates = new Set<string>()
  if (removedFolder !== null) candidates.add(parentOf(removedFolder))
  else for (const f of files) if (removedIds.has(f.id)) candidates.add(parentOf(f.path))
  return [...candidates].filter(
    (c) => c !== '' && !files.some((f) => !removedIds.has(f.id) && f.path.startsWith(c + '/')),
  )
}

/** Every folder at or under `folder`, from the files that live there. */
export function foldersUnder(files: readonly FileRef[], folder: string): string[] {
  const out = new Set<string>([folder])
  for (const f of files) {
    if (!f.path.startsWith(folder + '/')) continue
    let p = parentOf(f.path)
    while (p.length > folder.length) {
      out.add(p)
      p = parentOf(p)
    }
  }
  return [...out]
}
