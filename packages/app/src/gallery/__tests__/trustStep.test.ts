/**
 * #2328 — the first Play of a file taken in from the gallery asks first, once
 * per file, naming who wrote it; Cancel leaves it unrun. Kept beside the
 * #2304 hold, which it must not disturb.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  confirmGalleryRun,
  galleryAuthorToConfirm,
  galleryTrustMessage,
  holdGalleryFiles,
  isGalleryHeld,
  markGalleryFilesUntrusted,
  releaseGalleryHold,
  resetGalleryHoldsForTest,
} from "../safeRun";

beforeEach(() => {
  window.localStorage.clear();
  resetGalleryHoldsForTest();
});

describe("gallery trust step", () => {
  it("asks once per file, and only for files from the gallery", async () => {
    markGalleryFilesUntrusted("p", ["f1", "f2"], "Alice");
    const confirm = vi.fn(async () => true);

    expect(await confirmGalleryRun("p", "f1", confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("Alice");

    // the same file again: no question
    expect(await confirmGalleryRun("p", "f1", confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);

    // its sibling from the same import still asks
    expect(await confirmGalleryRun("p", "f2", confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);

    // a file of the person's own never asks
    expect(await confirmGalleryRun("p", "mine", confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("Cancel leaves the file unrun, still untrusted and still held; the next Play asks again", async () => {
    holdGalleryFiles("p", ["f1"]);
    markGalleryFilesUntrusted("p", ["f1"], "Bob");
    const no = vi.fn(async () => false);
    expect(await confirmGalleryRun("p", "f1", no)).toBe(false);
    expect(galleryAuthorToConfirm("p", "f1")).toBe("Bob");
    expect(isGalleryHeld("p", "f1")).toBe(true);

    const yes = vi.fn(async () => true);
    expect(await confirmGalleryRun("p", "f1", yes)).toBe(true);
    expect(yes).toHaveBeenCalledTimes(1);
    expect(galleryAuthorToConfirm("p", "f1")).toBeNull();
    // trusting does not lift the hold — only playing does (StrudelEditorClient)
    expect(isGalleryHeld("p", "f1")).toBe(true);
    releaseGalleryHold("p", "f1");
    expect(isGalleryHeld("p", "f1")).toBe(false);
  });

  it("is remembered across a reload (localStorage), per project", async () => {
    markGalleryFilesUntrusted("p", ["f1"], "Carol");
    expect(JSON.parse(window.localStorage.getItem("stave.gallery.untrusted")!)).toEqual({ "p/f1": "Carol" });
    expect(galleryAuthorToConfirm("other", "f1")).toBeNull();
    await confirmGalleryRun("p", "f1", async () => true);
    expect(JSON.parse(window.localStorage.getItem("stave.gallery.untrusted")!)).toEqual({});
  });

  it("a second Play while the question is open asks nothing more and doesn't play twice", async () => {
    markGalleryFilesUntrusted("p", ["f1"], "Dee");
    let answer!: (ok: boolean) => void;
    const confirm = vi.fn(() => new Promise<boolean>((r) => (answer = r)));
    const first = confirmGalleryRun("p", "f1", confirm);
    const second = confirmGalleryRun("p", "f1", confirm);
    answer(true);
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("a corrupt store reads as nothing to confirm rather than throwing", async () => {
    window.localStorage.setItem("stave.gallery.untrusted", "[not an object");
    expect(galleryAuthorToConfirm("p", "f")).toBeNull();
    window.localStorage.setItem("stave.gallery.untrusted", JSON.stringify({ "p/f": 7 }));
    expect(galleryAuthorToConfirm("p", "f")).toBeNull();
  });

  it("says the issue's words, naming the author", () => {
    const m = galleryTrustMessage("Alice");
    expect(m.description).toBe(
      "This code was written by Alice. Running it in your workspace gives it the same access you have to Stave on this browser: your projects and your account. Preview it in the gallery first if you're unsure.",
    );
    expect(galleryTrustMessage("  ").description).toContain("written by someone else.");
  });
});
