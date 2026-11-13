/**
 * #2343 — the gallery's preview frame. Code goes in only once the player has
 * loaded AND said it is listening; after that, any load of the frame is the
 * code taking the frame somewhere else, and the preview closes and says so.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";
import { GalleryPreview, NAVIGATED_AWAY, STOPPED } from "../GalleryPreview";
import { NEEDS_CLICK, type PreviewFile } from "../previewProtocol";

/** A one-file entry, as GalleryEntry hands it over (previewPlayFor). */
const ONE: PreviewFile[] = [{ path: "a.strudel", kind: "strudel", code: 's("bd")' }];

beforeEach(() => cleanup());

function frame(): HTMLIFrameElement | null {
  return document.querySelector("[data-gallery-preview-frame]");
}

/** A message as the sandboxed frame sends it: from its window, origin "null". */
function fromFrame(data: unknown) {
  const f = frame()!;
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin: "null", source: f.contentWindow }));
  });
}

function openPreview() {
  render(<GalleryPreview path="a.strudel" files={ONE} fileKey="e1/f0" />);
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  const f = frame();
  expect(f, "the preview opened its frame").not.toBeNull();
  const posted = vi.spyOn(f!.contentWindow!, "postMessage");
  return { f: f!, posted };
}

const plays = (posted: { mock: { calls: unknown[][] } }) =>
  posted.mock.calls.filter((args) => (args[0] as { play?: boolean }).play === true).length;

describe("GalleryPreview — what goes into the frame, and when", () => {
  it("sends the code only after the frame has loaded and said ready (either order)", () => {
    const { f, posted } = openPreview();
    fromFrame({ state: "ready" });
    expect(plays(posted), "ready alone: the player has not finished loading").toBe(0);
    fireEvent.load(f);
    expect(plays(posted)).toBe(1);
    expect(posted.mock.calls[0][0]).toEqual({ play: true, path: "a.strudel", files: ONE });
  });

  it("load first, then ready, also plays once", () => {
    const { f, posted } = openPreview();
    fireEvent.load(f);
    expect(plays(posted)).toBe(0);
    fromFrame({ state: "ready" });
    expect(plays(posted)).toBe(1);
  });

  it("a load after the code went in closes the preview and says why", () => {
    const { f } = openPreview();
    fireEvent.load(f);
    fromFrame({ state: "ready" });
    fromFrame({ state: "playing" });
    expect(document.querySelector('[data-gallery-preview-state="playing"]')).not.toBeNull();

    // the code navigated the frame: a second load
    fireEvent.load(f);
    expect(frame(), "the frame is gone, not left showing another page").toBeNull();
    expect(document.querySelector("[data-gallery-preview-state]")?.textContent).toBe(NAVIGATED_AWAY);
  });

  it("CONTROL: the player's own first load does not close it", () => {
    const { f } = openPreview();
    fromFrame({ state: "ready" });
    fireEvent.load(f);
    expect(frame()).not.toBeNull();
    expect(document.querySelector("[data-gallery-preview-state]")?.textContent).not.toBe(NAVIGATED_AWAY);
  });
});

describe("GalleryPreview — a frame that needs its own press (#2495)", () => {
  it("moves focus onto the frame when it says it needs a press there", () => {
    const { f } = openPreview();
    fireEvent.load(f);
    fromFrame({ state: "ready" });
    expect(document.activeElement).not.toBe(f);
    fromFrame({ state: "stopped", message: NEEDS_CLICK });
    expect(document.activeElement, "focus is on the frame, whose own Play has focus").toBe(f);
    expect(document.querySelector("[data-gallery-preview-state]")?.textContent).toBe(NEEDS_CLICK);
  });

  it("CONTROL: any other stopped message leaves focus where it was", () => {
    const { f } = openPreview();
    // #2579 — open, the big button is the page's Stop, whatever the frame says
    const button = screen.getByRole("button", { name: "Stop preview" });
    button.focus();
    fireEvent.load(f);
    fromFrame({ state: "ready" });
    fromFrame({ state: "stopped" });
    fromFrame({ state: "stopped", message: "Stopped by the code." });
    expect(document.activeElement).toBe(button);
  });

  it("only the first answer to a request, so code in it can't keep pulling focus back (#2547)", () => {
    const { f } = openPreview();
    fireEvent.load(f);
    fromFrame({ state: "ready" });
    fromFrame({ state: "stopped", message: NEEDS_CLICK });
    expect(document.activeElement).toBe(f);
    const button = screen.getByRole("button", { name: "Stop preview" });
    button.focus();
    fromFrame({ state: "stopped", message: NEEDS_CLICK });
    expect(document.activeElement).toBe(button);
  });
});

/**
 * #2547 — the frame runs the entry's own code, which can post NEEDS_CLICK itself.
 * Focus follows it only as the first answer to this page's own request to play.
 */
describe("GalleryPreview — focus moves only when this page asked the frame to play (#2547)", () => {
  /** Something on the page that has focus, as the search box would. */
  function focusElsewhere(): HTMLInputElement {
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Search");
    document.body.appendChild(input);
    input.focus();
    return input;
  }

  it("unasked: a NEEDS_CLICK before the page has sent the frame anything moves nothing", () => {
    const { f, posted } = openPreview();
    const search = focusElsewhere();
    fireEvent.load(f);
    // the code was not sent yet (no "ready"), so nothing has been asked of the frame
    fromFrame({ state: "stopped", message: NEEDS_CLICK });
    expect(plays(posted)).toBe(0);
    expect(document.activeElement, "focus stays in the search box").toBe(search);
    search.remove();
  });

  it("after the answer: the code posting NEEDS_CLICK once it already plays moves nothing", () => {
    const { f } = openPreview();
    fireEvent.load(f);
    fromFrame({ state: "ready" });
    fromFrame({ state: "playing" });
    const search = focusElsewhere();
    fromFrame({ state: "stopped", message: NEEDS_CLICK });
    expect(document.activeElement, "focus stays in the search box").toBe(search);
    search.remove();
  });

  it("after the answer: an error answer ends the wait too", () => {
    const { f } = openPreview();
    fireEvent.load(f);
    fromFrame({ state: "ready" });
    fromFrame({ state: "error", message: "boom" });
    const search = focusElsewhere();
    fromFrame({ state: "stopped", message: NEEDS_CLICK });
    expect(document.activeElement).toBe(search);
    search.remove();
  });

  it("a fresh frame is not waiting: a request the old frame never answered doesn't carry over", () => {
    const { f } = openPreview();
    fireEvent.load(f);
    fromFrame({ state: "ready" }); // the page asks; no answer comes
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(frame()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const g = frame()!;
    expect(g).not.toBe(f);
    const search = focusElsewhere();
    fireEvent.load(g);
    // the new frame posts it before the page has asked it anything
    fromFrame({ state: "stopped", message: NEEDS_CLICK });
    expect(document.activeElement).toBe(search);
    search.remove();
  });

  it("asked by a card's or a row's play (autoStart): its NEEDS_CLICK answer moves focus into the frame", async () => {
    render(<GalleryPreview path="a.strudel" files={ONE} fileKey="e1/f0" autoStart />);
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    const f = frame();
    expect(f, "autoStart opened the frame by itself").not.toBeNull();
    const posted = vi.spyOn(f!.contentWindow!, "postMessage");
    const search = focusElsewhere();
    fireEvent.load(f!);
    fromFrame({ state: "ready" });
    expect(plays(posted), "the page asked the frame to play").toBe(1);
    fromFrame({ state: "stopped", message: NEEDS_CLICK });
    expect(document.activeElement, "focus went into the frame, where Enter is the press").toBe(f);
    search.remove();
  });

  it("asked again (Preview pressed after a stop): that answer may move focus again", () => {
    const { f } = openPreview();
    fireEvent.load(f);
    fromFrame({ state: "ready" });
    fromFrame({ state: "playing" });
    fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
    // #2579 — Stop removed the frame; ▶ loads a fresh one and asks it to play
    expect(frame()).toBeNull();
    const search = focusElsewhere();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const g = frame()!;
    expect(g).not.toBe(f);
    const posted = vi.spyOn(g.contentWindow!, "postMessage");
    fireEvent.load(g);
    fromFrame({ state: "ready" });
    expect(plays(posted)).toBe(1);
    fromFrame({ state: "stopped", message: NEEDS_CLICK });
    expect(document.activeElement).toBe(g);
    search.remove();
  });
});

describe("GalleryPreview — a project's files go in together (#2490)", () => {
  it("sends the played file AND the entry's other files, in one message the frame accepts", async () => {
    const { parseToFrame } = await import("../previewProtocol");
    const files: PreviewFile[] = [
      { path: "main.strudel", kind: "strudel", code: 's("bd").viz("bloom")' },
      { path: "viz/bloom.hydra", kind: "hydra", code: "osc(10).out()" },
    ];
    render(<GalleryPreview path="main.strudel" files={files} fileKey="p1/f1" />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const f = frame()!;
    const posted = vi.spyOn(f.contentWindow!, "postMessage");
    fireEvent.load(f);
    fromFrame({ state: "ready" });
    expect(plays(posted)).toBe(1);
    const sent = posted.mock.calls[0][0];
    expect(sent).toEqual({ play: true, path: "main.strudel", files });
    expect(parseToFrame(sent)).toEqual(sent);
  });
});

/**
 * #2579 — the frame runs someone else's code, which can post the player's own
 * messages. The page doesn't take its word for the button, or for its words.
 */
describe("GalleryPreview — the page doesn't take the frame's word (#2579)", () => {
  const shown = () => document.querySelector("[data-gallery-preview-state]")!.textContent;

  function playingFrame() {
    const opened = openPreview();
    fireEvent.load(opened.f);
    fromFrame({ state: "ready" });
    fromFrame({ state: "playing" });
    return opened;
  }

  it("a stopped message's text is shown as the code's words, never as the page's", () => {
    playingFrame();
    fromFrame({ state: "stopped", message: "Sign in again to keep listening" });
    expect(shown()).toBe("The code reported that it stopped: Sign in again to keep listening");
    fromFrame({ state: "stopped" });
    expect(shown()).toBe("The code reported that it stopped.");
  });

  it("every state the frame reports is labelled when it carries the frame's text", () => {
    playingFrame();
    const said = "Sign in again to keep listening";
    for (const state of ["playing", "stopped", "error"] as const) {
      fromFrame({ state, message: said });
      expect(shown(), state).toMatch(/The code reported/);
      expect(shown(), state).not.toBe(said);
    }
  });

  it("the gallery's own needs-a-press request is recognised and written by the page", () => {
    const { f } = openPreview();
    fireEvent.load(f);
    fromFrame({ state: "ready" });
    fromFrame({ state: "stopped", message: NEEDS_CLICK });
    expect(shown()).toBe(NEEDS_CLICK);
    expect(document.querySelector("[data-gallery-preview-state]")!.getAttribute("data-gallery-preview-from")).toBe("frame");
  });

  it("a frame that says it stopped while it plays still gets Stop, and one press removes the frame", () => {
    const { posted } = playingFrame();
    fromFrame({ state: "stopped", message: "Stopped." });
    const stop = screen.getByRole("button", { name: "Stop preview" });
    fireEvent.click(stop);
    expect(frame(), "the frame is gone: nothing it ran is left running").toBeNull();
    expect(shown()).toBe(STOPPED);
    expect(document.querySelector("[data-gallery-preview-state]")!.getAttribute("data-gallery-preview-from")).toBe("page");
    // nothing was asked of the code: it was removed, not asked to stop
    expect(posted.mock.calls.filter((a) => (a[0] as { stop?: boolean }).stop === true)).toEqual([]);
    expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy();
  });

  it("the frame's state never turns the button into ▶ while the frame is up", () => {
    playingFrame();
    for (const msg of [{ state: "stopped" }, { state: "error", message: "x" }, { state: "stopped", message: NEEDS_CLICK }]) {
      fromFrame(msg);
      expect(screen.queryByRole("button", { name: "Preview" }), JSON.stringify(msg)).toBeNull();
      expect(screen.getByRole("button", { name: "Stop preview" })).toBeTruthy();
    }
  });

  it("▶ after a stop starts clean: a fresh frame, which gets the code once it has loaded and said ready", () => {
    const { f } = playingFrame();
    fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const g = frame()!;
    expect(g, "a new frame, not the old one").not.toBe(f);
    expect(shown()).toBe("Loading the preview…");
    const posted = vi.spyOn(g.contentWindow!, "postMessage");
    fireEvent.load(g);
    expect(plays(posted)).toBe(0);
    fromFrame({ state: "ready" });
    expect(plays(posted)).toBe(1);
    // its own first load is not a navigation
    expect(frame()).toBe(g);
  });

  it("onPlayingChange follows the page's own state, not the frame's", () => {
    const seen: boolean[] = [];
    render(<GalleryPreview path="a.strudel" files={ONE} fileKey="e1/f0" onPlayingChange={(p) => seen.push(p)} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const f = frame()!;
    fireEvent.load(f);
    fromFrame({ state: "ready" });
    fromFrame({ state: "playing" });
    fromFrame({ state: "stopped" });
    expect(seen.at(-1), "the frame's claim doesn't tell the file row it stopped").toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
    expect(seen.at(-1)).toBe(false);
  });
});

describe("GalleryPreview — one status line, announced once (#2580)", () => {
  it("the page's status line is the live region", () => {
    render(<GalleryPreview path="a.strudel" files={ONE} fileKey="e1/f0" />);
    const line = screen.getByRole("status");
    expect(line.hasAttribute("data-gallery-preview-state")).toBe(true);
  });
});
