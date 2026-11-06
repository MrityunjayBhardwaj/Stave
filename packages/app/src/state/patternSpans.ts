/**
 * #2423 — each pattern file's background "viz span": File (its background is
 * drawn in its own pane only, the default) or Workspace (its background covers
 * every pane in the workspace). Persisted per project in localStorage as a plain
 * `{ patternFileId: "file" | "workspace" }` map; best-effort.
 *
 * MIGRATION: the span used to be ONE global switch (`stave:backdropVizSpan`).
 * When that old switch says "workspace", it is read as the DEFAULT for patterns
 * that have no setting of their own yet, so a workspace someone set up keeps
 * spanning after the update. A pattern given its own value keeps it. The old key
 * is left in place (other builds still read it).
 */

export type PatternSpan = "file" | "workspace";

const LEGACY_GLOBAL_KEY = "stave:backdropVizSpan";

function patternSpanKey(projectId: string): string {
  return `stave:patternSpan:${projectId}`;
}

export function loadPatternSpans(projectId: string): Map<string, PatternSpan> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(patternSpanKey(projectId));
    if (!raw) return new Map();
    const out = new Map<string, PatternSpan>();
    for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
      if (v === "file" || v === "workspace") out.set(k, v);
    }
    return out;
  } catch {
    return new Map();
  }
}

export function savePatternSpans(projectId: string, map: ReadonlyMap<string, PatternSpan>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(patternSpanKey(projectId), JSON.stringify(Object.fromEntries(map)));
  } catch {
    /* best-effort persistence */
  }
}

/** The span for patterns without a setting of their own (see MIGRATION above). */
export function defaultPatternSpan(): PatternSpan {
  if (typeof window === "undefined") return "file";
  try {
    return window.localStorage.getItem(LEGACY_GLOBAL_KEY) === "workspace" ? "workspace" : "file";
  } catch {
    return "file";
  }
}
