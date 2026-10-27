/**
 * Share-by-URL — encode the active project into a gzipped base64url blob
 * that can be pasted into the location hash. The hash stays client-side
 * (never transmitted to the server). Receivers hit the same origin with
 * `#share=<blob>` and get a confirm dialog to import it as a new project.
 *
 * Size cap: 2 MB raw manifest to keep URLs under typical browser limits
 * (Chrome: ~2 MB for location.hash; most paste targets tolerate this).
 * Gzip shrinks typical Strudel projects ~4-8x.
 *
 * #2248 — the short form, `/s/<id>#<key>`, carries the same gzipped manifest,
 * sealed with a key that stays in the link and stored by id (see shareCrypto.ts).
 * Copy Share Link tries it first and falls back to the long link.
 */
import {
  listWorkspaceFiles,
  getFolderOrder,
  getSubfolderOrder,
  createProject,
  touchProject,
  switchProject,
  resetFileStore,
  createWorkspaceFile,
  setFolderOrder,
  setSubfolderOrder,
  withStructBatch,
  type ProjectMeta,
  type WorkspaceLanguage,
} from "@stave/editor";

import { fromBase64Url, openShare, parseShortShare, sealShare, toBase64Url } from "./shareCrypto";

export const SHARE_HASH_PREFIX = "#share=";
const MAX_RAW_BYTES = 2 * 1024 * 1024;

interface ShareManifest {
  schemaVersion: 1;
  project: { name: string; sharedAt: number };
  files: Array<{ id: string; path: string; language: string; content: string }>;
  fileOrder: Record<string, string[]>;
  subfolderOrder: Record<string, string[]>;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  // CompressionStream is available in every modern browser (Safari 16.4+).
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  void writer.write(bytes as unknown as BufferSource);
  void writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); total += value.byteLength; }
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
  return merged;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  void writer.write(bytes as unknown as BufferSource);
  void writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); total += value.byteLength; }
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
  return merged;
}

function collectManifest(project: ProjectMeta): ShareManifest {
  const files = listWorkspaceFiles();

  const folderPaths = new Set<string>([""]);
  for (const f of files) {
    const i = f.path.lastIndexOf("/");
    folderPaths.add(i < 0 ? "" : f.path.slice(0, i));
  }
  const fileOrder: Record<string, string[]> = {};
  const subfolderOrder: Record<string, string[]> = {};
  const parentPaths = new Set<string>([""]);
  for (const fp of folderPaths) {
    const order = getFolderOrder(fp);
    if (order.length > 0) fileOrder[fp] = order;
    if (!fp) continue;
    const i = fp.lastIndexOf("/");
    parentPaths.add(i < 0 ? "" : fp.slice(0, i));
  }
  for (const pp of parentPaths) {
    const order = getSubfolderOrder(pp);
    if (order.length > 0) subfolderOrder[pp] = order;
  }

  return {
    schemaVersion: 1,
    project: { name: project.name, sharedAt: Date.now() },
    files: files.map((f) => ({
      id: f.id, path: f.path, language: f.language, content: f.content,
    })),
    fileOrder,
    subfolderOrder,
  };
}

/**
 * Build a share URL for the current project. Returns a full URL the
 * receiver can open; the compressed payload lives in the URL fragment,
 * so the server never sees it.
 */
export async function buildShareUrl(project: ProjectMeta): Promise<string> {
  const encoded = toBase64Url(await packProject(project));
  return `${window.location.origin}${appPath()}${SHARE_HASH_PREFIX}${encoded}`;
}

/** The project's manifest, gzipped. Throws past the 2 MB cap. */
async function packProject(project: ProjectMeta): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(JSON.stringify(collectManifest(project)));
  if (raw.byteLength > MAX_RAW_BYTES) {
    throw new Error(
      `Project too large to share via URL (${(raw.byteLength / 1024).toFixed(0)}KB > 2MB). Export the project instead.`,
    );
  }
  return gzip(raw);
}

/**
 * The page the app lives on. A short link's `/s/<id>` is an address for one shared
 * project, not a place to build links from or return to.
 */
function appPath(): string {
  const { pathname } = window.location;
  return parseShortShare(pathname, "") ? "/" : pathname;
}

/**
 * #2248 — a short link, `/s/<id>#<key>`. The project is sealed here with a fresh
 * key and only the sealed bytes are uploaded; the key stays in the link's `#` part,
 * which browsers never send. Throws when the store can't take it (offline, not set
 * up, too large) — the caller falls back to the long link.
 */
export async function buildShortShareUrl(project: ProjectMeta): Promise<string> {
  const { sealed, key } = await sealShare(await packProject(project));
  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: sealed as BodyInit,
  });
  if (!res.ok) throw new Error(`the share store answered ${res.status}`);
  const { id } = (await res.json()) as { id: string };
  return `${window.location.origin}/s/${id}#${key}`;
}

/**
 * Decode a share payload (base64url-gzip-json). Returns the raw manifest
 * for the caller to confirm + apply. Throws on malformed input.
 */
export async function decodeSharePayload(encoded: string): Promise<ShareManifest> {
  return unpackManifest(fromBase64Url(encoded));
}

async function unpackManifest(zipped: Uint8Array): Promise<ShareManifest> {
  const raw = await gunzip(zipped);
  const json = new TextDecoder().decode(raw);
  const manifest = JSON.parse(json) as ShareManifest;
  if (manifest.schemaVersion !== 1) {
    throw new Error(`Unsupported share schema (${manifest.schemaVersion})`);
  }
  return manifest;
}

/**
 * Apply a decoded share manifest as a new project. Creates + switches
 * to the new project and seeds all files + orders in one struct batch.
 */
export async function applyShareManifest(manifest: ShareManifest): Promise<ProjectMeta> {
  const name = `${manifest.project.name} (shared)`;
  const meta = await createProject(name);
  resetFileStore();
  await switchProject(meta.id);
  await touchProject(meta.id);

  withStructBatch(() => {
    for (const f of manifest.files) {
      createWorkspaceFile(f.id, f.path, f.content, f.language as WorkspaceLanguage);
    }
    for (const [folder, ids] of Object.entries(manifest.fileOrder)) {
      setFolderOrder(folder, ids);
    }
    for (const [parent, names] of Object.entries(manifest.subfolderOrder)) {
      setSubfolderOrder(parent, names);
    }
  });

  return meta;
}

/**
 * Read a `#share=` fragment from the current URL. Returns the encoded
 * payload or null. Does NOT consume the fragment — caller should clear
 * it after the import confirmation completes.
 */
export function readShareFragment(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash || "";
  if (!hash.startsWith(SHARE_HASH_PREFIX)) return null;
  return hash.slice(SHARE_HASH_PREFIX.length);
}

/** A share the page was opened with: a long `#share=` link or a short `/s/<id>` one. */
export type IncomingShare =
  | { kind: "long"; encoded: string }
  | { kind: "short"; id: string; key: string | null };

export function readIncomingShare(): IncomingShare | null {
  if (typeof window === "undefined") return null;
  const short = parseShortShare(window.location.pathname, window.location.hash);
  if (short) return { kind: "short", ...short };
  const encoded = readShareFragment();
  return encoded ? { kind: "long", encoded } : null;
}

/** Fetch (for a short link) and decode a share. Throws a reason a person can act on. */
export async function loadIncomingShare(share: IncomingShare): Promise<ShareManifest> {
  if (share.kind === "long") return decodeSharePayload(share.encoded);
  if (!share.key) throw new Error("the link is missing its key; copy the whole link, including the part after #");
  const res = await fetch(`/api/share/${share.id}`);
  if (res.status === 404) throw new Error("this share link wasn't found");
  if (res.status === 503) throw new Error("short links aren't set up on this site");
  if (!res.ok) throw new Error(`the share store answered ${res.status}`);
  const sealed = new Uint8Array(await res.arrayBuffer());
  return unpackManifest(await openShare(sealed, share.key));
}

/** Clear the share from the URL without reloading (a short link goes back to the app's page). */
export function clearShareFragment(): void {
  if (typeof window === "undefined") return;
  const { origin, search } = window.location;
  window.history.replaceState(null, "", `${origin}${appPath()}${search}`);
}
