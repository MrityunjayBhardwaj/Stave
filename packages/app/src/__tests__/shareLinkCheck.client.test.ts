// @vitest-environment jsdom
// #2364 — when the page asks for the check before making a short link, what it
// does with the answer, and that a token goes out with one request only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const content = vi.hoisted(() => ({ text: 's("bd")' }));
vi.mock("@stave/editor", () => ({
  listWorkspaceFiles: () => [{ id: "f0", path: "song.strudel", language: "strudel", content: content.text }],
  getFolderOrder: () => [],
  getSubfolderOrder: () => [],
}));

import { getDialog, resolvePrompt, closeDialog } from "../dialogs/host";
import { resetGallerySessionForTests, type GallerySessionState } from "../gallery/session";
import { TURNSTILE_HEADER, type GallerySessionResponse } from "../gallery/types";
import {
  buildShortShareUrl,
  copyLink,
  SHARE_CHECK_CANCELLED,
  SHARE_CHECK_REFUSED,
  SHARE_CHECK_SKIPPED,
  SHARE_RATE_LIMITED,
  type ShareCheckAnswer,
} from "../shareProject";

const project = { id: "p", name: "Song" } as Parameters<typeof buildShortShareUrl>[0];

const made = () => new Response(JSON.stringify({ id: "AbCdEfGhIjK", manageToken: "m" }), { status: 201 });
const status = (n: number) => new Response("{}", { status: n });

const posted = vi.fn();
const SIGNED_OUT: GallerySessionState = {
  status: "ready",
  session: { signInAvailable: true, providers: [], user: null, isAdmin: false } as GallerySessionResponse,
};
const SIGNED_IN: GallerySessionState = {
  status: "ready",
  session: {
    signInAvailable: true,
    providers: [],
    user: { name: "Ada", authorId: "a1", verified: { provider: "github" } },
    isAdmin: false,
  } as GallerySessionResponse,
};
const tokenSent = (call: number) => new Headers((posted.mock.calls[call][1] as RequestInit).headers).get(TURNSTILE_HEADER);

let tokens = 0;
const ask = vi.fn(async (): Promise<ShareCheckAnswer> => ({ token: `token-${++tokens}` }));

beforeEach(() => {
  tokens = 0;
  ask.mockClear();
  posted.mockReset();
  posted.mockImplementation(async () => made());
  vi.stubGlobal("fetch", posted);
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
  localStorage.clear();
  content.text = 's("bd")';
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetGallerySessionForTests();
});

describe("asking for the check", () => {
  it("signed out: asks first, and the token goes with the upload", async () => {
    resetGallerySessionForTests(SIGNED_OUT);
    expect(await buildShortShareUrl(project, ask)).toContain("/s/AbCdEfGhIjK#");
    expect(ask).toHaveBeenCalledTimes(1);
    expect(posted).toHaveBeenCalledTimes(1);
    expect(tokenSent(0)).toBe("token-1");
  });

  it("signed in: one click, no check, no token", async () => {
    resetGallerySessionForTests(SIGNED_IN);
    await buildShortShareUrl(project, ask);
    expect(ask).not.toHaveBeenCalled();
    expect(tokenSent(0)).toBeNull();
  });

  it("a session still loading, or a failed lookup, doesn't count as signed in", async () => {
    for (const state of [{ status: "loading" }, { status: "error", message: "503" }] as GallerySessionState[]) {
      ask.mockClear();
      resetGallerySessionForTests(state);
      await buildShortShareUrl(project, ask);
      expect(ask, state.status).toHaveBeenCalledTimes(1);
    }
  });

  it("no site key: nothing asked, signed out or not", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    resetGallerySessionForTests(SIGNED_OUT);
    await buildShortShareUrl(project, ask);
    expect(ask).not.toHaveBeenCalled();
    expect(tokenSent(0)).toBeNull();
  });

  it("the page thought it was signed in but the server refuses: asks then, and sends once more", async () => {
    resetGallerySessionForTests(SIGNED_IN);
    posted.mockResolvedValueOnce(status(403));
    await buildShortShareUrl(project, ask);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(posted).toHaveBeenCalledTimes(2);
    expect(tokenSent(0)).toBeNull();
    expect(tokenSent(1)).toBe("token-1");
  });

  it("a refused token is not sent again: no second request, and a named failure", async () => {
    resetGallerySessionForTests(SIGNED_OUT);
    posted.mockResolvedValue(status(403));
    await expect(buildShortShareUrl(project, ask)).rejects.toMatchObject({ name: SHARE_CHECK_REFUSED });
    expect(posted).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("each link gets its own token", async () => {
    resetGallerySessionForTests(SIGNED_OUT);
    await buildShortShareUrl(project, ask);
    await buildShortShareUrl(project, ask);
    expect([tokenSent(0), tokenSent(1)]).toEqual(["token-1", "token-2"]);
  });

  it("closing the check uploads nothing; so does choosing the long link", async () => {
    resetGallerySessionForTests(SIGNED_OUT);
    await expect(buildShortShareUrl(project, async () => ({ skip: "cancel" }))).rejects.toMatchObject({
      name: SHARE_CHECK_CANCELLED,
    });
    await expect(buildShortShareUrl(project, async () => ({ skip: "long" }))).rejects.toMatchObject({
      name: SHARE_CHECK_SKIPPED,
    });
    expect(posted).not.toHaveBeenCalled();
  });

  it("too big for a short link: says so before asking, so nobody passes a check for nothing", async () => {
    resetGallerySessionForTests(SIGNED_OUT);
    // Random text barely compresses: under the 2 MB a project may be, over the 1 MB a short link may be.
    const bytes = new Uint8Array(1_500_000);
    for (let i = 0; i < bytes.length; i += 65_536) crypto.getRandomValues(bytes.subarray(i, i + 65_536));
    content.text = Array.from(bytes, (b) => String.fromCharCode(33 + (b % 90))).join("");
    await expect(buildShortShareUrl(project, ask)).rejects.toThrow(/too large/);
    expect(ask).not.toHaveBeenCalled();
    expect(posted).not.toHaveBeenCalled();
  });

  it("past the limit is still its own failure", async () => {
    resetGallerySessionForTests(SIGNED_OUT);
    posted.mockResolvedValueOnce(status(429));
    await expect(buildShortShareUrl(project, ask)).rejects.toMatchObject({ name: SHARE_RATE_LIMITED });
  });
});

describe("copying after an async wait", () => {
  const writeText = vi.fn();
  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    closeDialog();
    vi.restoreAllMocks();
  });
  const refused = () => Object.assign(new Error("no gesture"), { name: "NotAllowedError" });
  const dialogShows = () => vi.waitFor(() => expect(getDialog()).not.toBeNull());

  it("no dialog when the browser lets it through", async () => {
    writeText.mockResolvedValue(undefined);
    expect(await copyLink("http://x/s/a#k")).toBe(true);
    expect(getDialog()).toBeNull();
  });

  it("refused: shows the link, and the Copy button's click copies it", async () => {
    writeText.mockRejectedValueOnce(refused()).mockResolvedValue(undefined);
    const done = copyLink("http://x/s/a#k");
    await dialogShows();
    const shown = getDialog();
    expect(shown?.kind === "prompt" && shown.initialValue).toBe("http://x/s/a#k");
    resolvePrompt("edited by accident");
    expect(await done).toBe(true);
    expect(writeText).toHaveBeenLastCalledWith("http://x/s/a#k");
  });

  it("closing that dialog says so", async () => {
    writeText.mockRejectedValue(refused());
    const done = copyLink("http://x/s/a#k");
    await dialogShows();
    closeDialog();
    expect(await done).toBe(false);
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
