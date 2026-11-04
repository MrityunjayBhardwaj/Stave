// @vitest-environment node
// #2248 — short share links: the sealed form, the link's address, and the two routes
// against the dev folder store.
import { afterEach, beforeEach, describe, expect, it, vi, beforeAll } from "vitest";

import {
  MAX_SEALED_BYTES,
  SHARE_ID_PATTERN,
  isSealedShape,
  newShareId,
  openShare,
  parseShortShare,
  sealShare,
} from "../shareCrypto";
import { POST } from "../app/api/share/route";
import { DELETE, GET } from "../app/api/share/[id]/route";
import { shareStore } from "../app/api/share/store";
import { getDb } from "../db/client";

// #2352 — the gallery's records are in an in-memory Postgres (PGlite) per test
// file. Starting it takes a few seconds, once; do it here, not inside the first test.
beforeAll(() => getDb(), 60_000);

const text = (s: string) => new TextEncoder().encode(s);
const read = (b: Uint8Array) => new TextDecoder().decode(b);

describe("sealing a shared project", () => {
  it("opens with the key it was sealed with", async () => {
    const { sealed, key } = await sealShare(text("$: s(\"bd sd\")"));
    expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(read(await openShare(sealed, key))).toBe("$: s(\"bd sd\")");
  });

  it("does not carry the project in readable form", async () => {
    const { sealed } = await sealShare(text("a very recognisable song title"));
    expect(read(sealed)).not.toContain("recognisable");
  });

  it("refuses another link's key", async () => {
    const a = await sealShare(text("one"));
    const b = await sealShare(text("two"));
    await expect(openShare(a.sealed, b.key)).rejects.toThrow("doesn't open");
  });

  it("refuses bytes changed after sealing", async () => {
    const { sealed, key } = await sealShare(text("one"));
    sealed[sealed.length - 1] ^= 1;
    await expect(openShare(sealed, key)).rejects.toThrow("doesn't open");
  });

  it("refuses a cut-short key", async () => {
    const { sealed, key } = await sealShare(text("one"));
    await expect(openShare(sealed, key.slice(0, 10))).rejects.toThrow("incomplete");
  });

  it("checks only the shape without the key", async () => {
    const { sealed } = await sealShare(text("x"));
    expect(isSealedShape(sealed)).toBe(true);
    expect(isSealedShape(sealed.slice(0, 20))).toBe(false);
    const wrongVersion = sealed.slice();
    wrongVersion[0] = 2;
    expect(isSealedShape(wrongVersion)).toBe(false);
    const big = new Uint8Array(MAX_SEALED_BYTES + 1);
    big[0] = 1;
    expect(isSealedShape(big)).toBe(false);
  });

  it("makes fresh 11-character ids", () => {
    const ids = new Set(Array.from({ length: 200 }, newShareId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(SHARE_ID_PATTERN);
  });
});

describe("reading a short link's address", () => {
  const key = "A".repeat(22);
  it("reads the id from the path and the key from after #", () => {
    expect(parseShortShare("/s/k3Fq9xT2abc", `#${key}`)).toEqual({ id: "k3Fq9xT2abc", key });
    expect(parseShortShare("/s/k3Fq9xT2abc/", `#${key}`)).toEqual({ id: "k3Fq9xT2abc", key });
  });
  it("keeps the id when the key is missing or cut short, so the reason can be shown", () => {
    expect(parseShortShare("/s/k3Fq9xT2abc", "")).toEqual({ id: "k3Fq9xT2abc", key: null });
    expect(parseShortShare("/s/k3Fq9xT2abc", "#AAAA")).toEqual({ id: "k3Fq9xT2abc", key: null });
  });
  it("is not a short link anywhere else", () => {
    expect(parseShortShare("/", `#${key}`)).toBeNull();
    expect(parseShortShare("/s/short", `#${key}`)).toBeNull();
    expect(parseShortShare("/docs/s/k3Fq9xT2abc", `#${key}`)).toBeNull();
  });
});

describe("the share routes (dev folder store)", () => {
  // #2330 — link creation is limited per address, and every test here is the
  // same (unknown) address in the shared dev folder; the limit itself is tested
  // in galleryRateLimit.test.ts.
  beforeEach(() => vi.stubEnv("STAVE_RATE_LIMIT_LINK", "1000000"));
  afterEach(() => vi.unstubAllEnvs());

  const post = (body: Uint8Array) =>
    POST(new Request("http://x/api/share", { method: "POST", body: body as BodyInit }));
  const get = (id: string) => GET(new Request(`http://x/api/share/${id}`), { params: Promise.resolve({ id }) });

  it("stores sealed bytes and hands back the same bytes by id", async () => {
    const { sealed, key } = await sealShare(text("stored"));
    const res = await post(sealed);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(id).toMatch(SHARE_ID_PATTERN);

    const back = await get(id);
    expect(back.status).toBe(200);
    // #2311 — a link can be revoked, so its answer is never cached.
    expect(back.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await back.arrayBuffer());
    expect(read(await openShare(bytes, key))).toBe("stored");
  });

  it("gives every upload its own id", async () => {
    const { sealed } = await sealShare(text("same"));
    const a = (await (await post(sealed)).json()) as { id: string };
    const b = (await (await post(sealed)).json()) as { id: string };
    expect(a.id).not.toBe(b.id);
  });

  it("refuses bytes that are not a sealed project", async () => {
    expect((await post(text("hello, plain text"))).status).toBe(400);
  });

  it("refuses a project past the cap", async () => {
    const big = new Uint8Array(MAX_SEALED_BYTES + 1);
    big[0] = 1;
    expect((await post(big)).status).toBe(413);
  });

  it("answers 404 for an unknown or malformed id", async () => {
    expect((await get(newShareId())).status).toBe(404);
    expect((await get("../../etc/passwd")).status).toBe(404);
  });

  // #2311 — revoking a link.
  const revoke = (id: string, token?: string) =>
    DELETE(
      new Request(`http://x/api/share/${id}`, {
        method: "DELETE",
        headers: token ? { "x-stave-manage-token": token } : {},
      }),
      { params: Promise.resolve({ id }) },
    );

  it("hands back a manage token once, and keeps only its hash", async () => {
    const { sealed } = await sealShare(text("token"));
    const body = (await (await post(sealed)).json()) as { id: string; manageToken: string };
    expect(body.manageToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await shareStore()!.getManageHash(body.id);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(body.manageToken);
  });

  it("revokes with the right token only, and the link stops opening", async () => {
    const { sealed } = await sealShare(text("revoke me"));
    const { id, manageToken } = (await (await post(sealed)).json()) as { id: string; manageToken: string };

    expect((await revoke(id)).status).toBe(403);
    expect((await revoke(id, "not-the-token")).status).toBe(403);
    expect((await get(id)).status).toBe(200);

    expect((await revoke(id, manageToken)).status).toBe(204);
    expect((await get(id)).status).toBe(404);
    expect(await shareStore()!.getManageHash(id)).toBeNull();
    // already gone
    expect((await revoke(id, manageToken)).status).toBe(404);
  });

  it("can't revoke a link made before revoking existed (no token on record)", async () => {
    const { sealed } = await sealShare(text("old link"));
    const id = newShareId();
    expect(await shareStore()!.put(id, sealed)).toBe(true);
    const res = await revoke(id, "anything");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain("before links could be revoked");
    expect((await get(id)).status).toBe(200);
  });

  it("answers 404 when revoking an unknown or malformed id", async () => {
    expect((await revoke(newShareId(), "t")).status).toBe(404);
    expect((await revoke("../../etc/passwd", "t")).status).toBe(404);
  });

  it("answers 503 on a production build with no store, so the client falls back", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("STAVE_SHARE_DEV_STORE", "");
    const { sealed } = await sealShare(text("x"));
    expect((await post(sealed)).status).toBe(503);
    expect((await get(newShareId())).status).toBe(503);
  });
});
