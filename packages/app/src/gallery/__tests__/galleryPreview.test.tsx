/**
 * #2343 — the gallery's preview frame. Code goes in only once the player has
 * loaded AND said it is listening; after that, any load of the frame is the
 * code taking the frame somewhere else, and the preview closes and says so.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";
import { GalleryPreview, NAVIGATED_AWAY } from "../GalleryPreview";

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
