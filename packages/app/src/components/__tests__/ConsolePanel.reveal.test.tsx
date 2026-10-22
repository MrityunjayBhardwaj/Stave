/**
 * #2182 — clicking an error in the Console takes you to its line, through the
 * same handler the error toast uses. A row with no line, and clicks on the
 * row's own link or button, don't.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { clearLog, emitLog, type LogEntry } from "@stave/editor";
import { ConsolePanel } from "../ConsolePanel";

afterEach(() => {
  cleanup();
  act(() => clearLog());
});

const rowFor = async (entry: Partial<LogEntry>, onReveal = vi.fn()) => {
  act(() => clearLog());
  const { container } = render(<ConsolePanel onReveal={onReveal} />);
  // the log tells its listeners in a microtask, so the act must be async
  await act(async () => {
    emitLog({ level: "error", runtime: "strudel", message: "x.ain is not a function", ...entry });
  });
  const row = container.querySelector('[data-testid="console-row"]') as HTMLElement;
  return { row, onReveal };
};

describe("Console row goes to its line", () => {
  it("a click on a row with a line reveals that entry", async () => {
    const { row, onReveal } = await rowFor({ source: "pattern.strudel", line: 5, column: 4 });
    fireEvent.click(row.querySelector("div")!);
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onReveal.mock.calls[0][0]).toMatchObject({ source: "pattern.strudel", line: 5 });
  });

  it("Enter on the focused row does the same", async () => {
    const { row, onReveal } = await rowFor({ source: "pattern.strudel", line: 2 });
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it("a row with no line does nothing", async () => {
    const { row, onReveal } = await rowFor({ source: "pattern.strudel" });
    fireEvent.click(row);
    expect(onReveal).not.toHaveBeenCalled();
    expect(row.getAttribute("role")).toBeNull();
  });

  it("the stack toggle keeps its own job", async () => {
    const { row, onReveal } = await rowFor({ source: "pattern.strudel", line: 3, stack: "at <anonymous>:5:4" });
    fireEvent.click(row.querySelector("button")!);
    expect(onReveal).not.toHaveBeenCalled();
    expect(row.textContent).toContain("Hide stack");
  });
});
