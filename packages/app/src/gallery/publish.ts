/**
 * Community gallery (#2301) — what the publish dialog sends, and what it keeps
 * afterwards. No React here, so every rule the dialog applies can be tested on
 * its own.
 *
 * The limits are the server's (types.ts); the dialog checks them first so a
 * person is told before anything is uploaded.
 */
import { VIZ_LANGUAGES as EDITOR_VIZ_LANGUAGES } from "@stave/editor";
import { findVizFileByName, type NamedVizFile } from "../visualizers/vizFileLookup";
import { publishToGallery, galleryEntryLink } from "./client";
import { withLibrariesFile } from "./libraries";
import { addLocalShare, recordListChange } from "./localShares";
import {
  MAX_MANIFEST_BYTES,
  MAX_TAGS,
  MAX_TAG_CHARS,
  MAX_THUMBNAIL_BYTES,
  MAX_TITLE_CHARS,
  type GalleryKind,
  type GalleryManifest,
  type PublishRequest,
} from "./types";

/** File languages a music entry can be. */
export const MUSIC_LANGUAGES: readonly string[] = ["strudel", "sonicpi"];
/** File languages a viz entry can be: the editor's own list, so a new viz
 *  kind can be published the day it can be written (#2516). */
export const VIZ_LANGUAGES: readonly string[] = EDITOR_VIZ_LANGUAGES;

type ManifestFile = GalleryManifest["files"][number];

/** The files a single-file entry of `kind` may be. A project has no file to choose. */
export function filesForKind(files: readonly ManifestFile[], kind: GalleryKind): ManifestFile[] {
  if (kind === "music") return files.filter((f) => MUSIC_LANGUAGES.includes(f.language));
  if (kind === "viz") return files.filter((f) => VIZ_LANGUAGES.includes(f.language));
  return [];
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/**
 * The project cut down to `keep`: those files at the paths they have in the
 * project, each folder's file order holding only them, and each folder's
 * subfolder order holding only the folders on the way down to one of them.
 * Folders left with nothing are dropped.
 */
function cutDown(project: GalleryManifest, keep: readonly ManifestFile[]): GalleryManifest {
  const ids = new Set(keep.map((f) => f.id));
  // every folder that still holds a kept file, at any depth ("" is the root)
  const live = new Set<string>([""]);
  for (const f of keep) {
    for (let folder = parentOf(f.path); folder && !live.has(folder); folder = parentOf(folder)) live.add(folder);
  }
  const fileOrder: Record<string, string[]> = {};
  for (const [folder, order] of Object.entries(project.fileOrder)) {
    const kept = order.filter((id) => ids.has(id));
    if (kept.length) fileOrder[folder] = kept;
  }
  const subfolderOrder: Record<string, string[]> = {};
  for (const [parent, names] of Object.entries(project.subfolderOrder)) {
    if (!live.has(parent)) continue;
    const kept = names.filter((name) => live.has(parent ? `${parent}/${name}` : name));
    if (kept.length) subfolderOrder[parent] = kept;
  }
  return {
    schemaVersion: 1,
    project: { ...project.project },
    files: keep.map((f) => ({ ...f })),
    fileOrder,
    subfolderOrder,
  };
}

/**
 * The manifest a gallery entry carries. Music and viz are the one chosen file.
 * #2632 — a project is the files ticked in the dialog (`fileIds`), or the whole
 * project when nothing was chosen (null). Either way each file keeps the path it
 * has in the project, and the folder orders are cut down to what is sent.
 * #2642 — a viz entry or a ticked project whose sketch imports a library also
 * carries the project's `stave.libs.json`, so the library loads wherever the
 * entry is opened (libraries.ts).
 */
export function buildGalleryManifest(
  project: GalleryManifest,
  kind: GalleryKind,
  fileId: string | null,
  fileIds: readonly string[] | null = null,
): GalleryManifest {
  if (kind === "project") {
    if (!fileIds) return project;
    const picked = new Set(fileIds);
    const keep = project.files.filter((f) => picked.has(f.id));
    if (!keep.length) throw new Error("tick at least one file to publish");
    const carried = withLibrariesFile(project, keep);
    return carried.length === project.files.length ? project : cutDown(project, carried);
  }
  const file = project.files.find((f) => f.id === fileId);
  if (!file) throw new Error(`choose the ${kind} file to publish`);
  if (!filesForKind([file], kind).length) throw new Error(`${file.path} isn't a ${kind} file`);
  return cutDown(project, kind === "viz" ? withLibrariesFile(project, [file]) : [file]);
}

const VIZ_CALL = /\.viz\(\s*["'`]([^"'`]+)["'`]/g;

/**
 * #2632 — visuals a ticked pattern draws (`.viz("name")`) whose file is in the
 * project but not ticked: the published entry would not find them. Each as
 * the pattern's path and the visual's path. A name no project file answers to
 * (a built-in such as `pianoroll`) is not a file, so it is never listed.
 */
export function untickedVizUses(
  project: GalleryManifest,
  fileIds: readonly string[],
): Array<{ pattern: string; visual: string }> {
  const picked = new Set(fileIds);
  // a manifest's language is a plain string; the lookup reads it the way the studio does
  const all = project.files as ReadonlyArray<ManifestFile & NamedVizFile>;
  const ticked = all.filter((f) => picked.has(f.id));
  const out: Array<{ pattern: string; visual: string }> = [];
  const seen = new Set<string>();
  for (const f of ticked) {
    if (!MUSIC_LANGUAGES.includes(f.language)) continue;
    for (const m of f.content.matchAll(VIZ_CALL)) {
      const name = m[1];
      if (findVizFileByName(ticked, name)) continue;
      const file = findVizFileByName(all, name);
      const key = `${f.path}\u0000${file?.path}`;
      if (file && !seen.has(key)) {
        seen.add(key);
        out.push({ pattern: f.path, visual: file.path });
      }
    }
  }
  return out;
}

/** "Ambient, drums,ambient , " → ["Ambient", "drums"]: trimmed, empties dropped, repeats (any case) dropped. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const tag = raw.trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

/**
 * #2319 — no name or email: publishing needs a signed-in account, the name shown
 * is the profile's (changed on the profile), and the email is the account's.
 */
export interface PublishForm {
  title: string;
  kind: GalleryKind;
  /** The chosen file when kind is music or viz. */
  fileId: string | null;
  /** #2632 — the files a project carries; null (or left out) for every file. */
  fileIds?: string[] | null;
  /** As typed: comma-separated. */
  tags: string;
}

/** Byte length of a string as UTF-8, which is what the server measures. */
export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

/**
 * Build the request, or say everything that is wrong with the form. `thumbnail` is
 * a data URL, or undefined for none.
 */
export function buildPublishRequest(
  form: PublishForm,
  project: GalleryManifest,
  thumbnail?: string,
): { request: PublishRequest; errors: [] } | { request: null; errors: string[] } {
  const errors: string[] = [];
  const title = form.title.trim();
  const tags = parseTags(form.tags);

  if (!title) errors.push("Add a title.");
  else if (title.length > MAX_TITLE_CHARS) errors.push(`The title can be at most ${MAX_TITLE_CHARS} characters.`);
  if (tags.length > MAX_TAGS) errors.push(`Use at most ${MAX_TAGS} tags.`);
  const long = tags.filter((t) => t.length > MAX_TAG_CHARS);
  if (long.length) errors.push(`Tags can be at most ${MAX_TAG_CHARS} characters: ${long.join(", ")}.`);

  let manifest: GalleryManifest | null = null;
  try {
    manifest = buildGalleryManifest(project, form.kind, form.fileId, form.fileIds ?? null);
  } catch (err) {
    errors.push(`${capitalise((err as Error).message)}.`);
  }
  if (manifest) {
    const bytes = utf8Bytes(JSON.stringify(manifest));
    if (bytes > MAX_MANIFEST_BYTES) {
      errors.push(`This is ${kib(bytes)}; the gallery takes at most ${kib(MAX_MANIFEST_BYTES)}.`);
    }
  }
  // Music entries get a generated card; a thumbnail is only for what draws.
  const thumb = form.kind === "music" ? undefined : thumbnail;
  if (thumb && dataUrlBytes(thumb) > MAX_THUMBNAIL_BYTES) errors.push("The thumbnail is too large; leave it out.");

  if (errors.length || !manifest) return { request: null, errors };
  const request: PublishRequest = { title, kind: form.kind, tags, manifest };
  if (thumb) request.thumbnail = thumb;
  return { request, errors: [] };
}

/** Decoded size of a base64 data URL. */
export function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export function kib(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Send it (the session cookie says who is publishing), then keep the entry's
 * manage token so My shares on this browser can delete it. Returns the entry's
 * link. Throws the client's message on failure, and keeps nothing then.
 *
 * #2319 — no author key is sent or kept any more: the entry lands on the
 * signed-in account's author. A key this browser already holds from before
 * sign-in stays where it is (localShares.ts) for #2320 to claim.
 */
export async function publishAndRemember(
  request: PublishRequest,
  turnstileToken?: string | null,
): Promise<{ id: string; link: string }> {
  const { id, manageToken, entry } = await publishToGallery(request, turnstileToken);
  if (entry) recordListChange(id, entry);
  addLocalShare({ id, title: request.title, kind: request.kind, publishedAt: Date.now(), manageToken });
  return { id, link: galleryEntryLink(id) };
}
