/**
 * #2511 — the Extensions view and an extension's page, drawn: the groups, the switch the
 * row and the page share, and opening a page from a row.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { enabledExtensionIds, setExtensionEnabled, type ExtensionManifest } from "@stave/editor";
import { ExtensionsPanel } from "../ExtensionsPanel";
import { ExtensionPage, extensionAppTabs, sectionOf } from "../ExtensionPage";

const load = async () => ({});
const tone: ExtensionManifest = {
  id: "zz-tone",
  name: "Tone",
  description: "A tone",
  languages: ["strudel"],
  provides: { strudel: { sounds: ["zztone"], controls: ["zzlevel"] } },
  load,
  about: { version: "1.2.3", worklets: ["the tone"] },
};
const keys: ExtensionManifest = { id: "zz-keys", name: "Keys", description: "Keys", languages: "*", load };

afterEach(() => {
  cleanup();
  for (const id of enabledExtensionIds()) setExtensionEnabled(id, false);
});

const q = (root: ParentNode, sel: string) => root.querySelector(sel) as HTMLElement | null;

describe("the Extensions panel", () => {
  it("shows On (saying none), Built into Stave and the community group; no Needed group while nothing is needed", () => {
    const { container } = render(<ExtensionsPanel manifests={[tone, keys]} onOpen={() => {}} />);
    expect(q(container, '[data-extension-group="needed"]')).toBeNull();
    expect(q(container, '[data-extension-group="on"]')!.textContent).toContain("None switched on.");
    const builtIn = q(container, '[data-extension-group="builtin"]')!;
    expect(builtIn.querySelectorAll("[data-extension-row]").length).toBe(2);
    expect(q(container, '[data-extension-group="community"]')!.nextElementSibling!.textContent).toContain("Coming later.");
  });

  it("lists a needed, switched-off extension under Needed by this project", () => {
    const { container } = render(<ExtensionsPanel manifests={[tone, keys]} needed={new Set(["zz-tone"])} onOpen={() => {}} />);
    const needed = q(container, '[data-extension-group="needed"]')!;
    expect(needed.querySelector('[data-extension-row="zz-tone"]')).not.toBeNull();
  });

  it("each row says its languages and the code names it adds", () => {
    const { container } = render(<ExtensionsPanel manifests={[tone, keys]} onOpen={() => {}} />);
    expect(q(container, '[data-extension-languages="zz-tone"]')!.textContent).toBe("Strudel");
    expect(q(container, '[data-extension-languages="zz-keys"]')!.textContent).toBe("All languages");
    expect(q(container, '[data-extension-row="zz-tone"]')!.textContent).toContain('s("zztone")');
    expect(q(container, '[data-extension-row="zz-tone"]')!.textContent).toContain(".zzlevel()");
  });

  it("clicking a row opens its page; clicking its switch only switches", () => {
    const onOpen = vi.fn();
    const { container } = render(<ExtensionsPanel manifests={[tone]} onOpen={onOpen} />);
    fireEvent.click(q(container, '[data-extension-row="zz-tone"]')!);
    expect(onOpen).toHaveBeenCalledWith("zz-tone");
    onOpen.mockClear();
    act(() => {
      fireEvent.click(q(container, '[data-extension-switch="zz-tone"]')!);
    });
    expect(onOpen).not.toHaveBeenCalled();
    expect(enabledExtensionIds().has("zz-tone")).toBe(true);
    // and it moved to the On group
    expect(q(container, '[data-extension-group="on"] [data-extension-row="zz-tone"]')).not.toBeNull();
  });

  it("the On and Off filters, and the search", () => {
    act(() => setExtensionEnabled("zz-keys", true));
    const { container } = render(<ExtensionsPanel manifests={[tone, keys]} onOpen={() => {}} />);
    const rows = () => [...container.querySelectorAll("[data-extension-row]")].map((r) => r.getAttribute("data-extension-row"));
    fireEvent.click(q(container, '[data-chip="on"]')!);
    expect(rows()).toEqual(["zz-keys"]);
    fireEvent.click(q(container, '[data-chip="off"]')!);
    expect(rows()).toEqual(["zz-tone"]);
    fireEvent.click(q(container, '[data-chip="all"]')!);
    fireEvent.change(q(container, "[data-extensions-search]")!, { target: { value: "zztone" } });
    expect(rows()).toEqual(["zz-tone"]);
    fireEvent.change(q(container, "[data-extensions-search]")!, { target: { value: "nothing like it" } });
    expect(q(container, "[data-extensions-empty]")).not.toBeNull();
  });
});

describe("the row and the page agree", () => {
  it("switching from the row shows on the page, and from the page on the row", () => {
    const { container } = render(
      <>
        <ExtensionsPanel manifests={[tone]} onOpen={() => {}} />
        <ExtensionPage manifest={tone} section="details" onSection={() => {}} />
      </>,
    );
    const page = () => q(container, '[data-extension-page="zz-tone"]')!;
    const row = () => q(container, '[data-extension-row="zz-tone"]')!;
    expect(page().dataset.on).toBe("false");
    expect(q(container, '[data-extension-state="zz-tone"]')!.textContent).toBe("Off — its code has not been loaded");
    act(() => {
      fireEvent.click(q(container, '[data-extension-switch-in="row"]')!);
    });
    expect(page().dataset.on).toBe("true");
    expect(row().dataset.on).toBe("true");
    expect(q(container, '[data-extension-state="zz-tone"]')!.textContent).toBe("On — takes effect at once, no reload");
    act(() => {
      fireEvent.click(q(container, '[data-extension-switch-in="page"]')!);
    });
    expect(row().dataset.on).toBe("false");
    expect(page().dataset.on).toBe("false");
  });
});

describe("the page", () => {
  it("What it adds lists the names and the leftovers, read while it is off", () => {
    const { container } = render(<ExtensionPage manifest={tone} section="adds" onSection={() => {}} />);
    const adds = q(container, "[data-extension-adds]")!;
    expect(adds.textContent).toContain('s("zztone")');
    expect(adds.textContent).toContain(".zzlevel(…)");
    expect(q(container, "[data-extension-leftovers]")!.querySelectorAll("li").length).toBe(2);
  });

  it("an extension with nothing left behind says so", () => {
    const { container } = render(<ExtensionPage manifest={keys} section="adds" onSection={() => {}} />);
    expect(q(container, '[data-extension-leftovers="none"]')).not.toBeNull();
  });

  it("the section comes back from the tab's saved state, and anything else is Details", () => {
    expect(sectionOf({ section: "adds" })).toBe("adds");
    expect(sectionOf({ section: "changes" })).toBe("changes");
    expect(sectionOf({ section: "nope" })).toBe("details");
    expect(sectionOf(["adds"])).toBe("details");
    expect(sectionOf(undefined)).toBe("details");
  });

  it("one app tab per listed extension, keyed by id and labelled by name", () => {
    const tabs = extensionAppTabs([tone, keys]);
    expect(tabs.map((t) => t.key)).toEqual(["extension:zz-tone", "extension:zz-keys"]);
    expect(tabs[0].label({ kind: "app", id: "x", appKey: "extension:zz-tone" }).title).toBe("Extension: Tone");
  });
});
