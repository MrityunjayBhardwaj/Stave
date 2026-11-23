/**
 * #2642 — libraries travel with gallery entries: publishing carries the
 * project's stave.libs.json when a carried sketch imports a library, the
 * server accepts it beside a viz entry's one file, the preview frame gets it
 * as `libs`, and the entry page lists what loads from where.
 */
import { describe, expect, it } from "vitest";
import { LIBS_FILE } from "@stave/editor";

import { entryLibraries, libraryNamesImported, withLibrariesFile } from "../libraries";
import { buildGalleryManifest } from "../publish";
import { parseToFrame, previewPlayFor, MAX_PREVIEW_CODE } from "../previewProtocol";
import { checkPublish } from "../../app/api/gallery/validate";
import { ENTRY_LIBS_FILE, type GalleryManifest } from "../types";

const SPARK_URL = "https://esm.sh/@sparkjsdev/spark@2.4.0?external=three";
const LIBS = JSON.stringify({ "@sparkjsdev/spark": { url: SPARK_URL, sha384: "A".repeat(64) }, unused: { url: "https://cdn.example/u.js" } });
const SPLATS = `import * as THREE from 'three'\nimport { SplatMesh } from '@sparkjsdev/spark'\nimport { OrbitControls } from 'three/addons/controls/OrbitControls.js'\n`;
const PLAIN = `import * as THREE from 'three'\n`;

function project(): GalleryManifest {
  return {
    schemaVersion: 1,
    project: { name: "Splats", sharedAt: 1000 },
    files: [
      { id: "song", path: "song.strudel", language: "strudel", content: 's("bd").viz("splats")' },
      { id: "splats", path: "viz/splats.three", language: "three", content: SPLATS },
      { id: "plain", path: "viz/plain.three", language: "three", content: PLAIN },
      { id: "libs", path: "stave.libs.json", language: "json", content: LIBS },
    ],
    fileOrder: { "": ["song", "libs"], viz: ["splats", "plain"] },
    subfolderOrder: { "": ["viz"] },
  };
}

describe("the libraries file's name", () => {
  it("the gallery's spelling is the editor's", () => {
    expect(ENTRY_LIBS_FILE).toBe(LIBS_FILE);
  });
});

describe("which names a sketch imports from a library", () => {
  it("bare names only: not three, not its addons, not URLs or paths", () => {
    const code = `${SPLATS}import x from 'https://cdn.example/x.js'\nimport y from './y.js'\nimport z from '@sparkjsdev/spark'\n`;
    expect(libraryNamesImported([{ path: "a.three", language: "three", content: code }])).toEqual(["@sparkjsdev/spark"]);
  });
  it("only sketches are read", () => {
    expect(libraryNamesImported([{ path: "a.p5", language: "p5js", content: SPLATS }])).toEqual([]);
  });
  it("a sketch that doesn't parse imports nothing", () => {
    expect(libraryNamesImported([{ path: "a.three", language: "three", content: "import {" }])).toEqual([]);
  });
});

describe("publishing carries stave.libs.json with a sketch that needs it", () => {
  it("a viz entry: the sketch, then the libraries file", () => {
    const m = buildGalleryManifest(project(), "viz", "splats");
    expect(m.files.map((f) => f.path)).toEqual(["viz/splats.three", "stave.libs.json"]);
    expect(m.files[1].content).toBe(LIBS); // byte for byte: its hashes pin the library
    expect(m.fileOrder).toEqual({ "": ["libs"], viz: ["splats"] });
  });
  it("a viz entry whose sketch imports no library carries only itself", () => {
    expect(buildGalleryManifest(project(), "viz", "plain").files.map((f) => f.path)).toEqual(["viz/plain.three"]);
  });
  it("a project with the libraries file unticked still carries it", () => {
    const m = buildGalleryManifest(project(), "project", null, ["song", "splats"]);
    expect(m.files.map((f) => f.path)).toEqual(["song.strudel", "viz/splats.three", "stave.libs.json"]);
  });
  it("a ticked project without a library sketch leaves it out", () => {
    expect(buildGalleryManifest(project(), "project", null, ["song", "plain"]).files.map((f) => f.path)).toEqual([
      "song.strudel",
      "viz/plain.three",
    ]);
  });
  it("a project with no libraries file has nothing to add", () => {
    const p = project();
    p.files = p.files.filter((f) => f.id !== "libs");
    expect(withLibrariesFile(p, [p.files[1]]).map((f) => f.id)).toEqual(["splats"]);
  });
  it("a music entry stays one file", () => {
    expect(buildGalleryManifest(project(), "music", "song").files.map((f) => f.path)).toEqual(["song.strudel"]);
  });
});

describe("the server takes a viz entry with its libraries file", () => {
  const body = (manifest: GalleryManifest, kind = "viz") => ({ title: "Splats", kind, tags: [], manifest });
  it("the sketch plus stave.libs.json is accepted", () => {
    const r = checkPublish(body(buildGalleryManifest(project(), "viz", "splats")));
    expect(r.ok).toBe(true);
  });
  it("a second file of any other name is still refused", () => {
    const m = buildGalleryManifest(project(), "viz", "splats");
    m.files[1] = { ...m.files[1], path: "other.json" };
    expect(checkPublish(body(m))).toMatchObject({ ok: false, error: "a viz entry carries exactly one file" });
  });
  it("two libraries files are refused", () => {
    const m = buildGalleryManifest(project(), "viz", "splats");
    m.files.push({ ...m.files[1], id: "libs2" });
    expect(checkPublish(body(m))).toMatchObject({ ok: false });
  });
  it("a libraries file alone is refused", () => {
    const m = buildGalleryManifest(project(), "viz", "splats");
    m.files = [m.files[1]];
    expect(checkPublish(body(m))).toMatchObject({ ok: false });
  });
  it("a music entry may not carry one", () => {
    const m = buildGalleryManifest(project(), "viz", "splats");
    m.files[0] = { ...project().files[0] };
    expect(checkPublish(body(m, "music"))).toMatchObject({ ok: false });
  });
});

describe("the preview frame gets the libraries file as `libs`", () => {
  it("previewPlayFor sends it when the entry holds it", () => {
    const files = buildGalleryManifest(project(), "viz", "splats").files;
    const msg = previewPlayFor(files, "viz/splats.three")!;
    expect(msg.libs).toBe(LIBS);
    expect(msg.files.map((f) => f.path)).toEqual(["viz/splats.three"]);
    expect(parseToFrame(msg)).toEqual(msg);
  });
  it("and leaves `libs` out when it doesn't", () => {
    const msg = previewPlayFor(buildGalleryManifest(project(), "viz", "plain").files, "viz/plain.three")!;
    expect("libs" in msg).toBe(false);
    expect(parseToFrame(msg)).toEqual(msg);
  });
  it("the frame ignores a libs that isn't a string, or is too long", () => {
    const base = { play: true, path: "a.three", files: [{ path: "a.three", kind: "three", code: "" }] };
    expect(parseToFrame({ ...base, libs: 3 })).toBeNull();
    expect(parseToFrame({ ...base, libs: "x".repeat(MAX_PREVIEW_CODE + 1) })).toBeNull();
    expect(parseToFrame({ ...base, libs: "{}", extra: 1 })).toBeNull();
    expect(parseToFrame({ ...base, libs: "{}" })).toEqual({ ...base, libs: "{}" });
  });
});

describe("what the entry page says about libraries", () => {
  it("each library a sketch imports, with the host it loads from", () => {
    expect(entryLibraries(project().files)).toEqual({
      libraries: [{ name: "@sparkjsdev/spark", host: "esm.sh", url: SPARK_URL, pinned: true }],
      problem: null,
    });
  });
  it("nothing when no sketch imports a library", () => {
    expect(entryLibraries(project().files.filter((f) => f.id !== "splats"))).toEqual({ libraries: [], problem: null });
  });
  it("a libraries file that can't be read is said so", () => {
    const files = project().files.map((f) => (f.id === "libs" ? { ...f, content: "{ nope" } : f));
    const r = entryLibraries(files);
    expect(r.libraries).toEqual([]);
    expect(r.problem).toMatch(/^stave\.libs\.json isn't valid JSON/);
  });
});
