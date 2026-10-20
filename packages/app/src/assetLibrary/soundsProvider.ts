/**
 * Sounds AssetProvider (#820) — the first real provider: a unified browser over
 * the FULL live `soundMap` superset (~1853 entries), the thing the melodic
 * `<select>` never could show.
 *
 * Unlike the Mixer picker's `groupSoundCatalog` (which is melodic-only — it
 * excludes the 1357 drum-machine voices and the audio-in bus by design, for a
 * scannable native `<select>`), the library is the "browse EVERYTHING, searchable"
 * surface, so this provider reads the RAW map and includes drums (grouped by
 * bank). It reuses the app's existing soundMap warm-up + poll (PV164/PV165a) — it
 * does not re-poll; `list()` just reads `globalThis.soundMap` live and the poll
 * calls `notifyAssetProvidersChanged()` when the catalog grows.
 *
 * `preview`/`insert` are dependency-injected so the mapping is unit-testable
 * without the audio graph or the editor: the app wires `startPreview` to
 * `startAudition` (@stave/editor) and `onInsert` to the shell's cursor writer.
 */

import { gmFamily, soundfontGroupLabel } from "@stave/editor";
import type { Asset, AssetPreviewHandle } from "./types";

/** The minimal shape read off a superdough soundMap entry (mirrors the editor's
 *  `SoundMapEntry`; kept local so the provider doesn't depend on that type). */
interface SoundMapEntry {
  data?: { type?: string; tag?: string };
}
export type SoundMapDict = Record<string, SoundMapEntry>;

export interface SoundsProviderDeps {
  /** Read the live soundMap dict (or null before the engine warms up). */
  readDict: () => SoundMapDict | null;
  /** Start a sustained preview; returns a handle to stop it. */
  startPreview: (sound: string) => AssetPreviewHandle;
  /** Round-trip the sound into code at the cursor (assign or insert). */
  onInsert: (sound: string) => void;
  /**
   * The project's own audio, as rows (#2062) — `recordsToAssets`, with size,
   * remove and the clip preview. Every one is ALSO in the sound map (that is how
   * `s()` reaches it), and the map says nothing about who made a sound, so
   * without this the file is listed as a built-in sound and Sounds → User is
   * empty. Its names are taken out of the built-in rows and these rows go in.
   */
  ownAudio?: () => readonly Asset[];
}

/** Title-case a bare id: `sawtooth` → `Sawtooth`. */
function titleCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** `gm_alto_sax` → `Alto Sax`. */
function soundfontLabel(name: string): string {
  return name
    .replace(/^gm_/, "")
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface Classified {
  group: string;
  label: string;
  tags: string[];
}

/**
 * Group + label a soundMap entry — the #807 taxonomy. Drum-machine voices
 * (`tag: 'drum-machines'`, keys `Bank_voice` like `RolandTR909_bd`) cluster by
 * bank; melodic sounds split by type. Unknown types fall through to "Samples"
 * (include-by-default — never silently drop a new upstream type, the P254 rule).
 */
function classify(name: string, data: SoundMapEntry["data"]): Classified {
  const type = data?.type;
  if (data?.tag === "drum-machines") {
    const i = name.lastIndexOf("_");
    const bank = i > 0 ? name.slice(0, i) : name;
    return { group: `Drums · ${bank}`, label: name, tags: ["drums", "drum-machines", bank, name] };
  }
  switch (type) {
    case "synth":
      return { group: "Synths", label: titleCase(name), tags: ["synth", name] };
    case "soundfont": {
      // #807 — cluster the 125 `gm_*` soundfonts by GM instrument family
      // (`Soundfonts · Strings`, `· Brass`, …) instead of one flat group; the
      // family name is also a search tag so "strings" finds them. Bare/unmapped
      // soundfonts fall back to the flat "Soundfonts" label.
      const family = gmFamily(name);
      const tags = ["soundfont", "gm", name];
      if (family) tags.push(family.toLowerCase());
      return { group: soundfontGroupLabel(name), label: soundfontLabel(name), tags };
    }
    case "wavetable":
      return { group: "Wavetables", label: titleCase(name), tags: ["wavetable", name] };
    case "sample":
      return { group: "Samples", label: titleCase(name), tags: ["sample", name] };
    default:
      return { group: "Samples", label: titleCase(name), tags: [type ?? "sample", name] };
  }
}

/**
 * Pure mapping: soundMap dict → sorted `Asset[]`. Skips superdough internals
 * (`_`-prefixed) and the audio-in bus (`type: 'input'`). Sorted by (group, label)
 * so related sounds cluster in the shell's flat windowed list. Exported for
 * unit tests.
 */
export function soundMapToAssets(
  dict: SoundMapDict | null | undefined,
  deps: Pick<SoundsProviderDeps, "startPreview" | "onInsert">,
): Asset[] {
  if (!dict) return [];
  const assets: Asset[] = [];
  for (const name of Object.keys(dict)) {
    if (name.startsWith("_")) continue;
    const data = dict[name]?.data;
    if (data?.type === "input") continue;
    const { group, label, tags } = classify(name, data);
    assets.push({
      type: "sound",
      id: name, // the exact string written into s("…") — stable + unique
      name: label,
      source: "built-in",
      group,
      tags,
      preview: () => deps.startPreview(name),
      insert: () => deps.onInsert(name),
    });
  }
  assets.sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.name.localeCompare(b.name));
  return assets;
}

/**
 * Build the Sounds provider. `list()` is called on every shell re-list —
 * including every search keystroke (the shell filters over `list()`, this
 * provider has no own `search`). Rebuilding 1851 Assets + sorting on each call
 * would jank typing, so the built list is MEMOISED on the soundMap's entry
 * count: it rebuilds only when the catalog grows (warm-up), and returns the
 * same array between growths — which also keeps the shell's `useMemo` stable.
 * Count is the key because superdough's soundMap only ever grows to its final
 * size (the poll notifies on count change), matching the existing catalog
 * accessor's contract.
 */
export function createSoundsProvider(deps: SoundsProviderDeps) {
  let cachedCount = -1;
  let cached: Asset[] = [];
  return {
    type: "sound" as const,
    label: "Sounds",
    list: () => {
      const dict = deps.readDict();
      const count = dict ? Object.keys(dict).length : 0;
      if (count !== cachedCount) {
        cachedCount = count;
        cached = soundMapToAssets(dict, deps);
      }
      // Read live, not cached: a record added, renamed or removed does not always
      // change the map's size, and the list is a handful of rows.
      const own = deps.ownAudio?.() ?? [];
      if (own.length === 0) return cached;
      const ownNames = new Set(own.map((a) => a.code ?? a.id));
      return [...own, ...cached.filter((a) => !ownNames.has(a.id))];
    },
    isLoading: () => {
      const d = deps.readDict();
      return !d || Object.keys(d).length === 0;
    },
  };
}
