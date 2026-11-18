/**
 * #2491 — an entry's page: every action it had is still there, the code is
 * coloured text, and a project's files each play from their own row, one at a time.
 */
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EntryPage, type EntryPageProps } from "../GalleryEntry";
import { forgetGalleryRecordingsForTests } from "../client";
import type { GalleryEntry, GalleryEntryResponse } from "../types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  forgetGalleryRecordingsForTests();
});

const ENTRY: GalleryEntry = {
  id: "proj1xxxxxx",
  title: "Dub Techno Starter",
  kind: "project",
  tags: ["dub", "techno"],
  authorName: "mira.k",
  authorId: "mira",
  publishedAt: Date.now() - 2 * 86400_000,
  fileCount: 3,
  hasThumbnail: false,
};

const MANIFEST: GalleryEntryResponse["manifest"] = {
  schemaVersion: 1,
  project: { name: "Dub Techno Starter", sharedAt: 1 },
  files: [
    { id: "f1", path: "main.strudel", language: "strudel", content: '// kick\nstack(s("bd*4"))' },
    { id: "f2", path: "bass.strudel", language: "strudel", content: 'note("c2")' },
    { id: "f3", path: "viz/bloom.hydra", language: "hydra", content: "osc(10).out()" },
    { id: "f4", path: "README.md", language: "markdown", content: "# hi" },
  ],
  fileOrder: {},
  subfolderOrder: {},
};

function renderPage(over: Partial<EntryPageProps> = {}) {
  const props: EntryPageProps = {
    detail: { status: "ready", id: ENTRY.id, data: { entry: ENTRY, manifest: MANIFEST } },
    busy: false,
    backLabel: null,
    onBack: vi.fn(),
    onHome: vi.fn(),
    onKind: vi.fn(),
    onAuthor: vi.fn(),
    onRetry: vi.fn(),
    onOpenAsProject: vi.fn(),
    onAddToProject: vi.fn(),
    onCopyLink: vi.fn(),
    onReport: vi.fn(),
    listed: [ENTRY, { ...ENTRY, id: "musc9xxxxxx", title: "Tape Hiss Loop", kind: "music" }, { ...ENTRY, id: "othr1xxxxxx", authorId: "else", title: "Not hers" }],
    onOpenEntry: vi.fn(),
    ...over,
  };
  render(<EntryPage {...props} />);
  return props;
}

const frames = () => document.querySelectorAll("[data-gallery-preview-frame]");
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

describe("EntryPage", () => {
  it("keeps every action: open, copy link, report; and the safety note", () => {
    const p = renderPage();
    fireEvent.click(screen.getByText("Open as new project"));
    expect(p.onOpenAsProject).toHaveBeenCalledWith(ENTRY, MANIFEST);
    fireEvent.click(screen.getByText("Copy link"));
    expect(p.onCopyLink).toHaveBeenCalledWith(ENTRY.id);
    fireEvent.click(screen.getByText("Report"));
    expect(p.onReport).toHaveBeenCalledWith(ENTRY);
    expect(document.querySelector("[data-gallery-safe-note]")!.textContent).toContain("Nothing from this entry has run");
  });

  it("a project adds the one file chosen from its list (#2491)", () => {
    const p = renderPage();
    const add = screen.getByRole("button", { name: "Add to this project" });
    expect(add.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[data-gallery-add-file]")).toBeNull();
    fireEvent.click(add);
    expect(add.getAttribute("aria-expanded")).toBe("true");
    // every file, in the page's order, each with its own Add
    const rows = [...document.querySelectorAll("[data-gallery-add-file]")].map((r) => r.getAttribute("data-gallery-add-file"));
    expect(rows).toEqual(MANIFEST.files.map((f) => f.path));
    fireEvent.click(screen.getByRole("button", { name: "Add bass.strudel to this project" }));
    expect(p.onAddToProject).toHaveBeenCalledTimes(1);
    expect(p.onAddToProject).toHaveBeenCalledWith(ENTRY, MANIFEST, "bass.strudel");
    // one Add, then the list shuts
    expect(document.querySelector("[data-gallery-add-file]")).toBeNull();
    expect(add.getAttribute("aria-expanded")).toBe("false");
  });

  it("the project's list shuts again from its button, and adds nothing", () => {
    const p = renderPage();
    const add = screen.getByRole("button", { name: "Add to this project" });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(document.querySelector("[data-gallery-add-file]")).toBeNull();
    expect(p.onAddToProject).not.toHaveBeenCalled();
  });

  it("while an action is running, the project's Add buttons are off", () => {
    renderPage({ busy: true });
    expect((screen.getByRole("button", { name: "Add to this project" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("music offers Add to this project", () => {
    const p = renderPage({
      detail: { status: "ready", id: "m", data: { entry: { ...ENTRY, kind: "music" }, manifest: { ...MANIFEST, files: [MANIFEST.files[0]] } } },
    });
    fireEvent.click(screen.getByText("Add to this project"));
    // its one file, straight away: no list, no path
    expect(p.onAddToProject).toHaveBeenCalledWith({ ...ENTRY, kind: "music" }, { ...MANIFEST, files: [MANIFEST.files[0]] });
    expect(document.querySelector("[data-gallery-add-file]")).toBeNull();
  });

  it("the code is coloured text with a line per line, and nothing in it runs", () => {
    renderPage();
    const pre = document.querySelector('[data-gallery-code="main.strudel"]')!;
    expect(pre.querySelectorAll(".sg-code-line")).toHaveLength(2);
    expect(pre.querySelector(".sg-tc")!.textContent).toBe("// kick");
    expect(pre.querySelector(".sg-tk")!.textContent).toBe("stack");
    expect(pre.querySelector(".sg-ts")!.textContent).toBe('"bd*4"');
    expect(pre.textContent).toBe('// kick\nstack(s("bd*4"))\n');
    expect(frames()).toHaveLength(0);
  });

  it("In this project: one row per file with what it is; the README has no play button", () => {
    renderPage();
    expect(document.querySelector(".sg-contents-head")!.textContent).toBe("In this project 2 patterns · 1 visual · 1 other file");
    const rows = Array.from(document.querySelectorAll("[data-gallery-file-row]")).map((r) => r.getAttribute("data-gallery-file-row"));
    expect(rows).toEqual(["main.strudel", "bass.strudel", "viz/bloom.hydra", "README.md"]);
    expect(document.querySelector('[data-gallery-file-play="README.md"]')).toBeNull();
    expect(document.querySelector('[data-gallery-file-play="bass.strudel"]')).not.toBeNull();
  });

  it("a row's play puts its file in the one preview and starts it; only one frame ever", async () => {
    renderPage();
    fireEvent.click(document.querySelector('[data-gallery-file-play="bass.strudel"]')!);
    await waitFor(() => expect(frames()).toHaveLength(1));
    expect(document.querySelector('[data-gallery-file-row="bass.strudel"]')!.getAttribute("aria-current")).toBe("true");
    expect(document.querySelector("[data-gallery-preview]")!.getAttribute("data-gallery-preview")).toBe("proj1xxxxxx/f2");
    expect(document.querySelector('[data-gallery-code="bass.strudel"]')).not.toBeNull();

    fireEvent.click(document.querySelector('[data-gallery-file-play="viz/bloom.hydra"]')!);
    await waitFor(() => expect(document.querySelector("[data-gallery-preview]")!.getAttribute("data-gallery-preview")).toBe("proj1xxxxxx/f3"));
    await waitFor(() => expect(frames()).toHaveLength(1));
    // the old file's frame went: a new one for the new code
    expect((frames()[0] as HTMLElement).closest("[data-gallery-preview]")!.getAttribute("data-gallery-preview")).toBe("proj1xxxxxx/f3");
  });

  it("choosing a file to read doesn't start it", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "bass.strudel" }));
    // long enough for a start (it opens on the next animation frame) to have landed
    await act(async () => {
      await nextFrame();
      await nextFrame();
    });
    expect(document.querySelector('[data-gallery-code="bass.strudel"]')).not.toBeNull();
    expect(frames()).toHaveLength(0);
  });

  it("the side column: title, artist, tags, details, and more by the same artist", () => {
    const p = renderPage();
    expect(document.querySelector(".sg-side-title")!.textContent).toBe("Dub Techno Starter");
    expect(document.querySelector(".sg-byline")!.textContent).toMatch(/mira\.kPublished 2 days ago/);
    expect(Array.from(document.querySelectorAll(".sg-side-tag")).map((t) => t.textContent)).toEqual(["dub", "techno"]);
    expect(document.querySelector(".sg-facts")!.textContent).toContain("Contains2 patterns, 1 visual, 1 other file");
    const more = Array.from(document.querySelectorAll("[data-gallery-more]")).map((m) => m.getAttribute("data-gallery-more"));
    expect(more).toEqual(["musc9xxxxxx"]);
    fireEvent.click(document.querySelector('[data-gallery-more="musc9xxxxxx"]')!);
    expect(p.onOpenEntry).toHaveBeenCalledWith("musc9xxxxxx");
  });

  it("the breadcrumb, with Back only when something else is under the entry", () => {
    const p = renderPage({ backLabel: "← Back" });
    fireEvent.click(screen.getByText("← Back"));
    expect(p.onBack).toHaveBeenCalled();
    fireEvent.click(document.querySelector('[data-gallery-crumb="kind"]')!);
    expect(p.onKind).toHaveBeenCalledWith("project");
    cleanup();
    renderPage();
    expect(screen.queryByText("← Back")).toBeNull();
  });

  it("with a record: the cover first and open, its timeline on the stage, each recorded row with its strip and length", async () => {
    const rec = {
      v: 1,
      cover: "bass.strudel",
      contents: { patterns: 2, visuals: 1, other: 1 },
      files: [{ path: "bass.strudel", span: "loop", cycles: 8, lanes: [{ name: "sawtooth" }], events: [[0, 0, 1, 36]], sections: [] }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(rec)));
    renderPage({ detail: { status: "ready", id: ENTRY.id, data: { entry: { ...ENTRY, hasRecording: true }, manifest: MANIFEST } } });
    await waitFor(() => expect(document.querySelector("[data-gallery-file-row]")!.getAttribute("data-gallery-file-row")).toBe("bass.strudel"));
    const row = document.querySelector('[data-gallery-file-row="bass.strudel"]')!;
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(row.querySelector("[data-gallery-cover]")).not.toBeNull();
    expect(row.textContent).toContain("8-bar loop");
    expect(row.querySelector('[data-gallery-timeline="bass.strudel"]')).not.toBeNull();
    // the stage, before Play, shows what the cover plays
    expect(document.querySelector('[data-gallery-preview] [data-gallery-timeline="bass.strudel"]')).not.toBeNull();
    expect(document.querySelector('[data-gallery-code="bass.strudel"]')).not.toBeNull();
    expect(document.querySelector(".sg-facts")!.textContent).toContain("Coverbass.strudel, 8-bar loop");
  });

  it("#2495 a card's play: the preview starts on the cover file, even with the entry on hand at once", async () => {
    const taken = vi.fn();
    renderPage({ playOnOpen: { id: ENTRY.id, cover: "bass.strudel" }, onPlayTaken: taken });
    await nextFrame();
    await nextFrame();
    expect(frames()).toHaveLength(1);
    expect(document.querySelector("[data-gallery-preview]")?.getAttribute("data-gallery-preview")).toBe(`${ENTRY.id}/f2`);
    expect(taken).toHaveBeenCalledTimes(1);
  });

  it("#2495 CONTROL: a start meant for another entry starts nothing here", async () => {
    const taken = vi.fn();
    renderPage({ playOnOpen: { id: "othr1xxxxxx", cover: null }, onPlayTaken: taken });
    await nextFrame();
    await nextFrame();
    expect(frames()).toHaveLength(0);
    expect(taken).not.toHaveBeenCalled();
  });
});

describe("EntryPage — the preview gets the entry's files (#2490)", () => {
  /** Load the page's one frame and answer "ready", as the player does; what it was sent. */
  function frameSent(): unknown[] {
    const f = frames()[0] as HTMLIFrameElement;
    const posted = vi.spyOn(f.contentWindow!, "postMessage");
    fireEvent.load(f);
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { state: "ready" }, origin: "null", source: f.contentWindow }));
    });
    return posted.mock.calls.map((c) => c[0]);
  }

  it("a project's pattern goes in with the project's other runnable files, from its manifest only", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const [msg] = frameSent() as Array<{ play: true; path: string; files: Array<{ path: string; kind: string; code: string }> }>;
    expect(msg.path).toBe("main.strudel");
    // README.md has no preview, so it stays out; the rest are the manifest's own
    expect(msg.files.map((f) => f.path)).toEqual(["main.strudel", "bass.strudel", "viz/bloom.hydra"]);
    for (const f of msg.files) expect(f.code).toBe(MANIFEST.files.find((m) => m.path === f.path)!.content);
    expect(msg.files.find((f) => f.path === "viz/bloom.hydra")!.kind).toBe("hydra");
  });

  it("a music entry still sends its one file", () => {
    renderPage({
      detail: { status: "ready", id: "m", data: { entry: { ...ENTRY, kind: "music" }, manifest: { ...MANIFEST, files: [MANIFEST.files[0]] } } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(frameSent()).toEqual([{ play: true, path: "main.strudel", files: [{ path: "main.strudel", kind: "strudel", code: MANIFEST.files[0].content }] }]);
  });

  describe("#2590 — the tempo and the visual stills recorded at publish", () => {
    /** A tiny image with a real WebP header. */
    const STILL = (() => {
      const body = Buffer.alloc(64);
      body.write("RIFF", 0, "latin1");
      body.write("WEBPVP8 ", 8, "latin1");
      return `data:image/webp;base64,${body.toString("base64")}`;
    })();
    const base = {
      v: 1,
      cover: "main.strudel",
      contents: { patterns: 2, visuals: 1, other: 1 },
    };
    const song = { path: "main.strudel", span: "arranged", cycles: 16, lanes: [{ name: "bd" }], events: [[0, 0, 1, null]], sections: [] };
    const bass = { path: "bass.strudel", span: "loop", cycles: 2, lanes: [{ name: "saw" }], events: [[0, 0, 1, 36]], sections: [] };

    /**
     * #2603 — served as the routes serve them: the record never carries stills
     * (they're left out of it), the stills come from their own route.
     */
    let asked: string[] = [];
    async function open(rec: { frames?: unknown } & Record<string, unknown>) {
      const { frames, ...bare } = rec;
      asked = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          asked.push(url);
          if (url.endsWith("/recording")) return Response.json(bare);
          if (url.endsWith("/frames")) return Response.json({ frames: frames ?? [] });
          return new Response(null, { status: 404 });
        }),
      );
      renderPage({ detail: { status: "ready", id: ENTRY.id, data: { entry: { ...ENTRY, hasRecording: true }, manifest: MANIFEST } } });
      await waitFor(() => expect(document.querySelector('[data-gallery-file-row="main.strudel"] [data-gallery-timeline]')).not.toBeNull());
    }
    const facts = () => document.querySelector(".sg-facts")!.textContent;

    it("a tempo the code set: BPM in the details, the length in minutes beside the bars, and on its row", async () => {
      await open({ ...base, files: [{ ...song, tempo: { cps: 0.5, changes: false } }, bass] });
      expect(document.querySelector("[data-gallery-tempo]")!.textContent).toBe("120 BPM");
      expect(document.querySelector("[data-gallery-cover-length]")!.textContent).toBe("main.strudel, 16 bars · 0:32");
      expect(facts()).toContain("Tempo120 BPM");
      expect(document.querySelector('[data-gallery-file-row="main.strudel"]')!.textContent).toContain("16 bars · 120 BPM");
      // a pattern that set none says nothing about tempo on its row
      expect(document.querySelector('[data-gallery-file-row="bass.strudel"]')!.textContent).not.toMatch(/BPM/);
    });

    it('a tempo that changes: "starts at", and no length in minutes', async () => {
      await open({ ...base, files: [{ ...song, tempo: { cps: 0.5, changes: true } }] });
      expect(document.querySelector("[data-gallery-tempo]")!.textContent).toBe("starts at 120 BPM");
      expect(document.querySelector("[data-gallery-cover-length]")!.textContent).toBe("main.strudel, 16 bars");
    });

    it("no tempo recorded (the code set none, or an older entry): no Tempo line, no minutes, no BPM anywhere", async () => {
      await open({ ...base, files: [song, bass] });
      expect(document.querySelector("[data-gallery-tempo]")).toBeNull();
      expect(facts()).not.toMatch(/Tempo|BPM/);
      expect(document.querySelector("[data-gallery-cover-length]")!.textContent).toBe("main.strudel, 16 bars");
      expect(document.body.textContent).not.toMatch(/BPM|\d:\d\d/);
    });

    it("a visual with a still shows it on its row; a pattern's row keeps its strip", async () => {
      await open({ ...base, files: [song], frames: [{ path: "viz/bloom.hydra", image: STILL }] });
      // the stills arrive after the record, from their own request
      await waitFor(() => expect(document.querySelector("img[data-gallery-visual-frame]")).not.toBeNull());
      const img = document.querySelector('[data-gallery-file-row="viz/bloom.hydra"] img[data-gallery-visual-frame]') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.getAttribute("src")).toBe(STILL);
      expect(img.getAttribute("alt")).toBe("A still of viz/bloom.hydra");
      expect(document.querySelectorAll("[data-gallery-visual-frame]")).toHaveLength(1);
      // #2603 — from the stills route: the record it was given had none
      expect(asked).toContain(`/api/gallery/${ENTRY.id}/frames`);
    });

    it("#2603 — an entry with no visual doesn't ask for stills", async () => {
      await open({ ...base, contents: { patterns: 2, visuals: 0, other: 1 }, files: [song] });
      await new Promise((r) => setTimeout(r, 20));
      expect(asked).toEqual([`/api/gallery/${ENTRY.id}/recording`]);
    });

    it("an older entry's record has no stills: the visual's row is as it was", async () => {
      await open({ ...base, files: [song] });
      const row = document.querySelector('[data-gallery-file-row="viz/bloom.hydra"]')!;
      expect(row.querySelector("img")).toBeNull();
      expect(row.querySelector(".sg-frow-strip")!.children).toHaveLength(0);
      expect(row.textContent).toContain("visual · 1 line");
    });
  });
});

describe("EntryPage — a visual's picture on the stage before Play (#2611)", () => {
  /** A tiny image with a real WebP header. */
  const STILL = (() => {
    const body = Buffer.alloc(64);
    body.write("RIFF", 0, "latin1");
    body.write("WEBPVP8 ", 8, "latin1");
    return `data:image/webp;base64,${body.toString("base64")}`;
  })();
  const VIZ_MANIFEST: GalleryEntryResponse["manifest"] = {
    ...MANIFEST,
    files: [
      { id: "f1", path: "main.strudel", language: "strudel", content: 's("bd*4")' },
      { id: "k1", path: "Knot.three", language: "three", content: "// knot" },
      { id: "b1", path: "viz/bloom.hydra", language: "hydra", content: "osc(10).out()" },
    ],
  };
  const song = { path: "main.strudel", span: "loop", cycles: 4, lanes: [{ name: "bd" }], events: [[0, 0, 1, null]], sections: [] };

  /** Serve the record and the stills as their routes do, and open the entry. */
  async function open(opts: { cover: string; frames?: unknown[]; hasThumbnail?: boolean }) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/recording")) return Response.json({ v: 1, cover: opts.cover, contents: { patterns: 1, visuals: 2, other: 0 }, files: [song] });
        if (url.endsWith("/frames")) return Response.json({ frames: opts.frames ?? [] });
        return new Response(null, { status: 404 });
      }),
    );
    renderPage({
      detail: {
        status: "ready",
        id: ENTRY.id,
        data: { entry: { ...ENTRY, hasRecording: true, hasThumbnail: opts.hasThumbnail ?? true }, manifest: VIZ_MANIFEST },
      },
    });
    // the record has arrived once the cover leads the list
    await waitFor(() => expect(document.querySelector("[data-gallery-file-row]")!.getAttribute("data-gallery-file-row")).toBe(opts.cover));
  }
  const stage = () => document.querySelector("[data-gallery-preview]")!;
  const picture = () => stage().querySelector("img[data-gallery-stage-picture]") as HTMLImageElement | null;
  const choose = (path: string) => fireEvent.click(within(document.querySelector(`[data-gallery-file-row="${path}"]`) as HTMLElement).getByText(path));

  it("the cover visual shows the entry's cover picture, the same one its card shows", async () => {
    await open({ cover: "Knot.three", frames: [{ path: "Knot.three", image: STILL }] });
    await waitFor(() => expect(picture()).not.toBeNull());
    expect(picture()!.getAttribute("data-gallery-stage-picture")).toBe("thumbnail");
    expect(picture()!.getAttribute("src")).toBe(`/api/gallery/${ENTRY.id}/thumbnail`);
    expect(picture()!.getAttribute("alt")).toBe("The cover picture of Knot.three");
    expect(stage().textContent).not.toMatch(/Visual/);
  });

  it("another visual shows its own still", async () => {
    await open({ cover: "Knot.three", frames: [{ path: "viz/bloom.hydra", image: STILL }] });
    choose("viz/bloom.hydra");
    await waitFor(() => expect(picture()?.getAttribute("data-gallery-stage-picture")).toBe("still"));
    expect(picture()!.getAttribute("src")).toBe(STILL);
    expect(picture()!.getAttribute("data-gallery-stage-picture-of")).toBe("viz/bloom.hydra");
    // and the cover's picture is not reused for it
    expect(stage().querySelector('[data-gallery-stage-picture="thumbnail"]')).toBeNull();
  });

  it("a visual with neither keeps the placeholder", async () => {
    await open({ cover: "Knot.three", frames: [] });
    choose("viz/bloom.hydra");
    await new Promise((r) => setTimeout(r, 20));
    expect(picture()).toBeNull();
    expect(stage().querySelector(".sg-stage-idle")!.textContent).toBe("Visual");
  });

  it("a cover visual with no stored picture falls back to its still", async () => {
    await open({ cover: "Knot.three", hasThumbnail: false, frames: [{ path: "Knot.three", image: STILL }] });
    await waitFor(() => expect(picture()?.getAttribute("data-gallery-stage-picture")).toBe("still"));
  });

  it("a picture that won't load gives way to the next, then to the placeholder", async () => {
    await open({ cover: "Knot.three", frames: [{ path: "Knot.three", image: STILL }] });
    await waitFor(() => expect(picture()?.getAttribute("data-gallery-stage-picture")).toBe("thumbnail"));
    await waitFor(() => expect(document.querySelector('[data-gallery-file-row="Knot.three"] img')).not.toBeNull());
    fireEvent.error(picture()!);
    expect(picture()!.getAttribute("data-gallery-stage-picture")).toBe("still");
    fireEvent.error(picture()!);
    expect(picture()).toBeNull();
    expect(stage().querySelector(".sg-stage-idle")!.textContent).toBe("Visual");
  });

  it("a pattern still shows its timeline, not a picture", async () => {
    await open({ cover: "Knot.three", frames: [{ path: "Knot.three", image: STILL }] });
    choose("main.strudel");
    expect(stage().querySelector('[data-gallery-timeline="main.strudel"]')).not.toBeNull();
    expect(picture()).toBeNull();
  });

  it("Play puts the live preview in the picture's place", async () => {
    await open({ cover: "Knot.three" });
    await waitFor(() => expect(picture()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(picture()).toBeNull();
    expect(stage().querySelector("[data-gallery-preview-frame]")).not.toBeNull();
    // and Stop brings it back
    fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
    expect(picture()?.getAttribute("data-gallery-stage-picture")).toBe("thumbnail");
  });

  it("an entry from before records keeps the placeholder, as it did", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    renderPage({
      detail: {
        status: "ready",
        id: "vizold",
        data: { entry: { ...ENTRY, id: "vizold", kind: "viz", hasThumbnail: true }, manifest: { ...MANIFEST, files: [VIZ_MANIFEST.files[1]] } },
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(picture()).toBeNull();
    expect(stage().querySelector(".sg-stage-idle")!.textContent).toBe("Visual");
  });
});
