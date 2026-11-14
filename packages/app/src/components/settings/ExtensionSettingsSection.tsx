"use client";

/**
 * #2556 — Settings › Extensions: one group per switched-on extension that declares
 * settings, titled with its name, and one row per setting, drawn by Stave from the
 * manifest (an extension never draws its own settings UI). Each row uses the shell's own
 * row and controls, and can be put back to its default.
 *
 * Every change goes to the store (`setExtensionSetting`), which tells the running
 * extension at once (its host's `settings.onChange`) and every other place that shows it.
 */
import React, { useEffect, useState } from "react";
import { setExtensionSetting, type ExtensionManifest, type ExtensionSettingState } from "@stave/editor";
import { SettingRow } from "./SettingRow";
import { Switch } from "./Switch";
import type { ExtensionSettingsGroup } from "../../extensions/extensionSettingsView";
import { defaultText } from "../../extensions/extensionSettingsView";

/** A number box that keeps what is typed until it is a value the setting takes. */
function NumberSetting({
  manifest,
  row,
  testId,
}: {
  manifest: ExtensionManifest;
  row: ExtensionSettingState & { setting: { type: "number" } };
  testId: string;
}) {
  const { setting, value } = row;
  const [draft, setDraft] = useState(String(value));
  // a change from elsewhere (reset, another tab) shows here
  useEffect(() => setDraft(String(value)), [value]);
  const ok = (n: number) =>
    draft.trim() !== "" &&
    Number.isFinite(n) &&
    (setting.min === undefined || n >= setting.min) &&
    (setting.max === undefined || n <= setting.max);
  return (
    <input
      className={`numinput${ok(Number(draft)) ? "" : " err"}`}
      type="number"
      min={setting.min}
      max={setting.max}
      step={setting.step ?? 1}
      value={draft}
      aria-label={setting.label}
      data-testid={testId}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(n)) setExtensionSetting(manifest, setting.id, n);
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}

function Control({ manifest, row }: { manifest: ExtensionManifest; row: ExtensionSettingState }) {
  const { setting, value } = row;
  const testId = `ext-setting-${manifest.id}-${setting.id}`;
  switch (setting.type) {
    case "boolean":
      return (
        <Switch
          ariaLabel={setting.label}
          testId={testId}
          checked={value === true}
          onChange={(v) => setExtensionSetting(manifest, setting.id, v)}
        />
      );
    case "choice":
      return (
        <select
          value={String(value)}
          aria-label={setting.label}
          data-testid={testId}
          onChange={(e) => setExtensionSetting(manifest, setting.id, e.target.value)}
        >
          {setting.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "number":
      return <NumberSetting manifest={manifest} row={row as ExtensionSettingState & { setting: { type: "number" } }} testId={testId} />;
    case "text":
      return (
        <input
          className="textinput"
          type="text"
          value={String(value)}
          aria-label={setting.label}
          spellCheck={false}
          data-testid={testId}
          onChange={(e) => setExtensionSetting(manifest, setting.id, e.target.value)}
        />
      );
  }
}

export function ExtensionSettingsGroups({
  groups,
  emptyLine,
}: {
  groups: readonly ExtensionSettingsGroup[];
  /** what to say when there are no groups */
  emptyLine: string;
}) {
  if (!groups.length) {
    return (
      <div className="grp-note" data-testid="settings-ext-empty">
        {emptyLine}
      </div>
    );
  }
  return (
    <>
      {groups.map(({ manifest, rows }) => (
        <div className="ext-grp" key={manifest.id} data-testid={`settings-ext-group-${manifest.id}`}>
          <div className="ext-grp-title">{manifest.name}</div>
          {rows.map((row) => (
            <div
              key={row.setting.id}
              data-ext-setting={`${manifest.id}.${row.setting.id}`}
              data-default={row.isDefault ? "true" : "false"}
            >
              <SettingRow
                name={row.setting.label}
                description={row.setting.description}
                badge={row.isDefault ? undefined : <span className="badge">Changed</span>}
              >
                {row.isDefault ? null : (
                  <button
                    type="button"
                    className="ext-reset"
                    title={`Put back to the default (${defaultText(row.setting)})`}
                    aria-label={`Put ${row.setting.label} back to its default`}
                    data-testid={`ext-setting-reset-${manifest.id}-${row.setting.id}`}
                    onClick={() => setExtensionSetting(manifest, row.setting.id, null)}
                  >
                    ↺
                  </button>
                )}
                <Control manifest={manifest} row={row} />
              </SettingRow>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
