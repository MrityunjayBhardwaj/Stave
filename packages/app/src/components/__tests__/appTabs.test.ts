/**
 * #2473 — the table of app tabs gives the shell all three props from one list.
 */
import { createElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceShellHandle } from "@stave/editor";
import { appTabShellProps, type AppTab, type AppTabDefinition } from "../appTabs";

const tab = (appKey: string, state?: AppTab["state"]): AppTab => ({ kind: "app", id: `app-${appKey}`, appKey, ...(state !== undefined ? { state } : {}) });

function def(key: string): AppTabDefinition {
  return {
    key,
    label: (t) => ({ title: `${key}:${String((t.state as { n?: number } | undefined)?.n ?? "-")}` }),
    render: (t, ctx) => {
      ctx.setState({ n: 1 });
      return createElement("i", null, `body ${t.appKey}`);
    },
  };
}

function shell(): { ref: { current: WorkspaceShellHandle | null }; setAppTabState: ReturnType<typeof vi.fn> } {
  const setAppTabState = vi.fn();
  return { ref: { current: { setAppTabState } as unknown as WorkspaceShellHandle }, setAppTabState };
}

describe("appTabShellProps", () => {
  it("routes each key to its own body and label, and lists every key as restorable", () => {
    const { ref } = shell();
    const p = appTabShellProps([def("gallery"), def("whats-new")], ref);
    const body = (t: AppTab) => (p.renderAppTab(t) as ReactElement<{ children: string }>).props.children;
    expect(body(tab("gallery"))).toBe("body gallery");
    expect(body(tab("whats-new"))).toBe("body whats-new");
    expect(p.appTabLabel(tab("whats-new", { n: 3 }))).toEqual({ title: "whats-new:3" });
    expect([...p.validAppKeys].sort()).toEqual(["gallery", "whats-new"]);
  });

  it("an unknown key draws nothing and has no label (the shell falls back to the key)", () => {
    const p = appTabShellProps([def("gallery")], shell().ref);
    expect(p.renderAppTab(tab("extension"))).toBeNull();
    expect(p.appTabLabel(tab("extension"))).toBeUndefined();
    expect(p.validAppKeys.has("extension")).toBe(false);
  });

  it("a body's setState writes to its OWN key", () => {
    const { ref, setAppTabState } = shell();
    const p = appTabShellProps([def("gallery"), def("whats-new")], ref);
    p.renderAppTab(tab("whats-new"));
    expect(setAppTabState).toHaveBeenCalledTimes(1);
    expect(setAppTabState).toHaveBeenCalledWith("whats-new", { n: 1 });
  });

  it("refuses a key listed twice", () => {
    expect(() => appTabShellProps([def("gallery"), def("gallery")], shell().ref)).toThrow(/defined twice/);
  });
});
