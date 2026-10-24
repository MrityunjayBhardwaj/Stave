import { describe, it, expect, vi } from "vitest";
import { createSnippetsProvider } from "../snippetsProvider";
import { STRUDEL_SNIPPETS, type StrudelSnippet } from "../snippets/strudelSnippets";
import { availableCategories, availableLevels, collectAssets } from "../filter";
import { SKILL_LEVELS, type Asset, type AssetProvider } from "../types";

/**
 * #2165 — the Library's built-in Strudel sketches: how each becomes a row, and
 * the level filter they introduce. (That every sketch runs and names only real
 * sounds is checked in the real engine: library-snippets.spec.ts.)
 */

const sketch = (over: Partial<StrudelSnippet>): StrudelSnippet => ({
  id: "x",
  name: "X",
  level: "beginner",
  topic: "Rhythm",
  tags: ["drums"],
  code: 's("bd")\n',
  ...over,
});

describe("the built-in sketches", () => {
  it("about fifty, at every level, each with a unique id", () => {
    expect(STRUDEL_SNIPPETS.length).toBeGreaterThanOrEqual(45);
    expect(new Set(STRUDEL_SNIPPETS.map((s) => s.id)).size).toBe(STRUDEL_SNIPPETS.length);
    for (const level of SKILL_LEVELS) {
      expect(STRUDEL_SNIPPETS.filter((s) => s.level === level).length, level).toBeGreaterThanOrEqual(10);
    }
  });

  it("each one says what it shows in a comment, and its id makes a file name", () => {
    for (const s of STRUDEL_SNIPPETS) {
      expect(s.code.startsWith("// "), s.id).toBe(true);
      expect(s.id, s.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe("createSnippetsProvider", () => {
  it("lists each sketch as a row: topic as its category, level as its level and first tag, code to copy", () => {
    const p = createSnippetsProvider({
      startPreview: vi.fn(),
      onInsert: vi.fn(),
      snippets: [sketch({ id: "euclid", name: "Euclidean rhythms", level: "intermediate", topic: "Rhythm", tags: ["euclid"] })],
    });
    const [row] = p.list();
    expect(row).toMatchObject({
      type: "snippet",
      id: "euclid",
      name: "Euclidean rhythms",
      source: "built-in",
      group: "Rhythm",
      level: "intermediate",
      tags: ["Intermediate", "euclid"],
      code: 's("bd")\n',
    });
  });

  it("preview and insert hand the sketch to the app", async () => {
    const handle = { stop: vi.fn() };
    const startPreview = vi.fn(() => handle);
    const onInsert = vi.fn();
    const s = sketch({});
    const [row] = createSnippetsProvider({ startPreview, onInsert, snippets: [s] }).list();
    expect(await row.preview!()).toBe(handle);
    expect(startPreview).toHaveBeenCalledWith(s);
    await row.insert!();
    expect(onInsert).toHaveBeenCalledWith(s);
  });
});

describe("the level filter (#2165)", () => {
  const rows: Asset[] = [
    { type: "snippet", id: "a", name: "A", source: "built-in", tags: [], group: "Rhythm", level: "beginner" },
    { type: "snippet", id: "b", name: "B", source: "built-in", tags: [], group: "Rhythm", level: "advanced" },
    { type: "snippet", id: "c", name: "C", source: "built-in", tags: [], group: "Melody", level: "beginner" },
  ];
  const sounds: Asset[] = [{ type: "sound", id: "bd", name: "bd", source: "built-in", tags: [], group: "Drums" }];
  const providers: AssetProvider[] = [
    { type: "snippet", label: "Snippets", list: () => rows },
    { type: "sound", label: "Sounds", list: () => sounds },
  ];

  it("narrows the list to one level", () => {
    const got = collectAssets(providers, { query: "", type: "snippet", source: null, category: null, level: "beginner" });
    expect(got.map((a) => a.id)).toEqual(["a", "c"]);
  });

  it("lists the levels present, easiest first, with counts — none for a type without levels", () => {
    expect(availableLevels(providers, { type: "snippet" })).toEqual([
      { level: "beginner", count: 2 },
      { level: "advanced", count: 1 },
    ]);
    expect(availableLevels(providers, { type: "sound" })).toEqual([]);
  });

  it("topic counts follow the chosen level", () => {
    expect(availableCategories(providers, { type: "snippet", level: "beginner" })).toEqual([
      { category: "Melody", count: 1 },
      { category: "Rhythm", count: 1 },
    ]);
    expect(availableCategories(providers, { type: "snippet" })).toEqual([
      { category: "Rhythm", count: 2 },
      { category: "Melody", count: 1 },
    ]);
  });
});
