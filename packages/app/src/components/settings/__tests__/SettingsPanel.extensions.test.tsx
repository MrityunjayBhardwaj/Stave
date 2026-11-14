/**
 * #2556 — Settings › Extensions, drawn: the test extension's group only while it is on,
 * one control per type, a change stored only where it differs from the default, put back
 * to default, search by description, `@ext:` narrowing, and the extension page's Settings
 * button and "What it adds" list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { E2E_TONE_ID, extensionSettingValue, listedExtensions, setExtensionEnabled, type ExtensionManifest } from "@stave/editor";
import { SettingsPanel } from "../SettingsPanel";
import { ExtensionPage } from "../../../extensions/ExtensionPage";

const STORAGE = "stave:extension-settings";
const g = globalThis as { __STAVE_E2E__?: boolean };

let E2E_TONE: ExtensionManifest;
beforeEach(() => {
  g.__STAVE_E2E__ = true; // the test extension is listed only in an end-to-end run
  E2E_TONE = listedExtensions().find((m) => m.id === E2E_TONE_ID)!;
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete g.__STAVE_E2E__;
});

const group = (c: HTMLElement) => c.querySelector(`[data-testid="settings-ext-group-${E2E_TONE_ID}"]`);
const control = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-testid="ext-setting-${E2E_TONE_ID}-${id}"]`) as HTMLInputElement | HTMLSelectElement | null;
const stored = () => JSON.parse(window.localStorage.getItem(STORAGE) ?? "null");

describe("Settings › Extensions", () => {
  it("shows the test extension's settings under its name only while it is switched on", () => {
    const { container, rerender } = render(<SettingsPanel query={`@ext:${E2E_TONE_ID}`} />);
    expect(group(container)).toBeNull();
    expect(container.querySelector('[data-testid="settings-ext-empty"]')?.textContent).toMatch(/Test tone is switched off/);
    act(() => setExtensionEnabled(E2E_TONE_ID, true));
    rerender(<SettingsPanel query={`@ext:${E2E_TONE_ID}`} />);
    expect(group(container)?.querySelector(".ext-grp-title")?.textContent).toBe("Test tone");
    expect(control(container, "showLabel")?.getAttribute("role")).toBe("switch");
    expect(control(container, "labelCase")?.tagName).toBe("SELECT");
    expect((control(container, "labelSize") as HTMLInputElement).type).toBe("number");
    expect((control(container, "labelText") as HTMLInputElement).type).toBe("text");
    // only the Extensions section shows under an @ext filter
    expect(container.querySelectorAll("section.grp")).toHaveLength(1);
    act(() => setExtensionEnabled(E2E_TONE_ID, false));
    expect(group(container)).toBeNull();
  });

  it("a change is stored only where it differs from the default, and reset deletes it", () => {
    act(() => setExtensionEnabled(E2E_TONE_ID, true));
    const { container } = render(<SettingsPanel query={`@ext:${E2E_TONE_ID}`} />);
    fireEvent.click(control(container, "showLabel")!);
    expect(stored()).toEqual({ [E2E_TONE_ID]: { showLabel: true } });
    fireEvent.change(control(container, "labelCase")!, { target: { value: "upper" } });
    fireEvent.change(control(container, "labelSize")!, { target: { value: "20" } });
    expect(stored()).toEqual({ [E2E_TONE_ID]: { showLabel: true, labelCase: "upper", labelSize: 20 } });
    // out of range: not stored, the box is marked
    fireEvent.change(control(container, "labelSize")!, { target: { value: "99" } });
    expect(extensionSettingValue(E2E_TONE, "labelSize")).toBe(20);
    expect(control(container, "labelSize")!.className).toMatch(/err/);
    const row = container.querySelector(`[data-ext-setting="${E2E_TONE_ID}.labelCase"]`)!;
    expect(row.getAttribute("data-default")).toBe("false");
    fireEvent.click(container.querySelector(`[data-testid="ext-setting-reset-${E2E_TONE_ID}-labelCase"]`)!);
    expect(row.getAttribute("data-default")).toBe("true");
    expect((control(container, "labelCase") as HTMLSelectElement).value).toBe("asTyped");
    expect(stored()).toEqual({ [E2E_TONE_ID]: { showLabel: true, labelSize: 20 } });
    // the default needs no reset button
    expect(container.querySelector(`[data-testid="ext-setting-reset-${E2E_TONE_ID}-labelCase"]`)).toBeNull();
    // typing the default back in also deletes it
    fireEvent.click(control(container, "showLabel")!);
    expect(stored()).toEqual({ [E2E_TONE_ID]: { labelSize: 20 } });
  });

  it("search finds an extension setting by its description, alongside Stave's own sections", () => {
    act(() => setExtensionEnabled(E2E_TONE_ID, true));
    const { container } = render(<SettingsPanel query="capitals" />);
    const rows = group(container)!.querySelectorAll("[data-ext-setting]");
    expect([...rows].map((r) => r.getAttribute("data-ext-setting"))).toEqual([`${E2E_TONE_ID}.labelCase`]);
  });

  it("with no search, the Extensions nav item shows the section", () => {
    act(() => setExtensionEnabled(E2E_TONE_ID, true));
    const { container } = render(<SettingsPanel query="" />);
    expect(group(container)).toBeNull();
    fireEvent.click(container.querySelector('[data-testid="settings-nav-extensions"]')!);
    expect(group(container)).not.toBeNull();
  });

  it("a change from elsewhere (another tab) redraws the row", () => {
    act(() => setExtensionEnabled(E2E_TONE_ID, true));
    const { container } = render(<SettingsPanel query={`@ext:${E2E_TONE_ID}`} />);
    act(() => {
      window.localStorage.setItem(STORAGE, JSON.stringify({ [E2E_TONE_ID]: { labelText: "from elsewhere" } }));
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE }));
    });
    expect((control(container, "labelText") as HTMLInputElement).value).toBe("from elsewhere");
  });
});

describe("the extension's page", () => {
  it("has a Settings button that opens Settings on it, and lists its settings with their defaults", () => {
    const open = vi.fn();
    const { container, rerender } = render(<ExtensionPage manifest={E2E_TONE} section="adds" onSection={() => {}} onOpenSettings={open} />);
    const button = container.querySelector(`[data-extension-settings-button="${E2E_TONE_ID}"]`) as HTMLButtonElement;
    fireEvent.click(button);
    expect(open).toHaveBeenCalledTimes(1);
    const defaults = Object.fromEntries(
      [...container.querySelectorAll("[data-adds-setting-default]")].map((td) => [td.getAttribute("data-adds-setting-default"), td.textContent]),
    );
    expect(defaults).toEqual({ showLabel: "Off", labelText: "“Test tone is on”", labelCase: "As typed", labelSize: "12" });
    expect(container.querySelector('[data-adds-kind="Settings"]')?.textContent).toMatch(/4 settings/);
    // no opener, no button
    rerender(<ExtensionPage manifest={E2E_TONE} section="adds" onSection={() => {}} />);
    expect(container.querySelector(`[data-extension-settings-button="${E2E_TONE_ID}"]`)).toBeNull();
  });
});
