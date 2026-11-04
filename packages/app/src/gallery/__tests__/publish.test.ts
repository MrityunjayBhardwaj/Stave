import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildGalleryManifest,
  buildPublishRequest,
  dataUrlBytes,
  filesForKind,
  parseTags,
  publishAndRemember,
  type PublishForm,
} from "../publish";
import { listLocalShares, loadAuthor } from "../localShares";
import { MAX_MANIFEST_BYTES, MAX_TAGS, MAX_THUMBNAIL_BYTES, type GalleryManifest } from "../types";

function project(): GalleryManifest {
  return {
    schemaVersion: 1,
    project: { name: "Night drive", sharedAt: 1000 },
    files: [
      { id: "song", path: "song.strudel", language: "strudel", content: 's("bd sd")' },
      { id: "notes", path: "README.md", language: "markdown", content: "# hi" },
      { id: "waves", path: "preset/viz/waves.hydra", language: "hydra", content: "osc().out()" },
      { id: "dots", path: "preset/viz/dots.p5", language: "p5js", content: "draw()" },
      { id: "sky", path: "art/sky.glsl", language: "glsl", content: "void main(){}" },
    ],
    fileOrder: { "": ["song", "notes"], "preset/viz": ["dots", "waves"], art: ["sky"] },
    subfolderOrder: { "": ["preset", "art"], preset: ["viz"] },
  };
}

const form = (over: Partial<PublishForm> = {}): PublishForm => ({
  authorName: "Ada",
  authorEmail: "ada@example.com",
  title: "Night drive",
  kind: "project",
  fileId: null,
  tags: "",
  ...over,
});

describe("which files a single-file entry may be", () => {
  it("music is pattern code, viz is hydra / p5 / glsl, a project chooses none", () => {
    const files = project().files;
    expect(filesForKind(files, "music").map((f) => f.id)).toEqual(["song"]);
    expect(filesForKind(files, "viz").map((f) => f.id)).toEqual(["waves", "dots", "sky"]);
    expect(filesForKind(files, "project")).toEqual([]);
  });
});

describe("the manifest each kind sends", () => {
  it("a project sends the whole manifest", () => {
    const p = project();
    expect(buildGalleryManifest(p, "project", null)).toBe(p);
  });

  it("music sends the one file, with the root order cut down to it", () => {
    const m = buildGalleryManifest(project(), "music", "song");
    expect(m.files.map((f) => f.id)).toEqual(["song"]);
    expect(m.fileOrder).toEqual({ "": ["song"] });
    expect(m.subfolderOrder).toEqual({});
    expect(m.project.name).toBe("Night drive");
  });

  it("a nested viz keeps its path, and each folder above it keeps only the way down", () => {
    const m = buildGalleryManifest(project(), "viz", "waves");
    expect(m.files).toEqual([project().files[2]]);
    expect(m.fileOrder).toEqual({ "preset/viz": ["waves"] });
    expect(m.subfolderOrder).toEqual({ "": ["preset"], preset: ["viz"] });
  });

  it("a folder with no explicit order stays without one", () => {
    const p = project();
    p.fileOrder = {};
    p.subfolderOrder = {};
    const m = buildGalleryManifest(p, "viz", "sky");
    expect(m.fileOrder).toEqual({});
    expect(m.subfolderOrder).toEqual({});
  });

  it("refuses a missing file and a file of the wrong kind", () => {
    expect(() => buildGalleryManifest(project(), "music", null)).toThrow(/choose the music file/);
    expect(() => buildGalleryManifest(project(), "viz", "song")).toThrow(/isn't a viz file/);
  });
});

describe("tags", () => {
  it("trims, drops empties and repeats of any case, keeps the first spelling", () => {
    expect(parseTags(" Ambient, drums,ambient , ,DRUMS")).toEqual(["Ambient", "drums"]);
    expect(parseTags("")).toEqual([]);
  });
});

describe("checking the form before upload", () => {
  it("a complete form becomes exactly the request the server takes", () => {
    const r = buildPublishRequest(form({ tags: "a, b", title: "  Night drive " }), project());
    expect(r.errors).toEqual([]);
    expect(Object.keys(r.request!).sort()).toEqual(["authorEmail", "authorName", "kind", "manifest", "tags", "title"]);
    expect(r.request).toMatchObject({ title: "Night drive", tags: ["a", "b"], authorEmail: "ada@example.com" });
  });

  it("says every missing or malformed field at once", () => {
    const r = buildPublishRequest(form({ authorName: " ", authorEmail: "ada@", title: "" }), project());
    expect(r.request).toBeNull();
    expect(r.errors).toEqual([
      "Add your name.",
      "That email doesn't look complete (it needs an @ and a domain).",
      "Add a title.",
    ]);
  });

  it("an email needs a local part, an @ and a dotted domain", () => {
    for (const bad of ["ada", "ada@example", "@example.com", "a da@example.com"]) {
      expect(buildPublishRequest(form({ authorEmail: bad }), project()).request, bad).toBeNull();
    }
    expect(buildPublishRequest(form({ authorEmail: "a.b+c@mail.example.org" }), project()).request).not.toBeNull();
  });

  it("holds tags and title to the server's limits", () => {
    const many = Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`).join(",");
    expect(buildPublishRequest(form({ tags: many }), project()).errors).toEqual([`Use at most ${MAX_TAGS} tags.`]);
    expect(buildPublishRequest(form({ tags: "x".repeat(25) }), project()).errors[0]).toMatch(/at most 24 characters/);
    expect(buildPublishRequest(form({ title: "x".repeat(81) }), project()).errors[0]).toMatch(/at most 80/);
  });

  it("a music or viz entry needs its file", () => {
    expect(buildPublishRequest(form({ kind: "viz" }), project()).errors).toEqual(["Choose the viz file to publish."]);
  });

  it("refuses a project past the size limit before uploading it", () => {
    const p = project();
    p.files[0].content = "x".repeat(MAX_MANIFEST_BYTES);
    expect(buildPublishRequest(form(), p).errors[0]).toMatch(/the gallery takes at most 1.0 MB/);
  });

  it("sends the picture for a project or viz, never for music", () => {
    const thumb = "data:image/webp;base64,AAAA";
    expect(buildPublishRequest(form(), project(), thumb).request?.thumbnail).toBe(thumb);
    expect(buildPublishRequest(form({ kind: "viz", fileId: "waves" }), project(), thumb).request?.thumbnail).toBe(thumb);
    const music = buildPublishRequest(form({ kind: "music", fileId: "song" }), project(), thumb).request!;
    expect("thumbnail" in music).toBe(false);
  });

  it("measures a picture by its decoded bytes", () => {
    expect(dataUrlBytes("data:image/png;base64,AAAA")).toBe(3);
    expect(dataUrlBytes("data:image/png;base64,AAA=")).toBe(2);
    const big = "data:image/webp;base64," + "A".repeat(Math.ceil(((MAX_THUMBNAIL_BYTES + 3) * 4) / 3));
    expect(buildPublishRequest(form(), project(), big).errors).toEqual(["The thumbnail is too large; leave it out."]);
  });
});

describe("publishing", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  const request = () => buildPublishRequest(form({ tags: "ambient" }), project()).request!;

  it("on success remembers the author and the entry's key, and returns its link", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "AbCdEfGhIjK", manageToken: "tok" }), { status: 201 }));
    const before = Date.now();
    const { id, link } = await publishAndRemember(request());

    expect(id).toBe("AbCdEfGhIjK");
    expect(link).toBe(`${window.location.origin}/#gallery=AbCdEfGhIjK`);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/gallery");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(request());
    expect(loadAuthor()).toEqual({ name: "Ada", email: "ada@example.com" });
    const [share] = listLocalShares();
    expect(share).toMatchObject({ id: "AbCdEfGhIjK", title: "Night drive", kind: "project", manageToken: "tok" });
    expect(share.publishedAt).toBeGreaterThanOrEqual(before);
  });

  it("on failure throws the message a person can act on, and keeps nothing", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "the title is too long" }), { status: 400 }));
    await expect(publishAndRemember(request())).rejects.toThrow("the title is too long");
    fetchMock.mockResolvedValue(new Response("", { status: 429 }));
    await expect(publishAndRemember(request())).rejects.toThrow(/published several times/);
    expect(loadAuthor()).toBeNull();
    expect(listLocalShares()).toEqual([]);
  });
});
