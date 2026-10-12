/**
 * File → Open Recent (#2020): the projects opened most recently, newest first.
 *
 * Stave already stamps a project each time it is opened (`lastOpenedAt`), so this
 * is a reading of that, not a second record of recency. The project that is open
 * now is in the list — it is the most recent one — marked so the menu can show it
 * without offering to switch to it.
 */
import type { ProjectMeta } from "@stave/editor";

/** how many projects Open Recent lists */
export const OPEN_RECENT_LIMIT = 10;

export interface RecentProjectEntry {
  readonly id: string;
  readonly name: string;
  /** the project that is open now */
  readonly current: boolean;
}

export function recentProjectEntries(
  projects: readonly ProjectMeta[],
  activeProjectId: string,
  limit: number = OPEN_RECENT_LIMIT,
): RecentProjectEntry[] {
  return [...projects]
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, limit)
    .map((p) => ({ id: p.id, name: p.name, current: p.id === activeProjectId }));
}
