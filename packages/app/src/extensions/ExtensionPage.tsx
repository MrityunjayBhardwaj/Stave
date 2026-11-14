"use client";

/**
 * #2511 — an extension's own page, opened as a workspace tab (like a file tab) when its
 * row in the Extensions view is clicked. One tab per extension (`extension:<id>`).
 *
 * Header: tile, name, badges, "Stave · Built into Stave · version · languages", what it
 * is, and the Switch button with its state. Tabs: Details (its readme), What it adds (read
 * from the manifest, so the same while it is off) and Changes. "What it adds" ends with a
 * "When switched off" note: the host's list of what cannot be undone, in plain words
 * (`LEFTOVER_TEXT`). Switched on but failed to start, the badge and the state line say so
 * (#2552).
 *
 * #2545 — an extension that declares keys has a Keys tab too: each key, what it does in
 * the extension, and a toggle "Give back to Stave" / "Use in <extension>". It is the same
 * setting Keyboard Shortcuts shows on the extension's rows (`toggleExtensionKey`), so the
 * two always agree, with no reload. It works while the extension is off too: the choice is
 * kept and applies when it is switched on.
 *
 * #2556 — an extension that declares settings has a "Settings" button by its switch, which
 * opens Settings filtered to it (`@ext:<id>` in the search box, as VS Code does), and
 * "What it adds" lists each setting with its default. Stave draws the settings themselves
 * in Settings › Extensions; the page never does.
 *
 * The page's tab (Details / What it adds / Keys / Changes) is kept in the tab's state, so
 * it comes back after a reload.
 */
import React from "react";
import { declaredSettings, extensionKeys, type AppTabLabel, type AppTabState, type ExtensionManifest } from "@stave/editor";
import type { AppTab, AppTabDefinition } from "../components/appTabs";
import { Icon } from "../components/Icon";
import { addsOf, extensionTabKey, failedToStart, languagesLabel, leftoversOf, switchStateLine } from "./extensionsView";
import { useEnabledExtensions, useExtensionFailure } from "./useExtensionSwitches";
import { ExtensionBadges, ExtensionTile, SwitchButton } from "./ExtensionParts";
import { toggleAriaLabel, toggleExtensionKey, toggleLabel, whereLine } from "./extensionKeysView";
import { useGivenBackVersion } from "./useExtensionKeys";
import { keybindingTokens } from "../commands/keybindings";
import { defaultText, typeText } from "./extensionSettingsView";

export type PageSection = "details" | "adds" | "keys" | "changes";
const SECTIONS: readonly { id: PageSection; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "adds", label: "What it adds" },
  { id: "keys", label: "Keys" },
  { id: "changes", label: "Changes" },
];

/** Does it declare keys? Only then does its page have a Keys tab. */
function hasKeys(m: ExtensionManifest): boolean {
  return (m.provides?.keys?.length ?? 0) > 0;
}

/** The tabs this extension's page shows: Keys only when it declares keys. */
export function sectionsOf(m: ExtensionManifest): readonly { id: PageSection; label: string }[] {
  return SECTIONS.filter((s) => s.id !== "keys" || hasKeys(m));
}

/**
 * The section a tab's saved state names; anything else (it is untrusted) is Details.
 * Keys counts only for an extension that has a Keys tab.
 */
export function sectionOf(state: AppTabState | undefined, m?: ExtensionManifest): PageSection {
  const s = state && typeof state === "object" && !Array.isArray(state) ? (state as { section?: unknown }).section : null;
  if (s === "keys") return m && hasKeys(m) ? "keys" : "details";
  return s === "adds" || s === "changes" ? s : "details";
}

/** Text with `backticked` parts drawn as code, first letter capitalised. */
function withCode(text: string): React.ReactNode[] {
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return sentence.split("`").map((part, i) => (i % 2 ? <code key={i} style={styles.inlineCode}>{part}</code> : part));
}

export function ExtensionPage({
  manifest,
  section,
  onSection,
  onOpenSettings,
}: {
  manifest: ExtensionManifest;
  section: PageSection;
  onSection: (s: PageSection) => void;
  /** #2556 — open Settings filtered to this extension; the button shows only when it declares settings */
  onOpenSettings?: () => void;
}) {
  const on = useEnabledExtensions().has(manifest.id);
  const failure = useExtensionFailure(manifest.id);
  const failed = failedToStart(on, failure);
  const about = manifest.about;
  const languages = languagesLabel(manifest.languages);
  return (
    <div
      style={styles.root}
      data-extension-page={manifest.id}
      data-on={on ? "true" : "false"}
      data-failed={failed ? "true" : undefined}
    >
      <div style={styles.hero}>
        <ExtensionTile manifest={manifest} size={88} />
        <div style={{ minWidth: 0 }}>
          <h1 style={styles.h1}>
            {manifest.name}
            <ExtensionBadges experimental={about?.experimental === true} on={on} failed={failed} />
          </h1>
          <div style={styles.meta}>
            <span>Stave</span>
            <Sep />
            <span>Built into Stave</span>
            {about?.version && (
              <>
                <Sep />
                <span>v{about.version}</span>
              </>
            )}
            <Sep />
            <span data-extension-languages={manifest.id}>{languages}</span>
          </div>
          <p style={styles.summary}>{about?.summary ?? manifest.description}</p>
          <div style={styles.actions}>
            <SwitchButton id={manifest.id} name={manifest.name} on={on} large where="page" />
            {onOpenSettings && declaredSettings(manifest).length > 0 && (
              <button
                type="button"
                style={styles.settingsButton}
                data-extension-settings-button={manifest.id}
                aria-label={`Open ${manifest.name}’s settings`}
                title={on ? `Open Settings on ${manifest.name}’s settings` : `${manifest.name} is off: switch it on to change its settings`}
                onClick={onOpenSettings}
              >
                Settings
              </button>
            )}
            <span
              style={{ ...styles.state, ...(failed ? styles.stateFailed : null) }}
              data-extension-state={manifest.id}
              role={failed ? "alert" : undefined}
            >
              {switchStateLine(on, failure)}
            </span>
          </div>
          {/* #2512: "This project needs it", quoting what the run reported, goes here. */}
        </div>
      </div>

      <div style={styles.tabs} role="tablist">
        {sectionsOf(manifest).map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            data-extension-section={s.id}
            style={{ ...styles.tab, ...(section === s.id ? styles.tabOn : null) }}
            onClick={() => onSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div style={styles.cols}>
        <div style={{ minWidth: 0 }} role="tabpanel">
          {section === "details" && <Details manifest={manifest} />}
          {section === "adds" && <Adds manifest={manifest} />}
          {section === "keys" && hasKeys(manifest) && <Keys manifest={manifest} />}
          {section === "changes" && <Changes manifest={manifest} />}
        </div>
        <aside style={styles.aside}>
          <h3 style={styles.h3}>Extension</h3>
          <dl style={styles.dl}>
            <dt style={styles.dt}>Made by</dt>
            <dd style={styles.dd}>Stave</dd>
            {about?.version && (
              <>
                <dt style={styles.dt}>Version</dt>
                <dd style={styles.dd}>{about.version}</dd>
              </>
            )}
            <dt style={styles.dt}>Languages</dt>
            <dd style={styles.dd}>{languages}</dd>
            <dt style={styles.dt}>Status</dt>
            <dd style={{ ...styles.dd, ...(failed ? styles.stateFailed : null) }} data-extension-status={manifest.id}>
              {failed ? "Couldn't switch on" : on ? "On" : "Off"}
            </dd>
            <dt style={styles.dt}>Switched</dt>
            <dd style={styles.dd}>for you, in this browser</dd>
          </dl>
        </aside>
      </div>
    </div>
  );
}

function Sep() {
  return <span style={styles.sep}>|</span>;
}

function Details({ manifest }: { manifest: ExtensionManifest }) {
  const readme = manifest.about?.readme ?? [];
  if (!readme.length) return <p style={styles.p}>{manifest.description}</p>;
  return (
    <div data-extension-details>
      {readme.map((r) => (
        <section key={r.heading}>
          <h2 style={styles.h2}>{r.heading}</h2>
          <p style={styles.p}>{r.text}</p>
          {r.code && <pre style={styles.pre}>{r.code}</pre>}
        </section>
      ))}
    </div>
  );
}

function Adds({ manifest }: { manifest: ExtensionManifest }) {
  const lines = addsOf(manifest);
  const leftovers = leftoversOf(manifest);
  return (
    <div data-extension-adds>
      <table style={styles.table}>
        <tbody>
          {lines.map((l) => (
            <tr key={l.kind} data-adds-kind={l.kind}>
              <td style={{ ...styles.td, ...styles.kind }}>{l.kind}</td>
              <td style={styles.td}>
                {l.names?.map((n, i) => (
                  <React.Fragment key={n}>
                    {i > 0 && ", "}
                    <code style={styles.inlineCode}>{n}</code>
                  </React.Fragment>
                ))}
                {l.names && l.text && " — "}
                {l.text}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AddsSettings manifest={manifest} />
      <h2 style={styles.h2}>When switched off</h2>
      {leftovers.length ? (
        <div data-extension-leftovers>
          <p style={styles.p}>Switching it off removes what it added at once, except:</p>
          <ul style={styles.ul}>
            {leftovers.map((n) => (
              <li key={n.text} style={styles.li}>
                {n.names.length > 0 && (
                  <>
                    {n.names.map((name, i) => (
                      <React.Fragment key={name}>
                        {i > 0 && ", "}
                        <code style={styles.inlineCode}>{name}</code>
                      </React.Fragment>
                    ))}
                    {": "}
                  </>
                )}
                {withCode(n.text)}.
              </li>
            ))}
          </ul>
          <p style={styles.p}>A reload clears all of it.</p>
        </div>
      ) : (
        <p style={styles.p} data-extension-leftovers="none">
          Nothing stays behind: switching it off removes everything it added, at once.
        </p>
      )}
    </div>
  );
}

/** #2556 — the settings it declares, each with its kind and its default. */
function AddsSettings({ manifest }: { manifest: ExtensionManifest }) {
  const settings = declaredSettings(manifest);
  if (!settings.length) return null;
  return (
    <div data-extension-adds-settings={manifest.id}>
      <h2 style={styles.h2}>Settings</h2>
      <p style={styles.p}>Change them in Settings › Extensions, under {manifest.name}, while it is on.</p>
      <table style={styles.table}>
        <tbody>
          <tr>
            <th style={styles.th}>Setting</th>
            <th style={styles.th}>Kind</th>
            <th style={styles.th}>Default</th>
          </tr>
          {settings.map((s) => (
            <tr key={s.id} data-adds-setting={s.id}>
              <td style={styles.td}>
                <div>{s.label}</div>
                <div style={styles.where}>{s.description}</div>
              </td>
              <td style={{ ...styles.td, color: "var(--text-secondary)", width: 90 }}>{typeText(s)}</td>
              <td style={{ ...styles.td, width: 150 }} data-adds-setting-default={s.id}>
                {defaultText(s)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * #2545 — the keys it declares, each with the toggle between it and Stave. Reads the
 * setting fresh on every change to it, from here or from Keyboard Shortcuts.
 */
function Keys({ manifest }: { manifest: ExtensionManifest }) {
  useGivenBackVersion();
  const keys = extensionKeys(manifest);
  const name = manifest.name;
  return (
    <div data-extension-keys={manifest.id}>
      <p style={styles.p}>
        The keys {name} uses inside the code while it is on. Give one back and Stave’s own command for that key runs
        there instead. Settings › Keyboard Shortcuts shows the same keys, under {name}, with the same choice. Your own
        shortcuts are never changed.
      </p>
      <table style={styles.table}>
        <tbody>
          {keys.map((k) => (
            <tr key={k.key} data-extension-key={k.key} data-given-back={k.givenBack ? "true" : "false"}>
              <td style={{ ...styles.td, width: 130 }}>
                {keybindingTokens(k.key).map((t, i) => (
                  <kbd key={i} style={styles.kbd}>
                    {t}
                  </kbd>
                ))}
              </td>
              <td style={styles.td}>
                <div style={k.givenBack ? styles.given : undefined}>{k.name}</div>
                <div style={styles.where} data-extension-key-where={k.key}>
                  inside the code · {whereLine(k.givenBack, name)}
                  {k.givenBack === k.givenBackByDefault ? "" : " (your choice)"}
                </div>
              </td>
              <td style={{ ...styles.td, textAlign: "right", width: 150 }}>
                <button
                  type="button"
                  style={styles.keyToggle}
                  aria-label={toggleAriaLabel(k.givenBack, k.key, name)}
                  data-extension-key-toggle={k.key}
                  onClick={() => toggleExtensionKey(k, manifest.id)}
                >
                  {toggleLabel(k.givenBack, name)}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Changes({ manifest }: { manifest: ExtensionManifest }) {
  const changes = manifest.about?.changes ?? [];
  if (!changes.length) return <p style={styles.p}>No changes listed yet.</p>;
  return (
    <div data-extension-changes>
      {changes.map((c) => (
        <p key={c.version} style={styles.p}>
          <b style={{ color: "var(--text-primary)" }}>{c.version}</b> — {c.note}
        </p>
      ))}
    </div>
  );
}

/**
 * The app tabs for the listed extensions' pages, one per extension. `openSettings` (#2556)
 * opens Settings filtered to an extension, for its page's Settings button.
 */
export function extensionAppTabs(
  manifests: readonly ExtensionManifest[],
  opts: { openSettings?: (extensionId: string) => void } = {},
): AppTabDefinition[] {
  return manifests.map((m) => ({
    key: extensionTabKey(m.id),
    label: (): AppTabLabel => ({ title: `Extension: ${m.name}`, icon: <Icon name="extensions" size={13} /> }),
    render: (tab: AppTab, ctx) => (
      <ExtensionPage
        manifest={m}
        section={sectionOf(tab.state, m)}
        onSection={(section) => ctx.setState({ section })}
        onOpenSettings={opts.openSettings ? () => opts.openSettings!(m.id) : undefined}
      />
    ),
  }));
}

const mono = "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace";

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: "absolute",
    inset: 0,
    overflow: "auto",
    padding: "28px 40px 40px",
    background: "var(--bg-app, var(--bg-panel))",
    color: "var(--text-primary)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: 13,
    lineHeight: 1.45,
  },
  hero: {
    display: "flex",
    gap: 22,
    alignItems: "flex-start",
    paddingBottom: 20,
    borderBottom: "1px solid var(--border-subtle)",
  },
  h1: { margin: 0, fontSize: 24, fontWeight: 600, display: "flex", alignItems: "center", gap: 10 },
  meta: { color: "var(--text-muted)", fontSize: 12, margin: "4px 0 8px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  sep: { color: "var(--border-strong)" },
  summary: { margin: "0 0 14px", color: "var(--text-secondary)", fontSize: 14, maxWidth: 640 },
  actions: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  state: { fontSize: 12, color: "var(--text-muted)" },
  stateFailed: { color: "var(--danger-fg)" },
  tabs: { display: "flex", gap: 22, borderBottom: "1px solid var(--border-subtle)", margin: "6px 0 20px" },
  tab: {
    background: "none",
    // Longhands only, so `tabOn`'s colour does not mix with a shorthand on re-render (React warns).
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 2,
    borderBottomStyle: "solid",
    borderBottomColor: "transparent",
    padding: "12px 0 10px",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 12.5,
    fontFamily: "inherit",
  },
  tabOn: { color: "var(--text-primary)", borderBottomColor: "var(--accent-strong)" },
  cols: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 240px", gap: 36, maxWidth: 1100 },
  h2: { fontSize: 15, margin: "0 0 8px", fontWeight: 600 },
  h3: { fontSize: 11, letterSpacing: 0.9, color: "var(--text-muted)", textTransform: "uppercase", margin: "0 0 8px" },
  p: { color: "var(--text-secondary)", margin: "0 0 14px", maxWidth: 640 },
  pre: {
    margin: "0 0 18px",
    background: "var(--bg-chrome)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    padding: "12px 14px",
    fontFamily: mono,
    fontSize: 12.5,
    lineHeight: 1.6,
    color: "var(--text-primary)",
    overflow: "auto",
  },
  table: { borderCollapse: "collapse", width: "100%", maxWidth: 680, marginBottom: 22 },
  th: {
    textAlign: "left",
    padding: "6px 10px",
    borderBottom: "1px solid var(--border-subtle)",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  settingsButton: {
    background: "transparent",
    border: "1px solid var(--border-strong)",
    borderRadius: 3,
    padding: "6px 16px",
    fontSize: 12.5,
    color: "var(--text-secondary)",
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  },
  td: { textAlign: "left", padding: "7px 10px", borderBottom: "1px solid var(--border-subtle)", verticalAlign: "top", fontSize: 12.5, color: "var(--text-primary)" },
  kind: { color: "var(--text-secondary)", width: 170 },
  inlineCode: { fontFamily: mono, fontSize: "0.95em", color: "var(--accent-strong)" },
  ul: { margin: "0 0 14px", paddingLeft: 20, maxWidth: 640, color: "var(--text-secondary)" },
  li: { marginBottom: 6 },
  aside: { minWidth: 0 },
  kbd: {
    fontFamily: mono,
    fontSize: 11,
    lineHeight: 1,
    color: "var(--text-primary)",
    background: "var(--bg-chrome)",
    border: "1px solid var(--border-subtle)",
    borderBottomWidth: 2,
    borderRadius: 5,
    padding: "4px 7px",
    marginRight: 4,
    display: "inline-block",
    minWidth: 22,
    textAlign: "center",
  },
  where: { fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 },
  given: { color: "var(--text-secondary)" },
  keyToggle: {
    background: "none",
    border: "1px solid var(--border-subtle)",
    borderRadius: 5,
    padding: "4px 10px",
    color: "var(--accent-strong)",
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  },
  dl: { margin: "0 0 20px", display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", fontSize: 12.5 },
  dt: { color: "var(--text-muted)" },
  dd: { margin: 0, color: "var(--text-secondary)" },
};
