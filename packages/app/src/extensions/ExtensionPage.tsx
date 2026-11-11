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
 * The page's tab (Details / What it adds / Changes) is kept in the tab's state, so it
 * comes back after a reload.
 */
import React from "react";
import type { AppTabLabel, AppTabState, ExtensionManifest } from "@stave/editor";
import type { AppTab, AppTabDefinition } from "../components/appTabs";
import { Icon } from "../components/Icon";
import { addsOf, extensionTabKey, failedToStart, languagesLabel, leftoversOf, switchStateLine } from "./extensionsView";
import { useEnabledExtensions, useExtensionFailure } from "./useExtensionSwitches";
import { ExtensionBadges, ExtensionTile, SwitchButton } from "./ExtensionParts";

export type PageSection = "details" | "adds" | "changes";
const SECTIONS: readonly { id: PageSection; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "adds", label: "What it adds" },
  { id: "changes", label: "Changes" },
];

/** The section a tab's saved state names; anything else (it is untrusted) is Details. */
export function sectionOf(state: AppTabState | undefined): PageSection {
  const s = state && typeof state === "object" && !Array.isArray(state) ? (state as { section?: unknown }).section : null;
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
}: {
  manifest: ExtensionManifest;
  section: PageSection;
  onSection: (s: PageSection) => void;
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
        {SECTIONS.map((s) => (
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
      {/* #2513: the "Keyboard shortcuts" section goes here, once the given-back key
          setting exists: each declared key, what it does, "inside the code", and a toggle
          between the extension and Stave. */}
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

/** The app tabs for the listed extensions' pages, one per extension. */
export function extensionAppTabs(manifests: readonly ExtensionManifest[]): AppTabDefinition[] {
  return manifests.map((m) => ({
    key: extensionTabKey(m.id),
    label: (): AppTabLabel => ({ title: `Extension: ${m.name}`, icon: <Icon name="extensions" size={13} /> }),
    render: (tab: AppTab, ctx) => (
      <ExtensionPage
        manifest={m}
        section={sectionOf(tab.state)}
        onSection={(section) => ctx.setState({ section })}
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
  td: { textAlign: "left", padding: "7px 10px", borderBottom: "1px solid var(--border-subtle)", verticalAlign: "top", fontSize: 12.5, color: "var(--text-primary)" },
  kind: { color: "var(--text-secondary)", width: 170 },
  inlineCode: { fontFamily: mono, fontSize: "0.95em", color: "var(--accent-strong)" },
  ul: { margin: "0 0 14px", paddingLeft: 20, maxWidth: 640, color: "var(--text-secondary)" },
  li: { marginBottom: 6 },
  aside: { minWidth: 0 },
  dl: { margin: "0 0 20px", display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", fontSize: 12.5 },
  dt: { color: "var(--text-muted)" },
  dd: { margin: 0, color: "var(--text-secondary)" },
};
