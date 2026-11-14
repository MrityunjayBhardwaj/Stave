"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectMeta } from "@stave/editor";

import { showToast } from "../dialogs/host";
import { collectManifest } from "../shareProject";
import { gallerySignIn, loadGallerySession, useGallerySession, type GallerySessionState } from "./session";
import {
  buildPublishRequest,
  filesForKind,
  kib,
  publishAndRemember,
  type PublishForm,
} from "./publish";
import { shownName } from "./reservedNames";
import { captureLiveVizThumbnail, captureVisualFrames, type CaptureResult } from "./thumbnail";
import type { RecordedFrame } from "./recording";
import { recordEntry } from "./recordAtPublish";
import { fileRole } from "./galleryModel";
import { TurnstileWidget, turnstileSiteKey } from "./TurnstileWidget";
import {
  GALLERY_KINDS,
  MAX_MANIFEST_BYTES,
  MAX_TAGS,
  MAX_TAG_CHARS,
  MAX_THUMBNAIL_BYTES,
  MAX_TITLE_CHARS,
  type GalleryKind,
  type GalleryManifest,
  type GallerySessionResponse,
} from "./types";

/**
 * #2301 — Publish to Gallery. A title, what the entry is (the whole project, or
 * one music or viz file), and tags. The server hands back a manage token; this
 * browser keeps it so the upload can be deleted later. #2305 — a frame of the
 * running viz goes with it as the card's picture.
 *
 * #2319 — publishing needs sign-in. Signed out, the dialog says so and offers
 * each configured provider; the redirect comes back to `#publish`, which opens
 * this dialog again. Signed in, it says who you're publishing as: the profile's
 * name and the account's badge. There is no name or email field any more.
 */

/** "GitHub @ada", "Google account", or "test account". */
export function accountLabel(verified: { provider: "github" | "google"; login?: string }): string {
  if (verified.provider === "github") return verified.login ? `GitHub @${verified.login}` : "GitHub";
  return "Google account";
}

/** The panel shown instead of the form until someone is signed in. Null once they are. */
function SignInGate({ state }: { state: GallerySessionState }) {
  if (state.status === "loading") {
    return (
      <p style={styles.note} data-testid="gallery-publish-signin-checking">
        Checking whether you&apos;re signed in…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p style={styles.note} role="alert" data-testid="gallery-publish-signin-error">
        Couldn&apos;t check whether you&apos;re signed in: {state.message}. Close this and try again.
      </p>
    );
  }
  const s: GallerySessionResponse = state.session;
  if (!s.signInAvailable) {
    return (
      <div style={styles.gate} data-testid="gallery-publish-signin-unavailable">
        <p style={styles.gateText}>Publishing needs you to sign in, and sign-in isn&apos;t set up on this site.</p>
        <p style={styles.note}>You can still share this project with a private link: File → Share → Copy Private Link.</p>
      </div>
    );
  }
  return (
    <div style={styles.gate} data-testid="gallery-publish-signin">
      <p style={styles.gateText}>Sign in to publish to the gallery.</p>
      <p style={styles.note}>
        Your work is shown under your profile, with the account you sign in with. We keep your email private and use
        it only to contact you about what you publish.{" "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }} data-testid="gallery-publish-privacy">
          Privacy policy
        </a>
        . You&apos;ll come straight back here afterwards.
      </p>
      <div style={styles.providers}>
        {s.providers.map((p) => (
          <button
            key={p.id}
            type="button"
            style={styles.primaryBtn}
            onClick={() => void gallerySignIn(p.id, { reopenPublish: true })}
            data-testid={`gallery-publish-signin-${p.id}`}
          >
            Sign in with {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<GalleryKind, string> = { project: "Project", music: "Music", viz: "Visual" };
const KIND_NOTE: Record<GalleryKind, string> = {
  project: "Every file in this project.",
  music: "One pattern file.",
  viz: "One visual (Hydra, p5 or GLSL) file.",
};

/** How long recording may take before publishing goes ahead without it. */
const RECORD_TIMEOUT_MS = 10_000;

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
  const session = useGallerySession();
  const user = session.status === "ready" ? session.session.user : null;
  const [form, setForm] = useState<PublishForm>({
    title: "",
    kind: "project",
    fileId: null,
    tags: "",
  });
  const [thumb, setThumb] = useState<Thumb>({ state: "capturing" });
  // #2488 — a project's cover: a pattern (its recorded timeline) or a visual (its picture).
  const [coverId, setCoverId] = useState<string | null>(null);
  // #2487 — while the patterns are asked what they play, before the send.
  const [recording, setRecording] = useState(false);
  // read at opening only: the cover starts on the file in front then, not on every later switch
  const activeFileRef = useRef(activeFileId);
  activeFileRef.current = activeFileId;
  const [includeThumb, setIncludeThumb] = useState(true);
  // #2590 — a still of each visual running in the studio now, for its row on the entry page
  const [frames, setFrames] = useState<RecordedFrame[]>([]);
  const [includeFrames, setIncludeFrames] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  // #2330 — the Turnstile check, when this site has one. A token is good once:
  // a failed send bumps `turnstileRound`, which remounts the widget for a new one.
  const siteKey = turnstileSiteKey();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileRound, setTurnstileRound] = useState(0);
  const titleRef = useRef<HTMLInputElement>(null);

  const capture = useCallback(() => {
    setThumb({ state: "capturing" });
    void captureLiveVizThumbnail().then((result) => setThumb({ state: "done", result }));
  }, []);

  // Each opening starts from the project as it is now.
  useEffect(() => {
    if (!open) return;
    const m = collectManifest(project) as GalleryManifest;
    setManifest(m);
    // the file in front, when it can be a cover; else the first pattern, else the first visual
    const covers = m.files.filter((f) => fileRole(f.path) !== "file");
    const front = covers.find((f) => f.id === activeFileRef.current);
    setCoverId((front ?? covers.find((f) => fileRole(f.path) === "pattern") ?? covers[0])?.id ?? null);
    setForm({
      title: project.name.slice(0, MAX_TITLE_CHARS),
      kind: "project",
      fileId: null,
      tags: "",
    });
    setErrors([]);
    setSending(false);
    setTurnstileToken(null);
    setTurnstileRound((r) => r + 1);
    setIncludeThumb(true);
    setFrames([]);
    setIncludeFrames(true);
    capture();
    let live = true;
    void captureVisualFrames(m.files)
      .catch(() => [])
      .then((got) => {
        if (live) setFrames(got);
      });
    queueMicrotask(() => titleRef.current?.focus());
    return () => {
      live = false;
    };
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
    if (siteKey && !turnstileToken) {
      setErrors(["Please finish the \u201care you human\u201d check above the Publish button first."]);
      return;
    }
    const built = buildPublishRequest(form, manifest, thumbnail);
    if (!built.request) {
      setErrors(built.errors);
      return;
    }
    setErrors([]);
    setSending(true);
    try {
      // #2487 — ask each pattern what it plays, here on the author's machine, so the
      // gallery can draw the card without running anything. Best effort: a slow or
      // failed recording publishes without one rather than holding the publish up.
      const coverPath =
        form.kind === "project" ? (manifest.files.find((f) => f.id === coverId)?.path ?? null) : (built.request.manifest.files[0]?.path ?? null);
      setRecording(true);
      const rec = await Promise.race([
        recordEntry(project.id, built.request.manifest, coverPath, form.kind === "project" && includeFrames ? frames : []).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), RECORD_TIMEOUT_MS)),
      ]);
      setRecording(false);
      const request = rec ? { ...built.request, recording: rec } : built.request;
      const { link } = await publishAndRemember(request, siteKey ? turnstileToken : null);
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
      // #2367 — if that was the session ending, this swaps the form for the sign-in offer.
      void loadGallerySession();
      if (siteKey) setTurnstileRound((r) => r + 1); // the token was spent; get a fresh one
    }
  }, [manifest, sending, siteKey, turnstileToken, form, thumbnail, onClose, coverId, project.id, frames, includeFrames]);

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

        {!user ? (
          <div style={styles.body}>
            <SignInGate state={session} />
            <div style={styles.footer}>
              <button type="button" style={styles.cancelBtn} onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
        <form
          style={styles.body}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          noValidate
        >
          <p style={styles.as} data-testid="gallery-publish-as">
            Publishing as <strong>{shownName(user.name)}</strong> ({accountLabel(user.verified)}). To change the name shown, edit
            your profile.
          </p>

          <label style={styles.field}>
            <span style={styles.label}>Title</span>
            <input
              ref={titleRef}
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

          {form.kind === "project" && manifest && manifest.files.some((f) => fileRole(f.path) !== "file") && (
            <label style={styles.field}>
              <span style={styles.label}>Cover</span>
              <select
                style={styles.input}
                value={coverId ?? ""}
                onChange={(e) => setCoverId(e.target.value || null)}
                data-testid="gallery-publish-cover"
              >
                {manifest.files
                  .filter((f) => fileRole(f.path) !== "file")
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.path}
                    </option>
                  ))}
              </select>
              <span style={styles.hint}>What the project&apos;s card shows: a pattern&apos;s timeline, or a visual&apos;s picture.</span>
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
              <span style={styles.hint}>Its card draws what it plays, recorded here when you publish: its sounds over time, and its sections. Nothing runs on anyone else's machine to draw it.</span>
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

          {form.kind === "project" && frames.length > 0 && (
            <label style={styles.check} data-testid="gallery-publish-frames">
              <input
                type="checkbox"
                checked={includeFrames}
                onChange={(e) => setIncludeFrames(e.target.checked)}
                data-testid="gallery-publish-frames-include"
              />
              Keep a small still of {frames.length === 1 ? "the running visual" : `the ${frames.length} running visuals`} for{" "}
              {frames.length === 1 ? "its row" : "their rows"} ({frames.map((f) => f.path).join(", ")})
            </label>
          )}

          <p style={styles.note}>
            Limits: title {MAX_TITLE_CHARS} characters, project up to {kib(MAX_MANIFEST_BYTES)}, picture up to{" "}
            {kib(MAX_THUMBNAIL_BYTES)}. Anyone can see and open what you publish.
          </p>

          {siteKey && (
            <TurnstileWidget
              key={turnstileRound}
              siteKey={siteKey}
              action="publish"
              onToken={setTurnstileToken}
              testId="gallery-publish-turnstile"
            />
          )}

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
              style={{ ...styles.primaryBtn, opacity: sending || (siteKey && !turnstileToken) ? 0.6 : 1 }}
              disabled={sending || !manifest || (!!siteKey && !turnstileToken)}
              data-testid="gallery-publish-submit"
            >
              {recording ? "Recording what it plays…" : sending ? "Publishing…" : "Publish"}
            </button>
          </div>
        </form>
        )}
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
  as: { margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--text-chrome)" },
  gate: { display: "flex", flexDirection: "column", gap: 10, padding: "4px 0 12px" },
  gateText: { margin: 0, fontSize: 14, color: "var(--text-primary)" },
  providers: { display: "flex", gap: 8, flexWrap: "wrap" },
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
    // #2318 — longhand, so the selected state can swap only the colour without
    // React warning about a shorthand and a longhand fighting on re-render.
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border-subtle)",
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
