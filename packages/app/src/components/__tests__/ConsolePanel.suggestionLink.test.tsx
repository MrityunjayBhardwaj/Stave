/**
 * #2172 — a Console suggestion with no address is not a link. An empty href
 * pointed at the page itself, so clicking a hint's example opened Stave again.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { clearLog, emitLog } from "@stave/editor";
import { ConsolePanel } from "../ConsolePanel";

afterEach(() => {
  cleanup();
  act(() => clearLog());
});

const suggestionFor = async (suggestion: { name: string; docsUrl: string; example?: string }) => {
  act(() => clearLog());
  const { container } = render(<ConsolePanel />);
  // the log tells its listeners in a microtask, so the act must be async
  await act(async () => {
    emitLog({ level: "error", runtime: "strudel", message: "a hint", suggestion });
  });
  return container.querySelector('[data-testid="console-suggestion"]');
};

describe("Console suggestion link", () => {
  it("a hint with only an example has no href", async () => {
    const row = await suggestionFor({ name: "", docsUrl: "", example: 'note("c4 e4 g4")' });
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('note("c4 e4 g4")');
    expect(row!.hasAttribute("href")).toBe(false);
  });

  it("a suggestion with a docs page still links it", async () => {
    const row = await suggestionFor({ name: "note", docsUrl: "/docs/reference/strudel/#note" });
    expect(row!.getAttribute("href")).toBe("/docs/reference/strudel/#note");
  });
});
