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
  untickedVizUses,
  utf8Bytes,
  type PublishForm,
} from "./publish";
import { shownName } from "./reservedNames";
import { captureCoverThumbnail, captureVisualFrames, type CoverCapture, type MissedStill } from "./thumbnail";
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
  project: "The files you tick below.",
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

type Thumb = { state: "capturing" } | { state: "done"; result: CoverCapture };

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
  // #2610 — visuals drawing on screen whose still couldn't be taken, said in the dialog
  const [missedStills, setMissedStills] = useState<MissedStill[]>([]);
  const [includeFrames, setIncludeFrames] = useState(true);
  // #2632 — the files a project entry carries: every file to start with, then what is ticked
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  // #2330 — the Turnstile check, when this site has one. A token is good once:
  // a failed send bumps `turnstileRound`, which remounts the widget for a new one.
  const siteKey = turnstileSiteKey();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileRound, setTurnstileRound] = useState(0);
  const titleRef = useRef<HTMLInputElement>(null);

  // #2632 — the project's files that go in the entry, in the project's order
  const pickedFiles = useMemo(
    () => (manifest ? manifest.files.filter((f) => picked.has(f.id)) : []),
    [manifest, picked],
  );
  const coverChoices = useMemo(() => pickedFiles.filter((f) => fileRole(f.path) !== "file"), [pickedFiles]);
  // the cover is always one of the ticked files: untick it and the next one that can be a cover takes over
  useEffect(() => {
    if (coverId && coverChoices.some((f) => f.id === coverId)) return;
    setCoverId((coverChoices.find((f) => fileRole(f.path) === "pattern") ?? coverChoices[0])?.id ?? null);
  }, [coverChoices, coverId]);

  // #2610 — the picture follows the file the card will show: a project's cover,
  // or the one visual being published. A later capture replaces an earlier one.
  const pictureFileId = form.kind === "project" ? coverId : form.kind === "viz" ? form.fileId : null;
  const captureRound = useRef(0);
  const capture = useCallback((files: GalleryManifest["files"], fileId: string | null) => {
    const round = ++captureRound.current;
    setThumb({ state: "capturing" });
    void captureCoverThumbnail(files, fileId).then((result) => {
      if (round === captureRound.current) setThumb({ state: "done", result });
    });
  }, []);
  const retake = () => {
    if (manifest) capture(manifest.files, pictureFileId);
  };
  useEffect(() => {
    if (open && manifest) capture(manifest.files, pictureFileId);
  }, [open, manifest, pictureFileId, capture]);

  // Each opening starts from the project as it is now.
  useEffect(() => {
    if (!open) return;
    const m = collectManifest(project) as GalleryManifest;
    setManifest(m);
    setPicked(new Set(m.files.map((f) => f.id)));
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
    setMissedStills([]);
    setIncludeFrames(true);
    let live = true;
    void captureVisualFrames(m.files)
      .catch(() => ({ frames: [], missed: [] }))
      .then((got) => {
        if (!live) return;
        setFrames(got.frames);
        setMissedStills(got.missed);
      });
    queueMicrotask(() => titleRef.current?.focus());
    return () => {
      live = false;
    };
  }, [open, project]);

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
    const built = buildPublishRequest({ ...form, fileIds: form.kind === "project" ? [...picked] : null }, manifest, thumbnail);
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
      const sentPaths = new Set(built.request.manifest.files.map((f) => f.path));
      const sentFrames = frames.filter((f) => sentPaths.has(f.path));
      const rec = await Promise.race([
        recordEntry(project.id, built.request.manifest, coverPath, form.kind === "project" && includeFrames ? sentFrames : []).catch(() => null),
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
  }, [manifest, sending, siteKey, turnstileToken, form, picked, thumbnail, onClose, coverId, project.id, frames, includeFrames]);

  if (!open) return null;

  const pickedPaths = new Set(pickedFiles.map((f) => f.path));
  const shownFrames = frames.filter((f) => pickedPaths.has(f.path));
  const shownMissed = missedStills.filter((m) => pickedPaths.has(m.path));

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

          {form.kind === "project" && manifest && (
            <FilePicker
              manifest={manifest}
              picked={picked}
              onChange={(next) => {
                setPicked(next);
                setErrors([]);
              }}
            />
          )}

          {form.kind === "project" && coverChoices.length > 0 && (
            <label style={styles.field}>
              <span style={styles.label}>Cover</span>
              <select
                style={styles.input}
                value={coverId ?? ""}
                onChange={(e) => setCoverId(e.target.value || null)}
                data-testid="gallery-publish-cover"
              >
                {coverChoices.map((f) => (
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
                  <button type="button" style={styles.linkBtn} onClick={retake}>
                    Take another frame
                  </button>
                  {thumb.result.note && (
                    <span style={styles.hint} data-testid="gallery-publish-thumbnail-note">
                      {thumb.result.note}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <span style={styles.hint} data-testid="gallery-publish-thumbnail-reason">
                {thumb.result.reason}{" "}
                <button type="button" style={styles.linkBtn} onClick={retake}>
                  Try again
                </button>
              </span>
            )}
          </div>

          {form.kind === "project" && shownFrames.length > 0 && (
            <label style={styles.check} data-testid="gallery-publish-frames">
              <input
                type="checkbox"
                checked={includeFrames}
                onChange={(e) => setIncludeFrames(e.target.checked)}
                data-testid="gallery-publish-frames-include"
              />
              Keep a small still of {shownFrames.length === 1 ? "the running visual" : `the ${shownFrames.length} running visuals`} for{" "}
              {shownFrames.length === 1 ? "its row" : "their rows"} ({shownFrames.map((f) => f.path).join(", ")})
            </label>
          )}

          {form.kind === "project" && shownMissed.length > 0 && (
            <div style={styles.note} data-testid="gallery-publish-frames-missed">
              {shownMissed.map((m) => (
                <div key={m.path} data-gallery-missed-still={m.path}>
                  No still for {m.path}: it&apos;s on screen, but {m.reason.charAt(0).toLowerCase() + m.reason.slice(1)}                </div>
              ))}
            </div>
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

/** A folder's path, "" for the project's top level. */
function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/**
 * #2632 — which of the project's files the entry carries. One row per file,
 * under its folder; a folder's box ticks or clears everything in it (and is
 * half-ticked when only some are). All and None for the whole project. Says
 * how many files and how big, and when a ticked pattern draws a visual that
 * isn't ticked.
 */
function FilePicker({
  manifest,
  picked,
  onChange,
}: {
  manifest: GalleryManifest;
  picked: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  // folders in the order their first file comes, each with its files
  const groups = useMemo(() => {
    const byFolder = new Map<string, GalleryManifest["files"]>();
    for (const f of manifest.files) {
      const folder = folderOf(f.path);
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder)!.push(f);
    }
    return [...byFolder.entries()].map(([folder, files]) => ({ folder, files }));
  }, [manifest]);

  const pickedFiles = manifest.files.filter((f) => picked.has(f.id));
  const bytes = pickedFiles.reduce((n, f) => n + utf8Bytes(f.content), 0);
  const missing = useMemo(() => untickedVizUses(manifest, [...picked]), [manifest, picked]);

  const set = (ids: string[], on: boolean) => {
    const next = new Set(picked);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  };

  return (
    <div style={styles.field} data-testid="gallery-publish-files">
      <div style={styles.filesHead}>
        <span style={styles.label}>Files</span>
        <span style={styles.hint} data-testid="gallery-publish-files-count">
          {pickedFiles.length} of {manifest.files.length} · {kib(bytes)}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          style={styles.linkBtn}
          onClick={() => onChange(new Set(manifest.files.map((f) => f.id)))}
          data-testid="gallery-publish-files-all"
        >
          All
        </button>
        <button type="button" style={styles.linkBtn} onClick={() => onChange(new Set())} data-testid="gallery-publish-files-none">
          None
        </button>
      </div>
      <div style={styles.files} role="group" aria-label="Files to publish">
        {groups.map(({ folder, files }) => {
          const on = files.filter((f) => picked.has(f.id)).length;
          return (
            <div key={folder || "/"}>
              {folder && (
                <label style={styles.folderRow} data-gallery-publish-folder={folder}>
                  <input
                    type="checkbox"
                    checked={on === files.length}
                    ref={(el) => {
                      if (el) el.indeterminate = on > 0 && on < files.length;
                    }}
                    onChange={(e) => set(files.map((f) => f.id), e.target.checked)}
                  />
                  <span style={styles.folderName}>{folder}/</span>
                </label>
              )}
              {files.map((f) => (
                <label
                  key={f.id}
                  style={{ ...styles.fileRow, paddingLeft: folder ? 26 : 6 }}
                  data-gallery-publish-file={f.path}
                >
                  <input type="checkbox" checked={picked.has(f.id)} onChange={(e) => set([f.id], e.target.checked)} />
                  <span style={styles.fileName}>{f.path.slice(folder ? folder.length + 1 : 0)}</span>
                  <span style={styles.fileSize}>{kib(utf8Bytes(f.content))}</span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
      {missing.length > 0 && (
        <div style={styles.warn} role="status" data-testid="gallery-publish-files-missing">
          {missing.map((m) => (
            <div key={`${m.pattern}>${m.visual}`}>
              ⚠ {m.pattern} draws {m.visual}, which isn&apos;t ticked; the entry won&apos;t find it.{" "}
              <button
                type="button"
                style={styles.linkBtn}
                onClick={() => {
                  const v = manifest.files.find((f) => f.path === m.visual);
                  if (v) set([v.id], true);
                }}
              >
                Tick it
              </button>
            </div>
          ))}
        </div>
      )}
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
  filesHead: { display: "flex", alignItems: "baseline", gap: 8 },
  files: {
    maxHeight: 220,
    overflowY: "auto",
    background: "var(--bg-panel)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 5,
    padding: "4px 0",
  },
  folderRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 6px",
    fontSize: 12,
    color: "var(--text-tertiary)",
    cursor: "pointer",
  },
  folderName: { fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 8px 3px 6px",
    fontSize: 13,
    color: "var(--text-primary)",
    cursor: "pointer",
  },
  fileName: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  fileSize: { fontSize: 11, color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" },
  warn: {
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-chrome)",
    display: "flex",
    flexDirection: "column",
    gap: 2,
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
