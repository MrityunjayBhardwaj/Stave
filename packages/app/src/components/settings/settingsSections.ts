/**
 * Declarative settings schema (#739 A2).
 *
 * The single source of truth for the Settings surface: which sections
 * exist, their nav order, and the simple getter/setter-backed fields each
 * one holds. SettingsPanel renders controls FROM this data; the A3
 * coverage guard asserts every field key here has exactly one adapter in
 * SettingsPanel (and vice-versa), mirroring the existing
 * `assertTierSchemaCoverage` pattern for tier flags.
 *
 * "Custom" sections (Modules, Signal Aliases) are NOT simple fields — they
 * render bespoke content (tier disclosure / alias editor) and declare
 * `custom` instead of `fields`. Their own contract is guarded separately
 * (Modules by `assertTierSchemaCoverage`).
 */

export type SettingKind = "switch" | "slider" | "select";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SettingFieldDef {
  /** Stable adapter key — the coverage token. */
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly kind: SettingKind;
  /** slider */
  readonly min?: number;
  readonly max?: number;
  readonly unit?: string;
  /** select */
  readonly options?: readonly SelectOption[];
  /** small pill after the name, e.g. "⌥P" (rendered mono). */
  readonly badge?: string;
  readonly badgeMono?: boolean;
  /** nested advanced row (indented, dim name). */
  readonly indent?: boolean;
  readonly advanced?: boolean;
}

export interface SettingsSectionDef {
  readonly id: string;
  readonly navLabel: string;
  readonly title: string;
  /** simple, coverage-tracked fields. Omitted for custom sections. */
  readonly fields?: readonly SettingFieldDef[];
  /** bespoke content instead of simple fields. */
  readonly custom?: "modules" | "aliases";
}

const THEME_OPTIONS: readonly SelectOption[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

const NOTE_COLOR_OPTIONS: readonly SelectOption[] = [
  { value: "off", label: "Off (track colour)" },
  { value: "velocity", label: "By velocity" },
];

const GRID_MODE_OPTIONS: readonly SelectOption[] = [
  { value: "exact", label: "Exact" },
  { value: "lcm", label: "LCM (shared grid)" },
];

const RULER_UNITS_OPTIONS: readonly SelectOption[] = [
  { value: "cycles", label: "Cycles" },
  { value: "bars", label: "Bars & beats" },
];

const VIZ_QUALITY_OPTIONS: readonly SelectOption[] = [
  { value: "high", label: "High" },
  { value: "balanced", label: "Balanced" },
  { value: "performance", label: "Performance" },
];

// Inline-viz render-resolution presets (#261). "custom" reveals a free
// number input in the panel. Kept here so both the panel and any future
// coverage checks share the list.
export const VIZ_RES_PRESETS = [256, 512, 768, 1024] as const;

const VIZ_RES_OPTIONS: readonly SelectOption[] = [
  ...VIZ_RES_PRESETS.map((p) => ({ value: String(p), label: `${p}px` })),
  { value: "custom", label: "Custom…" },
];

export const SECTION_DEFS: readonly SettingsSectionDef[] = [
  {
    id: "appearance",
    navLabel: "Appearance",
    title: "Appearance",
    fields: [
      { key: "theme", name: "Theme", description: "Editor colour theme, or follow the OS.", kind: "select", options: THEME_OPTIONS },
      { key: "fontSize", name: "Font size", description: "Size of the code text.", kind: "slider", min: 8, max: 32, unit: "px" },
      { key: "iconSize", name: "Icon size", description: "Toolbar and gutter icon scale.", kind: "slider", min: 10, max: 32, unit: "px" },
      { key: "minimap", name: "Minimap", description: "Show the code minimap on the right edge.", kind: "switch" },
      { key: "trackColourBar", name: "Track colour bar", description: "Per-track colour stripe on the left gutter.", kind: "switch" },
      { key: "menubarLcd", name: "Transport LCD", description: "Show the live transport readout (position, tempo, frame health) in the menubar's centre. Off shows the Stave Code label instead.", kind: "switch" },
    ],
  },
  {
    id: "pattern",
    navLabel: "Pattern & Timeline",
    title: "Pattern & Timeline",
    fields: [
      { key: "gridMode", name: "Grid", description: "Exact draws each part of a comma pattern at its own steps, and a click fills one of them. LCM cuts every row to one shared grid.", kind: "select", options: GRID_MODE_OPTIONS },
      { key: "noteColor", name: "Note colour", description: "How pattern-grid notes are coloured.", kind: "select", options: NOTE_COLOR_OPTIONS },
      { key: "rulerUnits", name: "Ruler units", description: "Timeline ruler numbering: Strudel cycles, or DAW-style bars & beats.", kind: "select", options: RULER_UNITS_OPTIONS },
      { key: "timelineSubRow", name: "Timeline sub-row height", description: "Height of expanded per-voice lanes.", kind: "slider", min: 12, max: 48, unit: "px" },
    ],
  },
  {
    id: "viz",
    navLabel: "Visualization",
    title: "Visualization",
    fields: [
      { key: "inlineVizButtons", name: "Inline viz buttons", description: "Size of the inline .viz() action icons.", kind: "slider", min: 8, max: 28, unit: "px" },
      { key: "vizPreviewHeight", name: "Preview height", description: "Height of the viz cards in the Asset Library (the thumbnail and live hover preview).", kind: "slider", min: 48, max: 200, unit: "px" },
      { key: "vizQuality", name: "Quality", description: "One preset scales viz resolution and detail together.", kind: "select", options: VIZ_QUALITY_OPTIONS },
      { key: "vizResolution", name: "Custom resolution", description: "Overrides the preset's render resolution.", kind: "select", options: VIZ_RES_OPTIONS, badge: "Advanced", indent: true, advanced: true },
      { key: "vizInputsLive", name: "Live values in viz inputs", description: "Show live master signal values in the Inputs drawer.", kind: "switch" },
    ],
  },
  {
    id: "perf",
    navLabel: "Performance",
    title: "Performance",
    fields: [
      { key: "perfOverlay", name: "Performance overlay", description: "Frame timings, sections and long-task overlay.", kind: "switch", badge: "⌥P", badgeMono: true },
      { key: "adaptivePerf", name: "Adaptive performance", description: "GPU-budget governor auto-throttles heavy viz to protect the frame rate.", kind: "switch" },
      { key: "vizTeardown", name: "Off-screen viz teardown", description: "Free memory and GPU contexts 60s after a viz scrolls off-screen.", kind: "switch" },
      { key: "playVizOnHover", name: "Play viz on hover", description: "In split panes, freeze non-focused backdrops and play them only while hovered — saves GPU with many panes. Off: every pane's backdrop stays live.", kind: "switch" },
    ],
  },
  {
    id: "sound",
    navLabel: "Sound",
    title: "Sound",
    fields: [
      { key: "takesPhoneAudio", name: "Play through the silent switch", description: "On a phone: Stave is heard with the ring/silent switch on, and music from other apps stops when you press Play. Off: other apps keep playing alongside Stave, and the silent switch mutes it.", kind: "switch" },
    ],
  },
  { id: "modules", navLabel: "Modules", title: "Strudel modules", custom: "modules" },
  { id: "aliases", navLabel: "Signal Aliases", title: "Signal Aliases", custom: "aliases" },
];

/** Flat list of every simple-field key across all sections (coverage token set). */
export const SETTING_FIELD_KEYS: readonly string[] = SECTION_DEFS.flatMap(
  (s) => s.fields?.map((f) => f.key) ?? [],
);
