/**
 * #2344 — a viz file's preview tab and backdrop run its code when shown. The
 * gated provider must not call the real `render` (which mounts the code) for a
 * gallery file nobody has agreed to run, until the trust question says yes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";
import type { PreviewContext, PreviewProvider } from "@stave/editor";
import { gatePreviewProvider, resetDeclinedPreviewsForTest } from "../RunGatePreview";
import { holdGalleryFiles, markGalleryFilesUntrusted, resetGalleryHoldsForTest } from "../safeRun";

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  resetGalleryHoldsForTest();
  resetDeclinedPreviewsForTest();
});

function fakeProvider() {
  const rendered: string[] = [];
  const provider = {
    extensions: ["hydra"],
    label: "Hydra",
    keepRunningWhenHidden: false,
    reload: "debounced",
    debounceMs: 300,
    render: (ctx: PreviewContext) => {
      rendered.push(ctx.file.id);
      return <div data-testid="viz-ran">ran {ctx.file.id}</div>;
    },
  } as unknown as PreviewProvider;
  return { provider, rendered };
}

const ctxFor = (id: string) => ({ file: { id, path: `${id}.hydra`, language: "hydra", content: "osc().out()" } }) as unknown as PreviewContext;

function deferred() {
  let resolve!: (v: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  return { promise, resolve };
}

describe("the gated preview provider", () => {
  it("renders your own viz file straight away, without asking", () => {
    const { provider, rendered } = fakeProvider();
    const ask = vi.fn(async () => true);
    const gated = gatePreviewProvider(provider, () => "p", ask);
    render(<>{gated.render(ctxFor("mine"))}</>);
    expect(screen.getByTestId("viz-ran")).toBeTruthy();
    expect(rendered).toEqual(["mine"]);
    expect(ask).not.toHaveBeenCalled();
    // the other fields are the provider's own
    expect(gated.label).toBe("Hydra");
    expect(gatePreviewProvider(provider, () => "p", ask)).toBe(gated);
  });

  it("asks before an untrusted gallery file runs; nothing renders until the answer is yes", async () => {
    holdGalleryFiles("p", ["g1"]);
    markGalleryFilesUntrusted("p", ["g1"], "Mallory");
    const { provider, rendered } = fakeProvider();
    const answer = deferred();
    const ask = vi.fn((_m: { description: string }) => answer.promise);
    const gated = gatePreviewProvider(provider, () => "p", ask);
    render(<>{gated.render(ctxFor("g1"))}</>);
    await act(async () => {});
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0].description).toContain("This code was written by Mallory.");
    expect(rendered).toEqual([]);
    await act(async () => answer.resolve(true));
    expect(screen.getByTestId("viz-ran")).toBeTruthy();
    expect(rendered).toEqual(["g1"]);
  });

  it("Cancel leaves the code unrun, and Run it… asks again", async () => {
    holdGalleryFiles("p", ["g1"]);
    markGalleryFilesUntrusted("p", ["g1"], "Mallory");
    const { provider, rendered } = fakeProvider();
    const ask = vi.fn(async () => false);
    const gated = gatePreviewProvider(provider, () => "p", ask);
    render(<>{gated.render(ctxFor("g1"))}</>);
    await act(async () => {});
    expect(rendered).toEqual([]);
    expect(screen.getByText("This code came from the gallery and hasn't been run.")).toBeTruthy();
    // a remount (a preview reload) after Cancel does not ask again by itself
    cleanup();
    render(<>{gated.render(ctxFor("g1"))}</>);
    await act(async () => {});
    expect(ask).toHaveBeenCalledTimes(1);
    expect(rendered).toEqual([]);
    ask.mockImplementation(async () => true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run it…" }));
    });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(rendered).toEqual(["g1"]);
  });

  it("after Cancel, the file's own viz control asks again (the backdrop's button is out of reach)", async () => {
    holdGalleryFiles("p", ["g1"]);
    markGalleryFilesUntrusted("p", ["g1"], "Mallory");
    const { provider, rendered } = fakeProvider();
    const opened: string[] = [];
    (provider as { renderEditorChrome?: unknown }).renderEditorChrome = (ctx: { file: { id: string }; onOpenPreview: () => void }) => (
      <button type="button" onClick={() => ctx.onOpenPreview()}>
        Play viz
      </button>
    );
    const ask = vi.fn(async (_m: { description: string }) => false);
    const gated = gatePreviewProvider(provider, () => "p", ask);
    render(
      <>
        {gated.render(ctxFor("g1"))}
        {gated.renderEditorChrome?.({ ...ctxFor("g1"), onOpenPreview: () => opened.push("g1") } as never)}
      </>,
    );
    await act(async () => {});
    expect(ask).toHaveBeenCalledTimes(1);
    expect(rendered).toEqual([]);
    ask.mockImplementation(async () => true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Play viz" }));
    });
    expect(opened).toEqual(["g1"]); // the control still does its own job
    expect(ask).toHaveBeenCalledTimes(2);
    expect(rendered).toEqual(["g1"]);
  });

  // #2343 — the backdrop is placed, but the visual hasn't started: the control
  // says Play (not Pause) while the question is open and after Cancel, and its
  // press asks again rather than pausing; once the answer is yes it says Pause.
  it("the viz control reads Play, not Pause, until the file may run", async () => {
    holdGalleryFiles("p", ["g1"]);
    markGalleryFilesUntrusted("p", ["g1"], "Mallory");
    const { provider } = fakeProvider();
    const toggles: string[] = [];
    (provider as { renderEditorChrome?: unknown }).renderEditorChrome = (ctx: { previewPaused?: boolean; onTogglePausePreview?: () => void }) => (
      <button type="button" data-testid="vizctl" onClick={() => ctx.onTogglePausePreview?.()}>
        {ctx.previewPaused ? "Play" : "Pause"}
      </button>
    );
    const answer = deferred();
    const ask = vi.fn(() => answer.promise);
    const gated = gatePreviewProvider(provider, () => "p", ask);
    const ctx = { ...ctxFor("g1"), previewPaused: false, onTogglePausePreview: () => toggles.push("g1") };
    render(
      <>
        {gated.render(ctxFor("g1"))}
        {gated.renderEditorChrome?.(ctx as never)}
      </>,
    );
    await act(async () => {});
    expect(ask).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("vizctl").textContent, "asking: nothing runs yet").toBe("Play");

    await act(async () => answer.resolve(false));
    expect(screen.getByTestId("vizctl").textContent, "cancelled: still not running").toBe("Play");
    ask.mockImplementation(async () => true);
    await act(async () => {
      fireEvent.click(screen.getByTestId("vizctl"));
    });
    expect(toggles, "the press asked again; it did not pause a visual that never ran").toEqual([]);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("vizctl").textContent, "yes: it runs, so the control offers Pause").toBe("Pause");
    await act(async () => {
      fireEvent.click(screen.getByTestId("vizctl"));
    });
    expect(toggles).toEqual(["g1"]);
  });
});
