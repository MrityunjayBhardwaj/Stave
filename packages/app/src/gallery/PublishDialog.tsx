"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectMeta } from "@stave/editor";

import { showToast } from "../dialogs/host";
import { collectManifest } from "../shareProject";
import { loadAuthor } from "./localShares";
import {
  buildPublishRequest,
  filesForKind,
  kib,
  publishAndRemember,
  type PublishForm,
} from "./publish";
import { captureLiveVizThumbnail, type CaptureResult } from "./thumbnail";
import {
  GALLERY_KINDS,
  MAX_AUTHOR_NAME_CHARS,
  MAX_MANIFEST_BYTES,
  MAX_TAGS,
  MAX_TAG_CHARS,
  MAX_THUMBNAIL_BYTES,
  MAX_TITLE_CHARS,
  type GalleryKind,
  type GalleryManifest,
} from "./types";

/**
 * #2301 — Publish to Gallery. Name and email (remembered here), a title, what the
 * entry is (the whole project, or one music or viz file), and tags. The server
 * hands back a manage token; this browser keeps it so the upload can be deleted
 * later. #2305 — a frame of the running viz goes with it as the card's picture.
 */

const KIND_LABEL: Record<GalleryKind, string> = { project: "Project", music: "Music", viz: "Viz" };
const KIND_NOTE: Record<GalleryKind, string> = {
  project: "Every file in this project.",
  music: "One pattern file.",
  viz: "One visual (Hydra, p5 or GLSL) file.",
};

interface PublishDialogProps {
  open: boolean;
  project: ProjectMeta;
  /** The tab in front of the user, so the file picker starts on it when it fits. */
  activeFileId: string | null;
  onClose: () => void;
}

type Thumb = { state: "capturing" } | { state: "done"; result: CaptureResult };

export function PublishDialog({ open, project, activeFileId, onClose }: PublishDialogProps) {
  const [manifest, setManifest] = useState<GalleryManifest | null>(null);
  const [form, setForm] = useState<PublishForm>({
    authorName: "",
    authorEmail: "",
    title: "",
    kind: "project",
    fileId: null,
    tags: "",
  });
  const [thumb, setThumb] = useState<Thumb>({ state: "capturing" });
  const [includeThumb, setIncludeThumb] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const capture = useCallback(() => {
    setThumb({ state: "capturing" });
    void captureLiveVizThumbnail().then((result) => setThumb({ state: "done", result }));
  }, []);

  // Each opening starts from the project as it is now, and from who published last.
  useEffect(() => {
    if (!open) return;
    const m = collectManifest(project) as GalleryManifest;
    const author = loadAuthor();
    setManifest(m);
    setForm({
      authorName: author?.name ?? "",
      authorEmail: author?.email ?? "",
      title: project.name.slice(0, MAX_TITLE_CHARS),
      kind: "project",
      fileId: null,
      tags: "",
    });
    setErrors([]);
    setSending(false);
    setIncludeThumb(true);
    capture();
    queueMicrotask(() => nameRef.current?.focus());
  }, [open, project, capture]);

  const choices = useMemo(() => (manifest ? filesForKind(manifest.files, form.kind) : []), [manifest, form.kind]);

  const setKind = (kind: GalleryKind) => {
    setForm((f) => {
      if (kind === "project") return { ...f, kind, fileId: null };
      const files = manifest ? filesForKind(manifest.files, kind) : [];
      const keep = files.find((x) => x.id === f.fileId) ?? files.find((x) => x.id === activeFileId) ?? files[0];
      return { ...f, kind, fileId: keep?.id ?? null };
    });
    setErrors([]);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, sending, onClose]);

  const thumbnail =
    form.kind !== "music" && includeThumb && thumb.state === "done" && thumb.result.ok
      ? thumb.result.thumbnail.dataUrl
      : undefined;

  const submit = useCallback(async () => {
    if (!manifest || sending) return;
    const built = buildPublishRequest(form, manifest, thumbnail);
    if (!built.request) {
      setErrors(built.errors);
      return;
    }
    setErrors([]);
    setSending(true);
    try {
      const { link } = await publishAndRemember(built.request);
      let copied = true;
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        copied = false;
      }
      showToast(
        copied
          ? `Published "${built.request.title}" to the gallery. Link copied.`
          : `Published "${built.request.title}" to the gallery: ${link}`,
        "info",
        6000,
      );
      onClose();
    } catch (err) {
      setErrors([(err as Error)?.message || "Publishing failed."]);
      setSending(false);
    }
  }, [manifest, sending, form, thumbnail, onClose]);

  if (!open) return null;

  const set = <K extends keyof PublishForm>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div style={styles.backdrop} onClick={sending ? undefined : onClose}>
      <div
        style={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Publish to Gallery"
        data-testid="gallery-publish-dialog"
      >
        <div style={styles.header}>
          <h2 style={styles.title}>Publish to Gallery</h2>
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close" disabled={sending}>
            ×
          </button>
        </div>

        <form
          style={styles.body}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          noValidate
        >
          <div style={styles.row2}>
            <label style={styles.field}>
              <span style={styles.label}>Your name</span>
              <input
                ref={nameRef}
                style={styles.input}
                value={form.authorName}
                onChange={set("authorName")}
                maxLength={MAX_AUTHOR_NAME_CHARS}
                autoComplete="name"
                data-testid="gallery-publish-name"
              />
            </label>
            <label style={styles.field}>
              <span style={styles.label}>Email</span>
              <input
                style={styles.input}
                type="email"
                value={form.authorEmail}
                onChange={set("authorEmail")}
                autoComplete="email"
                data-testid="gallery-publish-email"
              />
            </label>
          </div>
          <p style={styles.note}>
            Your name is shown with your upload. Your email stays private and is only used to contact you about it.
          </p>

          <label style={styles.field}>
            <span style={styles.label}>Title</span>
            <input
              style={styles.input}
              value={form.title}
              onChange={set("title")}
              maxLength={MAX_TITLE_CHARS}
              data-testid="gallery-publish-title"
            />
          </label>

          <div style={styles.field}>
            <span style={styles.label}>What to publish</span>
            <div style={styles.kinds} role="radiogroup" aria-label="What to publish">
              {GALLERY_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={form.kind === k}
                  onClick={() => setKind(k)}
                  style={{ ...styles.kind, ...(form.kind === k ? styles.kindOn : {}) }}
                  data-testid={`gallery-publish-kind-${k}`}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <span style={styles.hint}>{KIND_NOTE[form.kind]}</span>
          </div>

          {form.kind !== "project" && (
            <label style={styles.field}>
              <span style={styles.label}>File</span>
              {choices.length > 0 ? (
                <select
                  style={styles.input}
                  value={form.fileId ?? ""}
                  onChange={set("fileId")}
                  data-testid="gallery-publish-file"
                >
                  {choices.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.path}
                    </option>
                  ))}
                </select>
              ) : (
                <span style={styles.hint}>This project has no {form.kind} file.</span>
              )}
            </label>
          )}

          <label style={styles.field}>
            <span style={styles.label}>Tags</span>
            <input
              style={styles.input}
              value={form.tags}
              onChange={set("tags")}
              placeholder="ambient, drums"
              data-testid="gallery-publish-tags"
            />
            <span style={styles.hint}>
              Separate with commas. Up to {MAX_TAGS} tags, {MAX_TAG_CHARS} characters each.
            </span>
          </label>

          <div style={styles.field} data-testid="gallery-publish-thumbnail">
            <span style={styles.label}>Picture</span>
            {form.kind === "music" ? (
              <span style={styles.hint}>Music entries get a card with the title instead of a picture.</span>
            ) : thumb.state === "capturing" ? (
              <span style={styles.hint}>Taking a frame of the running viz…</span>
            ) : thumb.result.ok ? (
              <div style={styles.thumbRow}>
                <img
                  src={thumb.result.thumbnail.dataUrl}
                  alt="A frame of the running viz"
                  style={{ ...styles.thumb, opacity: includeThumb ? 1 : 0.35 }}
                  data-testid="gallery-publish-thumbnail-img"
                />
                <div style={styles.thumbSide}>
                  <label style={styles.check}>
                    <input
                      type="checkbox"
                      checked={includeThumb}
                      onChange={(e) => setIncludeThumb(e.target.checked)}
                      data-testid="gallery-publish-thumbnail-include"
                    />
                    Include this picture
                  </label>
                  <span style={styles.hint}>{kib(thumb.result.thumbnail.bytes)}</span>
                  <button type="button" style={styles.linkBtn} onClick={capture}>
                    Take another frame
                  </button>
                </div>
              </div>
            ) : (
              <span style={styles.hint}>
                {thumb.result.reason}{" "}
                <button type="button" style={styles.linkBtn} onClick={capture}>
                  Try again
                </button>
              </span>
            )}
          </div>

          <p style={styles.note}>
            Limits: title {MAX_TITLE_CHARS} characters, name {MAX_AUTHOR_NAME_CHARS}, project up to{" "}
            {kib(MAX_MANIFEST_BYTES)}, picture up to {kib(MAX_THUMBNAIL_BYTES)}. Anyone can see and open what you
            publish.
          </p>
          <p style={styles.note}>
            This browser keeps the key that lets you delete it later; clearing site data loses it.
          </p>

          {errors.length > 0 && (
            <div style={styles.errors} role="alert" data-testid="gallery-publish-errors">
              {errors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}

          <div style={styles.footer}>
            <button type="button" style={styles.cancelBtn} onClick={onClose} disabled={sending}>
              Cancel
            </button>
            <button
              type="submit"
              style={{ ...styles.primaryBtn, opacity: sending ? 0.6 : 1 }}
              disabled={sending || !manifest}
              data-testid="gallery-publish-submit"
            >
              {sending ? "Publishing…" : "Publish"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Mirrors BounceModal / TemplateModal so the dialogs read as one chrome.
const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "var(--bg-overlay)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  modal: {
    width: 500,
    maxWidth: "92vw",
    maxHeight: "92vh",
    overflowY: "auto",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    display: "flex",
    flexDirection: "column",
    color: "var(--text-chrome)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 20px",
    borderBottom: "1px solid var(--border-subtle)",
  },
  title: { margin: 0, fontSize: 16, fontWeight: 600, color: "var(--text-primary)" },
  closeBtn: {
    background: "none",
    border: "none",
    color: "var(--text-icon)",
    fontSize: 24,
    cursor: "pointer",
    padding: "0 4px",
    lineHeight: 1,
  },
  body: { padding: "16px 20px 0", display: "flex", flexDirection: "column", gap: 12, margin: 0 },
  row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  field: { display: "flex", flexDirection: "column", gap: 5, minWidth: 0 },
  label: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-tertiary)",
    fontWeight: 600,
  },
  input: {
    background: "var(--bg-panel)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 5,
    color: "var(--text-primary)",
    padding: "7px 9px",
    fontSize: 13,
    minWidth: 0,
  },
  hint: { fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.4 },
  note: { margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--text-tertiary)" },
  kinds: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 },
  kind: {
    background: "var(--bg-panel)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    padding: "8px 0",
    cursor: "pointer",
    color: "var(--text-chrome)",
    fontSize: 13,
    fontWeight: 600,
  },
  kindOn: {
    background: "var(--bg-hover)",
    borderColor: "var(--accent)",
    boxShadow: "0 0 0 1px var(--accent)",
  },
  thumbRow: { display: "flex", gap: 12, alignItems: "flex-start" },
  thumb: {
    width: 200,
    maxHeight: 150,
    objectFit: "cover",
    borderRadius: 5,
    border: "1px solid var(--border-subtle)",
    background: "#000",
  },
  thumbSide: { display: "flex", flexDirection: "column", gap: 6 },
  check: { display: "flex", gap: 6, alignItems: "center", fontSize: 13 },
  linkBtn: {
    background: "none",
    border: "none",
    padding: 0,
    color: "var(--accent)",
    fontSize: 12,
    cursor: "pointer",
    textAlign: "left",
  },
  errors: {
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--danger-fg, #f87171)",
    border: "1px solid currentColor",
    borderRadius: 5,
    padding: "8px 10px",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    padding: "12px 0 16px",
    borderTop: "1px solid var(--border-subtle)",
  },
  cancelBtn: {
    background: "none",
    border: "1px solid var(--border-subtle)",
    borderRadius: 5,
    color: "var(--text-chrome)",
    padding: "7px 14px",
    fontSize: 13,
    cursor: "pointer",
  },
  primaryBtn: {
    background: "var(--accent)",
    border: "1px solid var(--accent)",
    borderRadius: 5,
    color: "#fff",
    padding: "7px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
};
