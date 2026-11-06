/**
 * codeBackdrop — which background a PATTERN FILE's code asks for (#2413).
 *
 * A pane draws `resolveBackdropFileId(sticky, override)`: the code's background
 * wins over the one the user pinned. The code's background used to be written
 * only when a pattern was evaluated and was never taken back, so after one Play
 * it outranked every tab and every clear until the next evaluation.
 *
 * The code's background belongs to the pattern file that declared it:
 *  - it applies while that file is the active tab, and no other tab sees it;
 *  - it is re-read from the code on every edit, so deleting the master
 *    `all(x => x.viz("name"))` line, or clearing it from the "set bg" popover,
 *    takes it away without a re-run.
 *
 * The code reader (`readMasterViz`) sees only the master `all()` form. A
 * background declared on a TRACK (`.viz(name, { backdrop: true })`,
 * `.scope()`, `.pianoroll({...})`) is known only from the last evaluation of
 * that file, so it is kept until the file is evaluated again or the user
 * clears it — still scoped to its file.
 *
 * Pure and dependency-free so the rule is unit-tested without React or Monaco.
 */

/** What the last evaluation of one pattern file asked for. */
export interface EvaluatedBackdrop {
  /** the runtime's backdrop request (a viz name / renderer id) */
  vizId: string;
  /** the options the evaluation captured with it */
  options: Record<string, unknown> | null;
  /** the master `all()` viz name in the code that was evaluated, or null */
  masterAtEval: string | null;
}

/** Where a pattern's code background came from. */
export type CodeBackdropSource = "code" | "evaluation";

export interface CodeBackdropName {
  name: string;
  source: CodeBackdropSource;
}

/**
 * The background a tab shows (#2414): its code's background, else the one
 * pinned to it, else none. The same precedence the shell draws a pane with
 * (`resolveBackdropFileId` in @stave/editor's backdropPrecedence: override ??
 * sticky), applied to one tab, so the "set bg" button names what is on screen.
 */
export function shownTabBackdrop(
  pinnedFileId: string | null | undefined,
  codeFileId: string | null | undefined,
): string | null {
  return codeFileId ?? pinnedFileId ?? null;
}

/**
 * A pane (editor group) as the shell reports it: its tabs and which is active.
 * Structural, so the shell's `WorkspaceGroupState` fits without importing it.
 */
export interface PaneView {
  readonly id: string;
  readonly tabs: ReadonlyArray<{ readonly id: string; readonly kind: string; readonly fileId?: string }>;
  readonly activeTabId: string | null;
}

/** The file a pane shows (its active editor or preview tab), or null. */
export function fileShownIn(pane: PaneView | undefined): string | null {
  if (!pane || pane.activeTabId == null) return null;
  const tab = pane.tabs.find((t) => t.id === pane.activeTabId);
  if (!tab || (tab.kind !== "editor" && tab.kind !== "preview")) return null;
  return tab.fileId ?? null;
}

/** The panes whose active tab shows `fileId`, in iteration order. */
export function panesShowing(panes: Iterable<PaneView>, fileId: string): string[] {
  const out: string[] = [];
  for (const pane of panes) if (fileShownIn(pane) === fileId) out.push(pane.id);
  return out;
}

/**
 * #2421 — each pane's code-background override: the code background of the
 * pattern the pane shows, and nothing for a pane showing anything else. In File
 * mode a background is local to its pane, so a pattern's background never
 * reaches the viz pane beside it, whichever pane has focus.
 */
export function paneCodeBackdrops(
  panes: Iterable<PaneView>,
  codeBackdrops: ReadonlyMap<string, string>,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const pane of panes) {
    const fileId = fileShownIn(pane);
    out.set(pane.id, fileId ? codeBackdrops.get(fileId) ?? null : null);
  }
  return out;
}

/** Viz names compare the way the backdrop resolves them: case and punctuation blind. */
export function sameVizName(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(a) === norm(b);
}

/**
 * Record what an evaluation asked for, with the master `all()` viz the
 * evaluated code carried, so a later edit can tell whether the request came
 * from that line (and so follows the code) or from a track (and so stays until
 * the next evaluation). `null` when the evaluation asked for no background.
 */
export function recordEvaluatedBackdrop(
  vizId: string | null,
  options: Record<string, unknown> | null,
  masterAtEval: string | null,
): EvaluatedBackdrop | null {
  return vizId ? { vizId, options, masterAtEval } : null;
}

/** True when the evaluation's request came from a track, not the master line. */
export function isTrackLevel(evaluated: EvaluatedBackdrop | null): boolean {
  return evaluated != null && !sameVizName(evaluated.vizId, evaluated.masterAtEval);
}

/**
 * The background a pattern file's code asks for now.
 *
 * @param masterNow  the master `all()` viz name in the file's CURRENT code, or null
 * @param evaluated  what the file's last evaluation asked for, or null
 *
 * - the master line, when present — unless the evaluation chose a track's
 *   background while the master line was the same as it is now (the engine's
 *   last declaration wins, so that is what played);
 * - else a track-level background from the last evaluation;
 * - else none. A master-line request whose line has since been deleted is
 *   NOT kept: the code no longer declares it.
 */
export function codeBackdropName(
  masterNow: string | null,
  evaluated: EvaluatedBackdrop | null,
): CodeBackdropName | null {
  const trackLevel = isTrackLevel(evaluated);
  if (masterNow && !(trackLevel && sameVizName(masterNow, evaluated?.masterAtEval))) {
    return { name: masterNow, source: "code" };
  }
  if (trackLevel && evaluated) return { name: evaluated.vizId, source: "evaluation" };
  return null;
}
