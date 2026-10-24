/**
 * Share-by-URL — encode the active project into a gzipped base64url blob
 * that can be pasted into the location hash. The hash stays client-side
 * (never transmitted to the server). Receivers hit the same origin with
 * `#share=<blob>` and get a confirm dialog to import it as a new project.
 *
 * Size cap: 2 MB raw manifest to keep URLs under typical browser limits
 * (Chrome: ~2 MB for location.hash; most paste targets tolerate this).
 * Gzip shrinks typical Strudel projects ~4-8x.
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

export const SHARE_HASH_PREFIX = "#share=";
const MAX_RAW_BYTES = 2 * 1024 * 1024;

interface ShareManifest {
  schemaVersion: 1;
  project: { name: string; sharedAt: number };
  files: Array<{ id: string; path: string; language: string; content: string }>;
  fileOrder: Record<string, string[]>;
  subfolderOrder: Record<string, string[]>;
}

// base64url: replace `+/` with `-_` and strip `=` padding.
function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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
  const manifest = collectManifest(project);
  const json = JSON.stringify(manifest);
  const raw = new TextEncoder().encode(json);
  if (raw.byteLength > MAX_RAW_BYTES) {
    throw new Error(
      `Project too large to share via URL (${(raw.byteLength / 1024).toFixed(0)}KB > 2MB). Export the project instead.`,
    );
  }
  const zipped = await gzip(raw);
  const encoded = toBase64Url(zipped);
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${SHARE_HASH_PREFIX}${encoded}`;
}

/**
 * Decode a share payload (base64url-gzip-json). Returns the raw manifest
 * for the caller to confirm + apply. Throws on malformed input.
 */
export async function decodeSharePayload(encoded: string): Promise<ShareManifest> {
  const zipped = fromBase64Url(encoded);
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

/** Clear the share fragment from the URL without reloading. */
export function clearShareFragment(): void {
  if (typeof window === "undefined") return;
  const { origin, pathname, search } = window.location;
  window.history.replaceState(null, "", `${origin}${pathname}${search}`);
}
