// #2364 — the dialog answers with the widget's token, and says what the token is
// for. Cloudflare's test keys hand back no action, so a browser test on them can't
// see this: a wrong name here would only show as refusals on a real key.
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShareCheckDialog } from "../ShareCheckDialog";

type RenderOpts = { sitekey: string; action?: string; callback: (token: string) => void };

function stubWidget() {
  const widget = { render: vi.fn((_el: HTMLElement, _opts: RenderOpts) => "w1"), remove: vi.fn() };
  (window as unknown as { turnstile: unknown }).turnstile = widget;
  return widget;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { turnstile?: unknown }).turnstile;
});

describe("ShareCheckDialog", () => {
  it("renders the widget for the server's action, and answers with its token", async () => {
    const widget = stubWidget();
    const onAnswer = vi.fn();
    render(<ShareCheckDialog siteKey="site" onAnswer={onAnswer} />);
    await waitFor(() => expect(widget.render).toHaveBeenCalledTimes(1));
    const opts = widget.render.mock.calls[0][1];
    expect(opts.action).toBe("share-link");
    expect(opts.sitekey).toBe("site");
    expect(onAnswer).not.toHaveBeenCalled();
    act(() => opts.callback("tok"));
    expect(onAnswer).toHaveBeenCalledWith({ token: "tok" });
  });

  it("Escape, the backdrop and Cancel close it; the long link is its own answer", async () => {
    stubWidget();
    const onAnswer = vi.fn();
    const { container } = render(<ShareCheckDialog siteKey="site" onAnswer={onAnswer} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onAnswer).toHaveBeenLastCalledWith({ skip: "cancel" });
    onAnswer.mockClear();
    fireEvent.click(container.firstElementChild as Element);
    expect(onAnswer).toHaveBeenLastCalledWith({ skip: "cancel" });
    onAnswer.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onAnswer).toHaveBeenLastCalledWith({ skip: "cancel" });
    onAnswer.mockClear();
    fireEvent.click(screen.getByTestId("share-check-long"));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenLastCalledWith({ skip: "long" });
  });
});
