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
 * The code reader (`readCodeViz`) sees the master `all()` line and the track
 * lines (`.viz(name, { backdrop: true })`, `.scope()`, `.pianoroll({...})`) —
 * #2394 — and names what the engine would play. What it cannot read (a name in
 * a variable, a call nested in an argument) is known only from the last
 * evaluation of that file, so it is kept until the file is evaluated again or
 * the user clears it — still scoped to its file.
 *
 * Pure and dependency-free so the rule is unit-tested without React or Monaco.
 */

/** What the last evaluation of one pattern file asked for. */
export interface EvaluatedBackdrop {
  /** the runtime's backdrop request (a viz name / renderer id) */
  vizId: string;
  /** the options the evaluation captured with it */
  options: Record<string, unknown> | null;
  /** the background the code reader (`readCodeViz`) named in the code that was
   *  evaluated, or null; a request that differs from it came from something the
   *  reader can't see */
  declaredAtEval: string | null;
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
 * The pattern files open as an editor tab in some pane (active or not), in pane
 * order, each once. A pattern's background, and the options its code gives it,
 * live exactly as long as one of its tabs is open (#2395).
 */
export function openPatternFiles(
  panes: Iterable<PaneView>,
  isPattern: (fileId: string) => boolean,
): string[] {
  const open: string[] = [];
  for (const pane of panes) {
    for (const t of pane.tabs) {
      if (t.kind !== "editor" || !t.fileId || open.includes(t.fileId)) continue;
      if (isPattern(t.fileId)) open.push(t.fileId);
    }
  }
  return open;
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

/**
 * #2423 — the background spanning the workspace, if any.
 *
 * A pattern set to Workspace covers every pane with its background (the one its
 * tab shows: code background, else pinned). Candidates are the pattern files open
 * as a tab in some pane whose span is Workspace and that have a background. With
 * more than one, the MOST RECENTLY USED wins — focused, played, or set to
 * Workspace, whichever happened last (`recency`: later = more recent); patterns
 * never used yet rank by pane order. Deterministic, and it follows what the user
 * last touched.
 *
 * @param openPatterns  pattern file ids open in the panes, in pane order (deduped)
 * @param spanOf        a pattern's span
 * @param shownOf       the background a pattern's tab shows (viz file id) or null
 * @param recency       pattern file id → monotonically increasing use stamp
 */
export function pickSpanningBackdrop(
  openPatterns: readonly string[],
  spanOf: (patternFileId: string) => "file" | "workspace",
  shownOf: (patternFileId: string) => string | null,
  recency: ReadonlyMap<string, number>,
): { fileId: string; ownerFileId: string } | null {
  let best: { fileId: string; ownerFileId: string; stamp: number; order: number } | null = null;
  openPatterns.forEach((id, order) => {
    if (spanOf(id) !== "workspace") return;
    const fileId = shownOf(id);
    if (!fileId) return;
    const stamp = recency.get(id) ?? -1;
    if (!best || stamp > best.stamp || (stamp === best.stamp && order < best.order)) {
      best = { fileId, ownerFileId: id, stamp, order };
    }
  });
  if (!best) return null;
  const { fileId, ownerFileId } = best as { fileId: string; ownerFileId: string };
  return { fileId, ownerFileId };
}

/** Viz names compare the way the backdrop resolves them: case and punctuation blind. */
export function sameVizName(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(a) === norm(b);
}

/**
 * Record what an evaluation asked for, with the background the code reader named
 * in the evaluated code, so a later edit can tell whether the request came from
 * what the reader sees (and so follows the code) or from something only an
 * evaluation can find (and so stays until the next evaluation). `null` when the
 * evaluation asked for no background.
 */
export function recordEvaluatedBackdrop(
  vizId: string | null,
  options: Record<string, unknown> | null,
  declaredAtEval: string | null,
): EvaluatedBackdrop | null {
  return vizId ? { vizId, options, declaredAtEval } : null;
}

/** True when the evaluation's request is one the code reader did not name. */
export function isEvaluationOnly(evaluated: EvaluatedBackdrop | null): boolean {
  return evaluated != null && !sameVizName(evaluated.vizId, evaluated.declaredAtEval);
}

/**
 * The background a pattern file's code asks for now.
 *
 * @param declaredNow  the background the code reader names in the file's CURRENT
 *                     code (master line or track, #2394), or null
 * @param evaluated    what the file's last evaluation asked for, or null
 *
 * - what the code declares, when it names one — unless the evaluation chose
 *   something else while the code reader's answer was the same as it is now
 *   (the engine's last call wins, so that is what played);
 * - else a background only the last evaluation found;
 * - else none. A declared request whose call has since been deleted is NOT kept:
 *   the code no longer declares it.
 */
export function codeBackdropName(
  declaredNow: string | null,
  evaluated: EvaluatedBackdrop | null,
): CodeBackdropName | null {
  const evaluationOnly = isEvaluationOnly(evaluated);
  if (declaredNow && !(evaluationOnly && sameVizName(declaredNow, evaluated?.declaredAtEval))) {
    return { name: declaredNow, source: "code" };
  }
  if (evaluationOnly && evaluated) return { name: evaluated.vizId, source: "evaluation" };
  return null;
}
