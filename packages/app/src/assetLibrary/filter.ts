/**
 * Pure filtering over the union of all providers' assets. Kept separate from
 * the panel component so the search/type/source logic is unit-testable without
 * React. The panel calls {@link collectAssets} on every registry tick + filter
 * change; the result is what the windowed list renders.
 */

import { SKILL_LEVELS, type Asset, type AssetProvider, type AssetSource, type AssetType, type SkillLevel } from "./types";

export interface AssetFilter {
  /** Trimmed search query; empty string matches everything. */
  query: string;
  /** null = all types; otherwise restrict to this one. */
  type: AssetType | null;
  /** null = all sources; otherwise restrict to this one. */
  source: AssetSource | null;
  /** null = all categories; otherwise restrict to this top-level category
   *  (the group prefix, e.g. "Drums" / "Soundfonts"). See {@link assetCategory}. */
  category: string | null;
  /** null/absent = all levels; otherwise only assets of this level (#2165). */
  level?: SkillLevel | null;
}

/**
 * An asset's top-level category — the group prefix before ` · `
 * (`Soundfonts · Strings` → `Soundfonts`, `Drums · RolandTR909` → `Drums`,
 * `Synths` → `Synths`). Groupless assets fall under `Other`. This is the
 * dimension the category filter chips slice on; it's derived from the same
 * `group` convention (`<Category> · <sub>`) the providers already use.
 */
export function assetCategory(asset: Asset): string {
  const g = asset.group?.trim();
  if (!g) return "Other";
  const i = g.indexOf(" · ");
  return i > 0 ? g.slice(0, i) : g;
}

/** Generic name/tag/group substring match — the fallback when a provider has no
 *  own `search`. Case-insensitive, whitespace-trimmed. */
export function matchesQuery(asset: Asset, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (asset.name.toLowerCase().includes(q)) return true;
  if (asset.group && asset.group.toLowerCase().includes(q)) return true;
  return asset.tags.some((t) => t.toLowerCase().includes(q));
}

/**
 * Flatten every provider's assets into one list under the given filter.
 * Type filter is applied at the provider level (skip whole providers) so a
 * lazily-filling provider of another type isn't even enumerated; source and
 * query are applied per-asset. A provider's own `search` wins over the generic
 * matcher when a query is present.
 */
export function collectAssets(
  providers: readonly AssetProvider[],
  filter: AssetFilter,
): Asset[] {
  const q = filter.query.trim();
  const out: Asset[] = [];
  for (const provider of providers) {
    if (filter.type && provider.type !== filter.type) continue;
    const base = q && provider.search ? provider.search(q) : provider.list();
    for (const asset of base) {
      if (filter.source && asset.source !== filter.source) continue;
      if (filter.category && assetCategory(asset) !== filter.category) continue;
      if (filter.level && asset.level !== filter.level) continue;
      // Provider `search` already applied the query; only the generic path
      // needs the substring gate here.
      if (q && !provider.search && !matchesQuery(asset, q)) continue;
      out.push(asset);
    }
  }
  return out;
}

/** The set of types actually present across the providers — drives which type
 *  filter chips are shown (no empty chips). */
export function availableTypes(providers: readonly AssetProvider[]): AssetType[] {
  const seen = new Set<AssetType>();
  for (const p of providers) seen.add(p.type);
  return Array.from(seen);
}

/** The set of sources actually present across all listed assets — drives which
 *  source filter chips are shown. */
export function availableSources(providers: readonly AssetProvider[]): AssetSource[] {
  const seen = new Set<AssetSource>();
  for (const p of providers) {
    for (const a of p.list()) seen.add(a.source);
  }
  return Array.from(seen);
}

/**
 * The categories present, each with its entry count — drives the category
 * filter chips and their counts. Scoped to the current type/source (so counts
 * match what "All" would show) but NOT the query or category itself, so the
 * numbers stay stable while the musician types or switches chips. Sorted by
 * count desc (biggest buckets first), then name for ties.
 */
export function availableCategories(
  providers: readonly AssetProvider[],
  scope?: { type?: AssetType | null; source?: AssetSource | null; level?: SkillLevel | null },
): { category: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of providers) {
    if (scope?.type && p.type !== scope.type) continue;
    for (const a of p.list()) {
      if (scope?.source && a.source !== scope.source) continue;
      if (scope?.level && a.level !== scope.level) continue;
      const c = assetCategory(a);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

/**
 * The levels present, each with its count, easiest first (#2165) — drives the
 * level chips. Scoped like {@link availableCategories} (type and source), so a
 * type whose assets carry no level shows no level chips at all.
 */
export function availableLevels(
  providers: readonly AssetProvider[],
  scope?: { type?: AssetType | null; source?: AssetSource | null },
): { level: SkillLevel; count: number }[] {
  const counts = new Map<SkillLevel, number>();
  for (const p of providers) {
    if (scope?.type && p.type !== scope.type) continue;
    for (const a of p.list()) {
      if (scope?.source && a.source !== scope.source) continue;
      if (a.level) counts.set(a.level, (counts.get(a.level) ?? 0) + 1);
    }
  }
  return SKILL_LEVELS.filter((l) => counts.has(l)).map((level) => ({ level, count: counts.get(level)! }));
}
