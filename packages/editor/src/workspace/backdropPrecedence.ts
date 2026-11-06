/**
 * backdropPrecedence — the pure precedence rule for a pane's backdrop (#350a).
 *
 * A pane (editor group) has two backdrop layers:
 *   - the manual STICKY — the file the user "set as backdrop" (persisted on the
 *     group as `backgroundFileId`); and
 *   - the transient code OVERRIDE — the active program's `.scope()` /
 *     `.viz('x', { backdrop:true })` declaration for the current eval (not
 *     persisted; lives only while the code declares it).
 *
 * The override wins while present; when it clears, the sticky shows again. Kept
 * pure + dependency-free so the precedence is unit-testable without the shell
 * (no React / monaco / DOM).
 */

/**
 * Resolve a group's effective backdrop file id. The transient code OVERRIDE
 * takes precedence over the persisted manual STICKY; `undefined` (neither set)
 * means no backdrop.
 */
export function resolveBackdropFileId(
  stickyFileId: string | undefined,
  overrideFileId: string | undefined,
): string | undefined {
  return overrideFileId ?? stickyFileId
}

/**
 * #2422 — does a viz tab's ⏸ pause THIS pane's background?
 *
 * The viz chrome's play/pause (#781) flips a per-FILE flag (`pausedPreviews`,
 * keyed by file so a pause survives dragging the tab to another pane). It
 * controls that viz's OWN placements: its side preview, and the background of a
 * pane while the viz file itself is that pane's active tab. A background that
 * another tab draws from the same file — a pattern's code background
 * (`all(x => x.viz("Fold"))`) or another tab's pin — is not the viz's own and
 * keeps running: Play/Stop only start and stop the music, and the pattern tab has
 * no pause control to undo it.
 *
 * @param bgFileId     the file the pane's background draws
 * @param paneFileId   the file the pane's active tab shows (null for none)
 * @param pausedFiles  the viz files paused from their own tab
 */
export function isOwnBackdropPaused(
  bgFileId: string,
  paneFileId: string | null | undefined,
  pausedFiles: ReadonlySet<string>,
): boolean {
  return paneFileId === bgFileId && pausedFiles.has(bgFileId)
}
