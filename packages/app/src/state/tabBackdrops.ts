/**
 * #347 — per-TAB backdrop persistence. The backdrop a user pins is stored
 * against the file (tab) it was set from, not the pane — so switching tabs
 * swaps/clears the pane's backdrop to match the active tab. Persisted per
 * project in localStorage as a plain `{ fileId: vizFileId }` map; best-effort.
 *
 * #2240 — a template can pin one too (the Starter's Sunset Drive), written
 * here when the project is seeded, before the editor reads the map.
 */

function perTabBackdropKey(projectId: string): string {
  return `stave:perTabBackdrop:${projectId}`;
}

export function loadPerTabBackdrop(projectId: string): Map<string, string> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(perTabBackdropKey(projectId));
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch {
    return new Map();
  }
}

export function savePerTabBackdrop(
  projectId: string,
  map: ReadonlyMap<string, string>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      perTabBackdropKey(projectId),
      JSON.stringify(Object.fromEntries(map)),
    );
  } catch {
    /* best-effort persistence */
  }
}

/** Pin `vizFileId` behind `fileId`'s tab, unless that tab already has one. */
export function pinTabBackdropIfUnset(projectId: string, fileId: string, vizFileId: string): void {
  const map = loadPerTabBackdrop(projectId);
  if (map.has(fileId)) return;
  map.set(fileId, vizFileId);
  savePerTabBackdrop(projectId, map);
}
