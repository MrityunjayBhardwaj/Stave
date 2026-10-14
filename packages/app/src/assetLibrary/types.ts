/**
 * Asset Library — the typed model behind the unified sidebar browser (#818).
 *
 * One shell, pluggable providers. Every browsable thing — sounds, viz presets,
 * snippets, user samples, and (later) community/marketplace items — is an
 * {@link Asset} surfaced by an {@link AssetProvider}. The shell renders a search
 * box + a type filter + a source filter over the union of all providers; it
 * never knows what a "sound" or a "viz preset" is. Adding an asset type is
 * registering one provider (see {@link ./registry}); adding the community store
 * is one new `source` + a remote provider, not a UI rewrite.
 *
 * `preview()` / `insert()` live ON the asset (a sound auditions and writes
 * `.sound()`; a viz preset renders a thumbnail and writes `.viz()`), so the
 * shell drives them uniformly through the row action slots.
 */

/** Asset categories. Each maps to exactly one registered provider. */
export type AssetType = "sound" | "viz" | "snippet" | "sample";

/**
 * Where an asset comes from — a filter axis, not a provider axis. `built-in`
 * ships with Stave; `user` is locally imported (Pillar 6); `community` is the
 * future marketplace, which slots in as a remote provider tagged this source
 * with no shell changes.
 */
export type AssetSource = "built-in" | "user" | "community";

/**
 * A handle returned by {@link Asset.preview} so the shell can stop an in-flight
 * preview (a sustained/looping audition) when another row starts or the panel
 * closes. Providers whose preview is instantaneous may return a no-op.
 */
export interface AssetPreviewHandle {
  /** Stop this preview. Idempotent — safe to call after it already ended. */
  stop: () => void;
  /** Resolves when the preview ends by itself (a clip played to its end, #2059). */
  readonly ended?: Promise<void>;
}

/**
 * A handle returned by {@link Asset.mountLivePreview} so the shell can tear the
 * live preview down (on mouse-leave / unmount). Distinct from
 * {@link AssetPreviewHandle}: that stops an audible audition; this disposes a
 * live-rendering canvas.
 */
export interface LivePreviewHandle {
  /** Tear down the live preview (unmount the canvas, release the worker). */
  disconnect: () => void;
}

/**
 * One browsable item. `preview`/`insert` are the two verbs the shell exposes
 * as row action slots; both are optional so a provider can offer either, both,
 * or (rarely) neither.
 */
export interface Asset {
  readonly type: AssetType;
  /** Stable within a provider; the shell keys rows on `${type}:${id}`. */
  readonly id: string;
  readonly name: string;
  readonly source: AssetSource;
  /**
   * The code token this asset represents — what the Copy button copies. Defaults
   * to {@link id} when absent. For sounds `id` IS the code token (the string in
   * `s("…")`); for viz presets `id` is a unique row key but the code token is the
   * preset name (`.viz("name")` resolves by name), so they diverge and viz sets
   * this explicitly.
   */
  readonly code?: string;
  /** Free-form tags — searched alongside the name, shown as row metadata. */
  readonly tags: readonly string[];
  /** Optional secondary label (e.g. category / GM family) shown muted. */
  readonly group?: string;
  /**
   * Optional leading thumbnail — a self-contained image URI (`data:…`) rendered
   * in a small square slot at the head of the row. Viz packages ship a baked
   * frame of the running shader (falling back to a renderer-hued placeholder);
   * sounds leave this unset. Kept generic so any visual asset type can opt in.
   */
  readonly thumbnail?: string;
  /**
   * Start a preview. Returns a handle to stop it, or void for a fire-and-forget
   * preview. May be async (engine warm-up). Absent → no preview affordance.
   */
  readonly preview?: () => AssetPreviewHandle | void | Promise<AssetPreviewHandle | void>;
  /**
   * Mount a LIVE preview into `container` at `size` (px) — e.g. a viz card
   * renders its real shader, muted, while hovered. Returns a handle to tear it
   * down, or `null` when unavailable (the caller keeps the static
   * {@link thumbnail}). Absent → no live preview; the thumbnail stands alone.
   * Generic so any visual asset type can opt in.
   */
  readonly mountLivePreview?: (
    container: HTMLDivElement,
    size: { w: number; h: number },
  ) => LivePreviewHandle | null;
  /**
   * Round-trip this asset into legible code (assign to the focused track, or
   * insert at the cursor), or otherwise materialise it into the project. Absent
   * → no insert affordance.
   */
  readonly insert?: () => void | Promise<void>;
  /**
   * Label for the {@link insert} affordance (tooltip / aria). Defaults to
   * "Insert into code". Viz-library packages set "Add to workspace" since their
   * `+` writes files under `viz_lib/` rather than inserting at the cursor.
   */
  readonly insertLabel?: string;
  /**
   * How much room the asset's bytes take on this device, in bytes. Shown
   * muted on the row so a user whose storage is full can see what to remove
   * (#1786). Absent → no size shown (built-in sounds live on a CDN).
   */
  readonly sizeBytes?: number;
  /**
   * Remove the asset from the project (#1786). The provider owns asking first
   * and saying what happened. Absent → no remove affordance.
   */
  readonly remove?: () => void | Promise<void>;
}

/**
 * Supplies assets of one {@link AssetType}. Mirrors the accessor/registry model
 * Stave already uses for sounds (`setSoundCatalogAccessor`) and viz
 * (`VizPresetStore`): the provider owns enumeration; preview/insert live on the
 * assets it returns.
 */
export interface AssetProvider {
  readonly type: AssetType;
  /** Human label for the type filter chip (e.g. "Sounds"). */
  readonly label: string;
  /**
   * All assets this provider currently knows about. Cheap and synchronous —
   * the shell re-lists on {@link ./registry.subscribeToAssetProviders} ticks,
   * so a provider whose catalog fills lazily (sounds warm up after engine init)
   * notifies the registry and returns the grown list here.
   */
  list: () => readonly Asset[];
  /**
   * Optional provider-specific search. When absent, the shell falls back to a
   * generic name/tag/group substring match over {@link list}.
   */
  search?: (query: string) => readonly Asset[];
  /**
   * Whether this provider's catalog is still populating (engine warm-up). Drives
   * the shell's loading state. Absent → treated as ready.
   */
  isLoading?: () => boolean;
}
