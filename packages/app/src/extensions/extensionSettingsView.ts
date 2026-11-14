/**
 * #2556 — extension settings, as Settings › Extensions and an extension's page show them.
 *
 * Pure functions over the manifests, the switches and the settings store (`settings.ts` in
 * the editor package), so the rules are tested on their own. The model is VS Code's: one
 * Settings home; each extension's settings drawn by Stave under the extension's name; only
 * the extensions that are switched on; and the extension's page opens Settings filtered to
 * it with the same search box, spelled `@ext:<id>`.
 */
import {
  extensionSettings,
  type ExtensionManifest,
  type ExtensionSetting,
  type ExtensionSettingState,
} from "@stave/editor";

// ── the search box ────────────────────────────────────────────────────────────────────

const EXT_FILTER = /(^|\s)@ext:(\S+)/;

/** What the Settings search box asks for: maybe one extension (`@ext:<id>`), and the words to find. */
export interface SettingsQuery {
  /** `@ext:<id>`: only this extension's settings, and no other section */
  readonly extensionId: string | null;
  /** the rest of the search, lower case and trimmed; empty when there is none */
  readonly text: string;
}

export function parseSettingsQuery(query: string): SettingsQuery {
  const m = EXT_FILTER.exec(query);
  const rest = m ? query.slice(0, m.index) + " " + query.slice(m.index + m[0].length) : query;
  return { extensionId: m ? m[2] : null, text: rest.trim().toLowerCase() };
}

/** The search that opens Settings on one extension's settings: what its page's Settings button puts in the box. */
export function extensionSettingsQuery(extensionId: string): string {
  return `@ext:${extensionId}`;
}

/** Does a setting match the search words: its label or its description. */
export function settingMatches(setting: ExtensionSetting, text: string): boolean {
  if (!text) return true;
  return `${setting.label} ${setting.description}`.toLowerCase().includes(text);
}

// ── the groups ────────────────────────────────────────────────────────────────────────

/** One extension's group in Settings › Extensions: its name, then a row per setting. */
export interface ExtensionSettingsGroup {
  readonly manifest: ExtensionManifest;
  readonly rows: readonly ExtensionSettingState[];
}

/**
 * The groups to show: one per extension that is switched on and declares settings, in the
 * listed order; only the one `@ext:` names, if it names one; and only the settings the
 * search words match (all of them when the words match the extension's name). A group
 * left with no rows is not shown.
 */
export function extensionSettingGroups(
  manifests: readonly ExtensionManifest[],
  enabled: ReadonlySet<string>,
  query: SettingsQuery,
  read: (m: ExtensionManifest) => readonly ExtensionSettingState[] = extensionSettings,
): ExtensionSettingsGroup[] {
  const groups: ExtensionSettingsGroup[] = [];
  for (const m of manifests) {
    if (!enabled.has(m.id)) continue;
    if (query.extensionId !== null && query.extensionId !== m.id) continue;
    const all = read(m);
    if (!all.length) continue;
    const byName = query.text !== "" && m.name.toLowerCase().includes(query.text);
    const rows = byName ? all : all.filter((r) => settingMatches(r.setting, query.text));
    if (rows.length) groups.push({ manifest: m, rows });
  }
  return groups;
}

/**
 * Why Settings shows nothing for an `@ext:` search, in a sentence, or null when it shows
 * something (or there is no `@ext:`): the extension is switched off, has no settings, or
 * none match the words.
 */
export function emptyExtensionFilterLine(
  manifests: readonly ExtensionManifest[],
  enabled: ReadonlySet<string>,
  query: SettingsQuery,
  groups: readonly ExtensionSettingsGroup[],
  read: (m: ExtensionManifest) => readonly ExtensionSettingState[] = extensionSettings,
): string | null {
  if (query.extensionId === null || groups.length) return null;
  const m = manifests.find((x) => x.id === query.extensionId);
  if (!m) return `There is no extension called “${query.extensionId}”.`;
  if (!read(m).length) return `${m.name} has no settings.`;
  if (!enabled.has(m.id)) return `${m.name} is switched off. Switch it on to see and change its settings.`;
  return `None of ${m.name}’s settings match “${query.text}”.`;
}

// ── the extension's page ──────────────────────────────────────────────────────────────

/** A setting's default in words, as "What it adds" lists it. */
export function defaultText(setting: ExtensionSetting): string {
  switch (setting.type) {
    case "boolean":
      return setting.default ? "On" : "Off";
    case "choice":
      return setting.options.find((o) => o.value === setting.default)?.label ?? setting.default;
    case "number":
      return String(setting.default);
    case "text":
      return setting.default === "" ? "(empty)" : `“${setting.default}”`;
  }
}

/** What kind of setting it is, in a word or two. */
export function typeText(setting: ExtensionSetting): string {
  switch (setting.type) {
    case "boolean":
      return "on/off";
    case "choice":
      return "choice";
    case "number":
      return "number";
    case "text":
      return "text";
  }
}
