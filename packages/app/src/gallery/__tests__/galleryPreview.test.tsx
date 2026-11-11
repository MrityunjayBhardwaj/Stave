/**
 * #2343 — the gallery's preview frame. Code goes in only once the player has
 * loaded AND said it is listening; after that, any load of the frame is the
 * code taking the frame somewhere else, and the preview closes and says so.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";
import { GalleryPreview, NAVIGATED_AWAY } from "../GalleryPreview";
import { NEEDS_CLICK } from "../previewProtocol";

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
  render(<GalleryPreview code={'s("bd")'} kind="strudel" fileKey="e1/f0" />);
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
    expect(posted.mock.calls[0][0]).toEqual({ play: true, code: 's("bd")', kind: "strudel" });
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
    const button = screen.getByRole("button", { name: "Preview" });
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
    const button = screen.getByRole("button", { name: "Preview" });
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
    render(<GalleryPreview code={'s("bd")'} kind="strudel" fileKey="e1/f0" autoStart />);
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
    const { f, posted } = openPreview();
    fireEvent.load(f);
    fromFrame({ state: "ready" });
    fromFrame({ state: "playing" });
    fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
    fromFrame({ state: "stopped" });
    const search = focusElsewhere();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(plays(posted)).toBe(2);
    fromFrame({ state: "stopped", message: NEEDS_CLICK });
    expect(document.activeElement).toBe(f);
    search.remove();
  });
});
