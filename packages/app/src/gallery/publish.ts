/**
 * Community gallery (#2301) — what the publish dialog sends, and what it keeps
 * afterwards. No React here, so every rule the dialog applies can be tested on
 * its own.
 *
 * The limits are the server's (types.ts); the dialog checks them first so a
 * person is told before anything is uploaded.
 */
import { publishToGallery, galleryEntryLink } from "./client";
import { addLocalShare, saveAuthor } from "./localShares";
import {
  MAX_AUTHOR_NAME_CHARS,
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
/** File languages a viz entry can be. */
export const VIZ_LANGUAGES: readonly string[] = ["hydra", "p5js", "glsl"];

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
 * The manifest a gallery entry carries. A project is the whole manifest; music and
 * viz are the one chosen file, at the path it has in the project, with the folder
 * orders cut down to that file and the folders above it.
 */
export function buildGalleryManifest(
  project: GalleryManifest,
  kind: GalleryKind,
  fileId: string | null,
): GalleryManifest {
  if (kind === "project") return project;
  const file = project.files.find((f) => f.id === fileId);
  if (!file) throw new Error(`choose the ${kind} file to publish`);
  if (!filesForKind([file], kind).length) throw new Error(`${file.path} isn't a ${kind} file`);

  const folder = parentOf(file.path);
  const fileOrder: Record<string, string[]> = {};
  if (project.fileOrder[folder]?.includes(file.id)) fileOrder[folder] = [file.id];

  // Each folder above the file keeps only the one subfolder on the way down to it.
  const subfolderOrder: Record<string, string[]> = {};
  let child = folder;
  while (child) {
    const parent = parentOf(child);
    const name = child.slice(parent ? parent.length + 1 : 0);
    if (project.subfolderOrder[parent]?.includes(name)) subfolderOrder[parent] = [name];
    child = parent;
  }

  return {
    schemaVersion: 1,
    project: { ...project.project },
    files: [{ ...file }],
    fileOrder,
    subfolderOrder,
  };
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

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PublishForm {
  authorName: string;
  authorEmail: string;
  title: string;
  kind: GalleryKind;
  /** The chosen file when kind is music or viz. */
  fileId: string | null;
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
  const authorName = form.authorName.trim();
  const authorEmail = form.authorEmail.trim();
  const title = form.title.trim();
  const tags = parseTags(form.tags);

  if (!authorName) errors.push("Add your name.");
  else if (authorName.length > MAX_AUTHOR_NAME_CHARS) errors.push(`Your name can be at most ${MAX_AUTHOR_NAME_CHARS} characters.`);
  if (!authorEmail) errors.push("Add your email.");
  else if (!EMAIL_SHAPE.test(authorEmail)) errors.push("That email doesn't look complete (it needs an @ and a domain).");
  if (!title) errors.push("Add a title.");
  else if (title.length > MAX_TITLE_CHARS) errors.push(`The title can be at most ${MAX_TITLE_CHARS} characters.`);
  if (tags.length > MAX_TAGS) errors.push(`Use at most ${MAX_TAGS} tags.`);
  const long = tags.filter((t) => t.length > MAX_TAG_CHARS);
  if (long.length) errors.push(`Tags can be at most ${MAX_TAG_CHARS} characters: ${long.join(", ")}.`);

  let manifest: GalleryManifest | null = null;
  try {
    manifest = buildGalleryManifest(project, form.kind, form.fileId);
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
  const request: PublishRequest = { title, kind: form.kind, tags, authorName, authorEmail, manifest };
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
 * Send it, then remember who published it and the key that lets this browser
 * delete it. Returns the entry's link. Throws the client's message on failure,
 * and remembers nothing then.
 */
export async function publishAndRemember(request: PublishRequest): Promise<{ id: string; link: string }> {
  const { id, manageToken } = await publishToGallery(request);
  saveAuthor({ name: request.authorName, email: request.authorEmail });
  addLocalShare({ id, title: request.title, kind: request.kind, publishedAt: Date.now(), manageToken });
  return { id, link: galleryEntryLink(id) };
}
