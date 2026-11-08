/**
 * #2473 — the app's workspace tabs that show no file (the gallery today; later
 * release notes, an extension's page), in one table.
 *
 * The shell needs three things to show such a tab: the body (`renderAppTab`),
 * its label (`appTabLabel`), and the keys it may bring back from a saved layout
 * (`validAppKeys` — a key missing there is dropped on reload). Built here from
 * one list, so adding a tab is adding one entry, and the three can't disagree.
 *
 * Each entry's body and label read the tab's own `state` (where you are inside
 * it), which comes back from localStorage: check it as untrusted input.
 */
import type { JSX } from "react";
import type { AppTabLabel, AppTabState, WorkspaceShellHandle, WorkspaceTab } from "@stave/editor";

export type AppTab = WorkspaceTab & { kind: "app" };

/** What a tab's body gets from the shell besides the tab itself. */
export interface AppTabContext {
  /**
   * Save where you are inside the tab, so it comes back after a reload. Each
   * write re-fires the shell's active-tab change: call it when the place
   * changes, not on every render.
   */
  setState(state: AppTabState | undefined): void;
}

export interface AppTabDefinition {
  /** The tab's key among app tabs; at most one tab per key is open. */
  key: string;
  /** Draws the body. Called only while the tab is in front; switching away unmounts it. */
  render(tab: AppTab, ctx: AppTabContext): JSX.Element | null;
  /** The tab's title (and icon), e.g. from where you are inside it. */
  label(tab: AppTab): AppTabLabel;
}

export interface AppTabShellProps {
  renderAppTab: (tab: AppTab) => JSX.Element | null;
  appTabLabel: (tab: AppTab) => AppTabLabel | undefined;
  validAppKeys: ReadonlySet<string>;
}

/** The shell's three app-tab props, from the table. Throws on a key listed twice. */
export function appTabShellProps(
  definitions: readonly AppTabDefinition[],
  shellRef: { readonly current: WorkspaceShellHandle | null },
): AppTabShellProps {
  const byKey = new Map<string, AppTabDefinition>();
  for (const d of definitions) {
    if (byKey.has(d.key)) throw new Error(`App tab "${d.key}" is defined twice.`);
    byKey.set(d.key, d);
  }
  return {
    renderAppTab: (tab) => {
      const d = byKey.get(tab.appKey);
      return d ? d.render(tab, { setState: (state) => shellRef.current?.setAppTabState(d.key, state) }) : null;
    },
    appTabLabel: (tab) => byKey.get(tab.appKey)?.label(tab),
    validAppKeys: new Set(byKey.keys()),
  };
}
