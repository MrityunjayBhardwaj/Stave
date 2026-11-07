import {
  GALLERY_ID_PATTERN,
  GALLERY_KINDS,
  MAX_AUTHOR_NAME_CHARS,
  MAX_BIO_CHARS,
  MAX_COLLECTION_DESCRIPTION_CHARS,
  MAX_COLLECTION_ENTRIES,
  MAX_COLLECTION_TITLE_CHARS,
  type AuthorUpdateRequest,
  type CollectionWriteRequest,
  MAX_MANIFEST_BYTES,
  MAX_REPORT_REASON_CHARS,
  MAX_TAG_CHARS,
  MAX_TAGS,
  MAX_THUMBNAIL_BYTES,
  MAX_TITLE_CHARS,
  type GalleryKind,
  type GalleryManifest,
} from "../../../gallery/types";
import { isReservedName, RESERVED_NAME_ERROR } from "../../../gallery/reservedNames";

// #2299 — what the server accepts. The limits come from the shared contract
// (gallery/types.ts) so the publish dialog can say the same thing before it uploads.

export type Checked<T> = { ok: true; value: T } | { ok: false; status: 400 | 413; error: string };

const bad = (error: string): Checked<never> => ({ ok: false, status: 400, error });
const tooLarge = (error: string): Checked<never> => ({ ok: false, status: 413, error });

/** The largest request body worth reading: a full manifest, a full thumbnail as base64, and room for the rest. */
export const MAX_PUBLISH_BODY_BYTES =
  MAX_MANIFEST_BYTES + Math.ceil((MAX_THUMBNAIL_BYTES * 4) / 3) + 64 * 1024;
export const MAX_REPORT_BODY_BYTES = 16 * 1024;

export interface ValidPublish {
  title: string;
  kind: GalleryKind;
  tags: string[];
  manifest: GalleryManifest;
  manifestBytes: Uint8Array;
  thumbnail: { bytes: Uint8Array; contentType: "image/png" | "image/webp" } | null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function boundedText(v: unknown, field: string, max: number): Checked<string> {
  if (typeof v !== "string") return bad(`${field} is missing`);
  const s = v.trim();
  if (!s) return bad(`${field} is empty`);
  if (s.length > max) return bad(`${field} is longer than ${max} characters`);
  return { ok: true, value: s };
}


function stringRecord(v: unknown): Record<string, string[]> | null {
  if (!isObject(v)) return null;
  const out: Record<string, string[]> = {};
  for (const [k, list] of Object.entries(v)) {
    if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) return null;
    out[k] = list as string[];
  }
  return out;
}

/** Rebuild the manifest from its known fields only, or say what is wrong. */
function checkManifest(v: unknown, kind: GalleryKind): Checked<GalleryManifest> {
  if (!isObject(v)) return bad("manifest is missing");
  if (v.schemaVersion !== 1) return bad("manifest schemaVersion must be 1");
  const project = v.project;
  if (!isObject(project) || typeof project.name !== "string" || typeof project.sharedAt !== "number") {
    return bad("manifest project must have a name and sharedAt");
  }
  if (!Array.isArray(v.files) || v.files.length === 0) return bad("manifest has no files");
  const files: GalleryManifest["files"] = [];
  for (const f of v.files) {
    if (
      !isObject(f) ||
      typeof f.id !== "string" ||
      typeof f.path !== "string" ||
      typeof f.language !== "string" ||
      typeof f.content !== "string"
    ) {
      return bad("each manifest file needs id, path, language and content");
    }
    files.push({ id: f.id, path: f.path, language: f.language, content: f.content });
  }
  if ((kind === "music" || kind === "viz") && files.length !== 1) {
    return bad(`a ${kind} entry carries exactly one file`);
  }
  const fileOrder = stringRecord(v.fileOrder);
  const subfolderOrder = stringRecord(v.subfolderOrder);
  if (!fileOrder || !subfolderOrder) return bad("manifest fileOrder and subfolderOrder must map folders to lists");
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      project: { name: project.name, sharedAt: project.sharedAt },
      files,
      fileOrder,
      subfolderOrder,
    },
  };
}

const THUMBNAIL = /^data:(image\/png|image\/webp);base64,([A-Za-z0-9+/]*={0,2})$/;

/** What the bytes say they are, or null. Used on publish and again when serving. */
export function sniffImage(bytes: Uint8Array): "image/png" | "image/webp" | null {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && PNG.every((b, i) => bytes[i] === b)) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

function checkThumbnail(v: unknown): Checked<ValidPublish["thumbnail"]> {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  if (typeof v !== "string") return bad("thumbnail must be a data URL");
  const m = THUMBNAIL.exec(v);
  if (!m) return bad("thumbnail must be a base64 PNG or WebP data URL");
  const contentType = m[1] as "image/png" | "image/webp";
  // Size first, from the base64 length, so a huge string is refused before decoding.
  const decodedLength = Math.floor((m[2].length * 3) / 4) - (m[2].endsWith("==") ? 2 : m[2].endsWith("=") ? 1 : 0);
  if (decodedLength > MAX_THUMBNAIL_BYTES) return tooLarge(`thumbnail is larger than ${MAX_THUMBNAIL_BYTES} bytes`);
  const bytes = new Uint8Array(Buffer.from(m[2], "base64"));
  if (sniffImage(bytes) !== contentType) return bad(`thumbnail is not a ${contentType} image`);
  return { ok: true, value: { bytes, contentType } };
}

export function checkPublish(body: unknown): Checked<ValidPublish> {
  if (!isObject(body)) return bad("expected a JSON object");

  const title = boundedText(body.title, "title", MAX_TITLE_CHARS);
  if (!title.ok) return title;
  if (typeof body.kind !== "string" || !(GALLERY_KINDS as readonly string[]).includes(body.kind)) {
    return bad(`kind must be one of ${GALLERY_KINDS.join(", ")}`);
  }
  const kind = body.kind as GalleryKind;

  if (!Array.isArray(body.tags)) return bad("tags must be a list");
  const tags: string[] = [];
  for (const t of body.tags) {
    if (typeof t !== "string") return bad("each tag must be text");
    const s = t.trim();
    if (!s) continue;
    if (s.length > MAX_TAG_CHARS) return bad(`a tag is longer than ${MAX_TAG_CHARS} characters`);
    if (!tags.includes(s)) tags.push(s);
  }
  if (tags.length > MAX_TAGS) return bad(`at most ${MAX_TAGS} tags`);

  // #2319 — authorName and authorEmail are no longer read: the author is the
  // signed-in account's, and an old client that still sends them isn't refused.

  const manifest = checkManifest(body.manifest, kind);
  if (!manifest.ok) return manifest;
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest.value));
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
    return tooLarge(`project is larger than ${MAX_MANIFEST_BYTES} bytes`);
  }

  const thumbnail = checkThumbnail(body.thumbnail);
  if (!thumbnail.ok) return thumbnail;

  return {
    ok: true,
    value: {
      title: title.value,
      kind,
      tags,
      manifest: manifest.value,
      manifestBytes,
      thumbnail: thumbnail.value,
    },
  };
}

// ── #2314 profiles and #2315 collections ─────────────────────────────────────

export const MAX_AUTHOR_BODY_BYTES = MAX_BIO_CHARS * 4 + 16 * 1024;
export const MAX_COLLECTION_BODY_BYTES = 64 * 1024;

/**
 * A profile edit. The name is trimmed like a publish name; the bio is markdown
 * and kept exactly as typed (no trimming, no sanitising): it is only ever
 * served as JSON, and the client renders it with raw HTML escaped. The server
 * must never render it into a page itself.
 *
 * #2368 — a new name can't be a reserved one. `currentName` is the name stored
 * now: keeping it is always allowed, so a profile named before the rule existed
 * can still edit its bio. Only a change is checked.
 */
export function checkAuthorUpdate(body: unknown, currentName: string): Checked<AuthorUpdateRequest> {
  if (!isObject(body)) return bad("expected a JSON object");
  const name = boundedText(body.name, "name", MAX_AUTHOR_NAME_CHARS);
  if (!name.ok) return name;
  if (name.value !== currentName && isReservedName(name.value)) return bad(RESERVED_NAME_ERROR);
  if (typeof body.bio !== "string") return bad("bio is missing");
  if (body.bio.length > MAX_BIO_CHARS) return bad(`bio is longer than ${MAX_BIO_CHARS} characters`);
  return { ok: true, value: { name: name.value, bio: body.bio } };
}

/**
 * A collection's fields. Ids are checked for shape here, deduplicated keeping
 * the first place each appears, and capped; whether each is the caller's own,
 * live entry is checked against the store by the route.
 */
export function checkCollectionWrite(body: unknown): Checked<CollectionWriteRequest> {
  if (!isObject(body)) return bad("expected a JSON object");
  const title = boundedText(body.title, "title", MAX_COLLECTION_TITLE_CHARS);
  if (!title.ok) return title;
  if (typeof body.description !== "string") return bad("description is missing");
  const description = body.description.trim();
  if (description.length > MAX_COLLECTION_DESCRIPTION_CHARS) {
    return bad(`description is longer than ${MAX_COLLECTION_DESCRIPTION_CHARS} characters`);
  }
  if (!Array.isArray(body.entryIds)) return bad("entryIds must be a list");
  const entryIds: string[] = [];
  for (const id of body.entryIds) {
    if (typeof id !== "string" || !GALLERY_ID_PATTERN.test(id)) {
      return bad(`entry id ${JSON.stringify(String(id)).slice(0, 40)} is not a gallery id`);
    }
    if (!entryIds.includes(id)) entryIds.push(id);
  }
  if (entryIds.length > MAX_COLLECTION_ENTRIES) return bad(`at most ${MAX_COLLECTION_ENTRIES} entries in a collection`);
  return { ok: true, value: { title: title.value, description, entryIds } };
}

export function checkReport(body: unknown): Checked<{ reason: string }> {
  if (!isObject(body)) return bad("expected a JSON object");
  const reason = boundedText(body.reason, "reason", MAX_REPORT_REASON_CHARS);
  if (!reason.ok) return reason;
  return { ok: true, value: { reason: reason.value } };
}

/**
 * Read a JSON body no larger than `max` bytes. The declared length is checked
 * first so a huge upload is refused before it is read, then the real length.
 */
export async function readJsonBody(req: Request, max: number): Promise<Checked<unknown>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max) return tooLarge("request is too large");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > max) return tooLarge("request is too large");
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return bad("request body is not JSON");
  }
}
