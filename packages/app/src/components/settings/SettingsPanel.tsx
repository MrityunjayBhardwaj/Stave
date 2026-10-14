"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  getEditorFontSize,
  setEditorFontSize,
  getEditorMinimap,
  toggleEditorMinimap,
  getEditorUiIconSize,
  setEditorUiIconSize,
  getInlineVizActionSize,
  setInlineVizActionSize,
  getInlineVizResolution,
  setInlineVizResolution,
  getVizQuality,
  setVizQuality,
  type VizQualityLevel,
  getInlineVizTeardownEnabled,
  setInlineVizTeardownEnabled,
  getVizInputsLiveValuesEnabled,
  setVizInputsLiveValuesEnabled,
  getMusicalTimelineSubRowHeight,
  setMusicalTimelineSubRowHeight,
  getEditorTheme,
  setEditorTheme,
  getNoteColorMode,
  setNoteColorMode,
  type NoteColorMode,
  getGridMode,
  setGridMode,
  type GridMode,
  getTierFlags,
  setTierFlag,
  listTiers,
  getSignalAliases,
  setSignalAliases,
  getPerfEnabled,
  setPerfEnabled,
  getAdaptivePerfEnabled,
  setAdaptivePerfEnabled,
  getTrackColourBarsEnabled,
  setTrackColourBarsEnabled,
  getPlayVizOnHoverEnabled,
  setPlayVizOnHoverEnabled,
  type EditorTheme,
  type TierName,
} from "@stave/editor";
import {
  buildAliasMap,
  rowsFromAliasMap,
  type AliasRow,
  type AliasRowError,
} from "../signalAliasRows";
import { getRulerUnits, setRulerUnits, type RulerUnits } from "../../state/rulerUnits";
import { getMenubarLcdEnabled, setMenubarLcdEnabled } from "../../state/menubarLcd";
import { getTakesPhoneAudio, setTakesPhoneAudioSetting } from "../../state/takesPhoneAudio";
import { getVizPreviewHeight, setVizPreviewHeight } from "../../state/vizPreviewHeight";
import { Switch } from "./Switch";
import { SettingRow } from "./SettingRow";
import {
  SECTION_DEFS,
  SETTING_FIELD_KEYS,
  VIZ_RES_PRESETS,
  type SettingFieldDef,
  type SettingsSectionDef,
} from "./settingsSections";
import {
  IconAppearance,
  IconPattern,
  IconViz,
  IconPerf,
  IconModules,
  IconAliases,
} from "./icons";

type SettingValue = string | number | boolean;

interface SettingAdapter {
  get: () => SettingValue;
  set: (v: SettingValue) => void;
}

// The wiring side of the coverage contract (A3): every field key in
// SECTION_DEFS must have exactly one adapter here, and vice-versa. All
// getters read the source of truth (editorRegistry → localStorage), so a
// single `tick` re-render reflects any write — no per-field useState.
const ADAPTERS: Record<string, SettingAdapter> = {
  theme: { get: getEditorTheme, set: (v) => setEditorTheme(v as EditorTheme) },
  fontSize: { get: getEditorFontSize, set: (v) => setEditorFontSize(Number(v)) },
  iconSize: { get: getEditorUiIconSize, set: (v) => setEditorUiIconSize(Number(v)) },
  minimap: {
    get: getEditorMinimap,
    // Only a toggle exists; flip only when the target differs.
    set: (v) => { if (Boolean(v) !== getEditorMinimap()) toggleEditorMinimap(); },
  },
  trackColourBar: { get: getTrackColourBarsEnabled, set: (v) => setTrackColourBarsEnabled(Boolean(v)) },
  menubarLcd: { get: getMenubarLcdEnabled, set: (v) => setMenubarLcdEnabled(Boolean(v)) },
  takesPhoneAudio: { get: getTakesPhoneAudio, set: (v) => setTakesPhoneAudioSetting(Boolean(v)) },
  gridMode: { get: getGridMode, set: (v) => setGridMode(v as GridMode) },
  noteColor: { get: getNoteColorMode, set: (v) => setNoteColorMode(v as NoteColorMode) },
  rulerUnits: { get: getRulerUnits, set: (v) => setRulerUnits(v as RulerUnits) },
  timelineSubRow: { get: getMusicalTimelineSubRowHeight, set: (v) => setMusicalTimelineSubRowHeight(Number(v)) },
  inlineVizButtons: { get: getInlineVizActionSize, set: (v) => setInlineVizActionSize(Number(v)) },
  vizPreviewHeight: { get: getVizPreviewHeight, set: (v) => setVizPreviewHeight(Number(v)) },
  vizQuality: { get: getVizQuality, set: (v) => setVizQuality(v as VizQualityLevel) },
  vizResolution: { get: getInlineVizResolution, set: (v) => setInlineVizResolution(Number(v)) },
  vizInputsLive: { get: getVizInputsLiveValuesEnabled, set: (v) => setVizInputsLiveValuesEnabled(Boolean(v)) },
  perfOverlay: { get: getPerfEnabled, set: (v) => setPerfEnabled(Boolean(v)) },
  adaptivePerf: { get: getAdaptivePerfEnabled, set: (v) => setAdaptivePerfEnabled(Boolean(v)) },
  vizTeardown: { get: getInlineVizTeardownEnabled, set: (v) => setInlineVizTeardownEnabled(Boolean(v)) },
  playVizOnHover: { get: getPlayVizOnHoverEnabled, set: (v) => setPlayVizOnHoverEnabled(Boolean(v)) },
};

/** Adapter key set — exported for the A3 coverage test. */
export const ADAPTER_KEYS: readonly string[] = Object.keys(ADAPTERS);

const NAV_ICONS: Record<string, () => React.ReactElement> = {
  appearance: IconAppearance,
  pattern: IconPattern,
  viz: IconViz,
  perf: IconPerf,
  modules: IconModules,
  aliases: IconAliases,
};

// Strudel modules tier UI (Phase 20-14 β-3). MIDI is the only wired row;
// the other 7 render disabled behind a disclosure. One follow-up issue per
// row. Mirrors the legacy modal's TIER_ROWS.
interface TierRow {
  name: TierName;
  label: string;
  description: string;
  issueNumber: number | null;
  interactive: boolean;
  sizeHint?: string;
}

const TIER_ROWS: TierRow[] = [
  { name: "midi", label: "MIDI", description: "Web MIDI output — reference a device by name in .midi(). Prompts for browser permission on the next reload.", issueNumber: null, interactive: true },
  { name: "csound", label: "Csound", description: "Csound synthesis · loads ~6 MB", issueNumber: 124, interactive: false },
  { name: "tidal", label: "TidalCycles", description: "Haskell-via-WASM interop · loads ~6 MB", issueNumber: 125, interactive: false },
  { name: "osc", label: "OSC", description: "Send OSC (needs a SuperCollider backend)", issueNumber: 126, interactive: false },
  { name: "serial", label: "Serial", description: "WebSerial to microcontrollers / Eurorack", issueNumber: 127, interactive: false },
  { name: "gamepad", label: "Gamepad", description: "Read gamepad input as pattern values", issueNumber: 128, interactive: false },
  { name: "motion", label: "Motion", description: "Accelerometer / gyro input", issueNumber: 129, interactive: false },
  { name: "mqtt", label: "MQTT", description: "MQTT broker pub/sub", issueNumber: 130, interactive: false },
];

// Schema-vs-UI safety: warn at dev time if listTiers() drifts from TIER_ROWS.
function assertTierSchemaCoverage(): void {
  if (typeof window === "undefined") return;
  const declared = new Set(listTiers());
  const wired = new Set(TIER_ROWS.map((r) => r.name));
  for (const n of declared) {
    if (!wired.has(n)) console.warn(`[SettingsPanel] tier "${n}" missing from TIER_ROWS — UI will not surface it.`);
  }
  for (const n of wired) {
    if (!declared.has(n)) console.warn(`[SettingsPanel] tier "${n}" is in TIER_ROWS but not in listTiers() schema.`);
  }
}

// Extra searchable keywords for the custom sections (they have no simple
// fields to match against).
const CUSTOM_KEYWORDS: Record<string, string> = {
  modules: "strudel modules midi csound tidalcycles osc serial gamepad motion mqtt backend",
  aliases: "signal alias sound name kick snare",
};

function fieldMatches(f: SettingFieldDef, q: string): boolean {
  return `${f.name} ${f.description ?? ""}`.toLowerCase().includes(q);
}

function sectionMatches(sec: SettingsSectionDef, q: string): boolean {
  if (sec.title.toLowerCase().includes(q)) return true;
  if (sec.fields?.some((f) => fieldMatches(f, q))) return true;
  if (sec.custom && (CUSTOM_KEYWORDS[sec.custom] ?? "").includes(q)) return true;
  return false;
}

interface SettingsPanelProps {
  query: string;
}

/**
 * The Settings surface (#739 A2) — nav + content inside the shell pane.
 * Renders controls from the declarative SECTION_DEFS; custom sections
 * (Modules, Signal Aliases) render bespoke content. Search filters rows
 * across sections; with no query, only the nav-selected section shows.
 */
export function SettingsPanel({ query }: SettingsPanelProps) {
  const [, force] = useState(0);
  const tick = () => force((t) => t + 1);
  const [activeSection, setActiveSection] = useState(SECTION_DEFS[0].id);
  // vizResolution "custom" mode — sticky free-entry when the value isn't a preset.
  const [resCustom, setResCustom] = useState(() => !VIZ_RES_PRESETS.includes(getInlineVizResolution() as 256));
  const [modulesOpen, setModulesOpen] = useState(false);

  // Signal Aliases edit buffer (the only genuine local state — the persisted
  // shape is a map; the editable shape is a list of rows).
  const [aliasRows, setAliasRows] = useState<AliasRow[]>(() => rowsFromAliasMap(getSignalAliases()));
  const [aliasErrors, setAliasErrors] = useState<AliasRowError[]>(() =>
    rowsFromAliasMap(getSignalAliases()).map(() => null),
  );

  useEffect(() => {
    assertTierSchemaCoverage();
  }, []);

  const commitAliasRows = (next: AliasRow[]) => {
    const { map, errors } = buildAliasMap(next);
    setAliasRows(next);
    setAliasErrors(errors);
    setSignalAliases(map);
  };

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  // Which sections to show, and (when searching) which fields within.
  const visibleSections = useMemo(() => {
    if (!searching) return SECTION_DEFS.filter((s) => s.id === activeSection);
    return SECTION_DEFS.filter((s) => sectionMatches(s, q));
  }, [searching, q, activeSection]);

  const renderControl = (f: SettingFieldDef): React.ReactNode => {
    const a = ADAPTERS[f.key];
    if (f.kind === "switch") {
      return (
        <Switch
          ariaLabel={f.name}
          testId={`setting-${f.key}`}
          checked={Boolean(a.get())}
          onChange={(v) => { a.set(v); tick(); }}
        />
      );
    }
    if (f.kind === "slider") {
      const v = Number(a.get());
      return (
        <div className="slider">
          <input
            type="range"
            min={f.min}
            max={f.max}
            value={v}
            aria-label={f.name}
            data-testid={`setting-${f.key}`}
            onChange={(e) => { a.set(Number(e.target.value)); tick(); }}
          />
          <span className="val">{v}{f.unit ?? ""}</span>
        </div>
      );
    }
    // select
    if (f.key === "vizResolution") {
      const res = Number(getInlineVizResolution());
      const asPreset = VIZ_RES_PRESETS.includes(res as 256);
      const selectValue = resCustom || !asPreset ? "custom" : String(res);
      return (
        <>
          <select
            value={selectValue}
            aria-label={f.name}
            data-testid={`setting-${f.key}`}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") { setResCustom(true); return; }
              setResCustom(false);
              setInlineVizResolution(Number(v));
              tick();
            }}
          >
            {f.options!.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {resCustom || !asPreset ? (
            <input
              className="numinput"
              type="number"
              min={64}
              max={2048}
              value={res}
              aria-label="Custom inline viz resolution"
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 64 && n <= 2048) { setInlineVizResolution(n); tick(); }
              }}
            />
          ) : null}
        </>
      );
    }
    const v = String(a.get());
    return (
      <select
        value={v}
        aria-label={f.name}
        data-testid={`setting-${f.key}`}
        onChange={(e) => {
          a.set(e.target.value);
          // Quality also writes the resolution — reflect it + drop custom mode.
          if (f.key === "vizQuality") setResCustom(false);
          tick();
        }}
      >
        {f.options!.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  };

  const renderField = (f: SettingFieldDef): React.ReactNode => {
    if (searching && !fieldMatches(f, q)) return null;
    const badge = f.badge ? (
      <span className={`badge${f.badgeMono ? " mono" : ""}`}>{f.badge}</span>
    ) : undefined;
    return (
      <SettingRow
        key={f.key}
        name={f.name}
        description={f.description}
        badge={badge}
        indent={f.indent}
        dimName={f.advanced}
      >
        {renderControl(f)}
      </SettingRow>
    );
  };

  const renderModules = (): React.ReactNode => {
    const flags = getTierFlags();
    const midi = TIER_ROWS[0];
    const rest = TIER_ROWS.slice(1);
    return (
      <>
        <div className="grp-note">Extra output backends. Enabling one loads it on the next reload.</div>
        <SettingRow name={midi.label} description={midi.description}>
          <Switch
            ariaLabel={midi.label}
            testId="tier-midi"
            checked={flags?.midi ?? false}
            onChange={(v) => { setTierFlag("midi", v); tick(); }}
          />
        </SettingRow>
        <div className="disclosure">
          <button className="disc-btn" aria-expanded={modulesOpen} onClick={() => setModulesOpen((o) => !o)}>
            <span className="chev">▸</span> Not yet available{" "}
            <span style={{ color: "var(--s-text-3)" }}>({rest.length})</span>
          </button>
          {modulesOpen ? (
            <div className="disc-body">
              {rest.map((row) => (
                <div key={row.name} className="modrow">
                  <div className="mname">{row.label}</div>
                  <div className="mdesc">{row.description}</div>
                  <span className="lock">{row.issueNumber ? `Planned · #${row.issueNumber}` : "Planned"}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </>
    );
  };

  const renderAliases = (): React.ReactNode => (
    <>
      <div className="grp-note">
        Name a signal over one or more sounds — use it in any viz as <code>kick</code> or{" "}
        <code>u(&apos;kick&apos;)</code>. The name stays the same across engines.
      </div>
      {aliasRows.map((row, i) => {
        const err = aliasErrors[i] ?? null;
        return (
          <div key={i}>
            <div className="alias">
              <input
                className={`an${err === "name" ? " err" : ""}`}
                placeholder="name"
                value={row.name}
                aria-label={`Alias name ${i + 1}`}
                onChange={(e) => commitAliasRows(aliasRows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
              />
              <span className="arrow">→</span>
              <input
                className={`as${err === "sounds" ? " err" : ""}`}
                placeholder="bd, kick9"
                value={row.sounds}
                aria-label={`Alias sounds ${i + 1}`}
                onChange={(e) => commitAliasRows(aliasRows.map((r, j) => (j === i ? { ...r, sounds: e.target.value } : r)))}
              />
              <button className="del" aria-label={`Remove alias ${i + 1}`} title="Remove alias" onClick={() => commitAliasRows(aliasRows.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
            {err === "name" ? <div className="alias-err">Name must be a single word (letters, digits, _ or $) and not a built-in alias.</div> : null}
            {err === "sounds" ? <div className="alias-err">Add at least one sound name.</div> : null}
          </div>
        );
      })}
      <button className="addbtn" onClick={() => commitAliasRows([...aliasRows, { name: "", sounds: "" }])}>
        + Add alias
      </button>
    </>
  );

  const renderSectionBody = (sec: SettingsSectionDef): React.ReactNode => {
    if (sec.custom === "modules") return renderModules();
    if (sec.custom === "aliases") return renderAliases();
    return sec.fields!.map(renderField);
  };

  return (
    <>
      <nav className="nav">
        <div className="nav-eyebrow">Editor</div>
        {SECTION_DEFS.map((sec) => {
          const Icon = NAV_ICONS[sec.id];
          return (
            <button
              key={sec.id}
              className="nav-item"
              aria-current={!searching && sec.id === activeSection}
              data-testid={`settings-nav-${sec.id}`}
              onClick={() => setActiveSection(sec.id)}
            >
              {Icon ? <Icon /> : null}
              <span>{sec.navLabel}</span>
            </button>
          );
        })}
      </nav>

      <div className="content" tabIndex={-1} data-testid="settings-content">
        {visibleSections.length === 0 ? (
          <div className="empty">No settings match “{query}”.</div>
        ) : (
          visibleSections.map((sec) => (
            <section className="grp" key={sec.id} data-testid={`settings-section-${sec.id}`}>
              <div className="grp-head">
                <div className="grp-title">{sec.title}</div>
                {sec.custom === "modules" ? <span className="badge reload">Reload required</span> : null}
              </div>
              {renderSectionBody(sec)}
            </section>
          ))
        )}
      </div>
    </>
  );
}

// Re-export for the A3 coverage test without reaching into internals.
export { SETTING_FIELD_KEYS };
