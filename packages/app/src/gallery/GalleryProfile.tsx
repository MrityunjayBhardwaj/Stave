"use client";

/**
 * #2314 artist profiles and #2315 collections, inside the gallery overlay.
 *
 * A profile is a README-style page: name, a markdown bio (rendered safely by
 * markdown.ts), the author's collections, then everything they published. When
 * this browser is signed in as the author (#2319), or holds the author's key from
 * before sign-in, it can edit the profile and make, edit and delete collections.
 * Nothing here evaluates code.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  createCollection,
  deleteCollection,
  fetchAuthorPage,
  fetchCollectionPage,
  galleryAuthorLink,
  galleryCollectionLink,
  updateAuthor,
  updateCollection,
} from "./client";
import { AuthorName, Card, CollectionCard } from "./GalleryCards";
import { loadAuthor } from "./localShares";
import { renderMarkdown } from "./markdown";
import {
  buildCollectionRequest,
  buildProfileRequest,
  editAccess,
  githubProfileUrl,
  moveEntry,
  removeEntry,
  toggleEntry,
} from "./profileModel";
import { useGallerySession } from "./session";
import { KIND_LABEL, formatGalleryDate } from "./galleryModel";
import {
  MAX_AUTHOR_NAME_CHARS,
  MAX_BIO_CHARS,
  MAX_COLLECTION_DESCRIPTION_CHARS,
  MAX_COLLECTION_ENTRIES,
  MAX_COLLECTION_TITLE_CHARS,
  type AuthorPageResponse,
  type CollectionPageResponse,
  type GalleryCollection,
  type GalleryEntry,
  type GalleryVerified,
} from "./types";
import { showConfirm, showToast } from "../dialogs/host";

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

async function copy(url: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    showToast(`${what} copied.`, "info");
  } catch {
    showToast("Couldn't copy the link — your browser blocked the clipboard.", "error");
  }
}

function BackButton({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button className="sg-btn sg-back" onClick={onBack}>
      {label}
    </button>
  );
}

function Counter({ n, max }: { n: number; max: number }) {
  return (
    <span className={n > max ? "sg-counter sg-over" : "sg-counter"}>
      {n.toLocaleString("en")} / {max.toLocaleString("en")}
    </span>
  );
}

function Errors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <ul className="sg-errors" role="alert" data-gallery-form-errors>
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return <div className="sg-md" data-gallery-markdown dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The signed-in author's id, or null (signed out, loading, or no sign-in here). */
function useSessionAuthorId(): string | null {
  const s = useGallerySession();
  return s.status === "ready" ? (s.session.user?.authorId ?? null) : null;
}

/**
 * #2319 — the account a profile is signed in with: avatar, then the GitHub
 * handle (linked) or "Google account". The avatar is a plain <img>; under the
 * app's COEP `credentialless` a cross-origin image loads without cookies, which
 * avatar CDNs don't need.
 */
export function VerifiedBadge({ verified }: { verified: GalleryVerified }) {
  const gh = verified.provider === "github" ? githubProfileUrl(verified.login) : null;
  return (
    <span className="sg-verified" data-gallery-verified={verified.provider}>
      {verified.avatarUrl && (
        <img
          className="sg-avatar"
          src={verified.avatarUrl}
          alt=""
          width={20}
          height={20}
          referrerPolicy="no-referrer"
          data-gallery-avatar
        />
      )}
      {gh ? (
        <a href={gh} target="_blank" rel="noopener noreferrer" data-gallery-verified-link>
          GitHub @{verified.login}
        </a>
      ) : verified.provider === "github" ? (
        "GitHub account"
      ) : (
        "Google account"
      )}
    </span>
  );
}

// ── profile ────────────────────────────────────────────────────────────────

export function ProfileView({
  authorId,
  backLabel,
  onBack,
  onOpenEntry,
  onOpenCollection,
}: {
  authorId: string;
  backLabel: string;
  onBack: () => void;
  onOpenEntry: (id: string) => void;
  onOpenCollection: (id: string) => void;
}) {
  const [page, setPage] = useState<Load<AuthorPageResponse>>({ status: "loading" });
  const [mode, setMode] = useState<"view" | "edit" | "new-collection">("view");
  // #2320 — an old profile link lands on the profile it was merged into; who
  // may edit is decided for the profile actually shown.
  const shownId = page.status === "ready" ? page.data.author.authorId : authorId;
  const { canEdit, key: ownerKey } = editAccess(useSessionAuthorId(), loadAuthor(), shownId);

  const load = useCallback(() => {
    setPage({ status: "loading" });
    fetchAuthorPage(authorId)
      .then((data) => setPage({ status: "ready", data }))
      .catch((err: Error) => setPage({ status: "error", message: err.message || "the profile couldn't be loaded" }));
  }, [authorId]);
  useEffect(load, [load]);

  const back = <BackButton label={backLabel} onBack={onBack} />;
  if (page.status === "loading") {
    return (
      <div className="sg-body">
        {back}
        <div className="sg-state" data-gallery-state="loading">Loading the profile…</div>
      </div>
    );
  }
  if (page.status === "error") {
    return (
      <div className="sg-body">
        {back}
        <div className="sg-state" data-gallery-state="error">
          <p>Couldn&apos;t open the profile: {page.message}.</p>
          <button className="sg-btn" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  const { author, entries, collections } = page.data;
  return (
    <div className="sg-body sg-profile" data-gallery-profile={author.authorId}>
      {back}
      {mode === "edit" && canEdit ? (
        <ProfileEditor
          page={page.data}
          authorKey={ownerKey}
          onCancel={() => setMode("view")}
          onSaved={(a) => {
            setPage({ status: "ready", data: { ...page.data, author: a } });
            setMode("view");
          }}
        />
      ) : mode === "new-collection" && canEdit ? (
        <CollectionEditor
          heading="New collection"
          own={entries}
          initial={{ title: "", description: "", entryIds: [] }}
          saveLabel="Create collection"
          onCancel={() => setMode("view")}
          onSave={async (req) => {
            const c = await createCollection(ownerKey, req);
            showToast(`Made the collection "${c.title}".`, "info");
            setMode("view");
            onOpenCollection(c.id);
          }}
        />
      ) : (
        <>
          <div className="sg-detail-head">
            <div>
              <h3 className="sg-profile-name">{author.name}</h3>
              {author.verified && <VerifiedBadge verified={author.verified} />}
              <div className="sg-card-meta">
                {entries.length === 1 ? "1 entry" : `${entries.length} entries`} · since{" "}
                {formatGalleryDate(author.createdAt)}
              </div>
            </div>
            <div className="sg-actions">
              {canEdit && (
                <>
                  <button className="sg-btn sg-primary" data-gallery-edit-profile onClick={() => setMode("edit")}>
                    Edit profile
                  </button>
                  <button className="sg-btn" data-gallery-new-collection onClick={() => setMode("new-collection")}>
                    New collection
                  </button>
                </>
              )}
              <button className="sg-btn" onClick={() => void copy(galleryAuthorLink(author.authorId), "Profile link")}>
                Copy link
              </button>
            </div>
          </div>
          {author.bio.trim() ? (
            <div className="sg-readme">
              <Markdown source={author.bio} />
            </div>
          ) : canEdit ? (
            <p className="sg-muted sg-left">Your profile has no bio yet. Edit profile to write one in markdown.</p>
          ) : null}

          {collections.length > 0 && (
            <section data-gallery-section="collections">
              <h4 className="sg-section">Collections</h4>
              <div className="sg-grid">
                {collections.map((c) => (
                  <CollectionCard key={c.id} collection={c} entries={entries} onOpen={() => onOpenCollection(c.id)} />
                ))}
              </div>
            </section>
          )}

          <section data-gallery-section="entries">
            <h4 className="sg-section">Published</h4>
            {entries.length === 0 ? (
              <div className="sg-state sg-state-small">Nothing published yet.</div>
            ) : (
              <div className="sg-grid">
                {entries.map((e) => (
                  <Card key={e.id} entry={e} onOpen={() => onOpenEntry(e.id)} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ProfileEditor({
  page,
  authorKey,
  onCancel,
  onSaved,
}: {
  page: AuthorPageResponse;
  /** Null when the session is what makes this browser the owner (#2319). */
  authorKey: string | null;
  onCancel: () => void;
  onSaved: (a: AuthorPageResponse["author"]) => void;
}) {
  const [name, setName] = useState(page.author.name);
  const [bio, setBio] = useState(page.author.bio);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const built = buildProfileRequest({ name, bio }, page.author.name);
    setErrors(built.errors);
    if (!built.request) return;
    setSaving(true);
    try {
      const a = await updateAuthor(page.author.authorId, authorKey, built.request);
      showToast("Profile saved.", "info");
      onSaved(a);
    } catch (err) {
      setErrors([`Couldn't save — ${(err as Error).message}.`]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sg-editor" data-gallery-profile-editor>
      <h3 className="sg-profile-name">Edit profile</h3>
      <label className="sg-field">
        <span className="sg-label">
          Name <Counter n={name.trim().length} max={MAX_AUTHOR_NAME_CHARS} />
        </span>
        <input className="sg-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Display name" />
      </label>
      <div className="sg-split">
        <label className="sg-field">
          <span className="sg-label">
            Bio, in markdown <Counter n={bio.length} max={MAX_BIO_CHARS} />
          </span>
          <textarea
            className="sg-input sg-textarea"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            aria-label="Bio (markdown)"
            placeholder={"# Hi, I'm …\n\nWhat you make, where to find you, links."}
            spellCheck
          />
          <span className="sg-hint">Headings, lists, links, code and tables work. Images load from GitHub or Stave only; others show their alt text. HTML is shown as text.</span>
        </label>
        <div className="sg-field">
          <span className="sg-label">Preview</span>
          <div className="sg-preview" data-gallery-bio-preview>
            {bio.trim() ? <Markdown source={bio} /> : <p className="sg-muted sg-left">Nothing to preview yet.</p>}
          </div>
        </div>
      </div>
      <Errors errors={errors} />
      <div className="sg-actions">
        <button className="sg-btn sg-primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="sg-btn" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── collection editing (new and edit) ──────────────────────────────────────

function CollectionEditor({
  heading,
  own,
  initial,
  saveLabel,
  onCancel,
  onSave,
  onDelete,
}: {
  heading: string;
  /** The author's own entries — the only ones a collection may hold. */
  own: readonly GalleryEntry[];
  initial: { title: string; description: string; entryIds: string[] };
  saveLabel: string;
  onCancel: () => void;
  onSave: (req: { title: string; description: string; entryIds: string[] }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [ids, setIds] = useState<string[]>(initial.entryIds);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const byId = useMemo(() => new Map(own.map((e) => [e.id, e])), [own]);
  const ownIds = useMemo(() => own.map((e) => e.id), [own]);

  const save = async () => {
    const built = buildCollectionRequest({ title, description, entryIds: ids }, ownIds);
    setErrors(built.errors);
    if (!built.request) return;
    setSaving(true);
    try {
      await onSave(built.request);
    } catch (err) {
      setErrors([`Couldn't save — ${(err as Error).message}.`]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sg-editor" data-gallery-collection-editor>
      <h3 className="sg-profile-name">{heading}</h3>
      <label className="sg-field">
        <span className="sg-label">
          Title <Counter n={title.trim().length} max={MAX_COLLECTION_TITLE_CHARS} />
        </span>
        <input
          className="sg-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Collection title"
          placeholder="e.g. Night Drive EP"
        />
      </label>
      <label className="sg-field">
        <span className="sg-label">
          Description <Counter n={description.trim().length} max={MAX_COLLECTION_DESCRIPTION_CHARS} />
        </span>
        <textarea
          className="sg-input sg-textarea-short"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Collection description"
          placeholder="A line or two about what ties these together."
        />
      </label>

      <div className="sg-field">
        <span className="sg-label">
          In this collection, in order <Counter n={ids.length} max={MAX_COLLECTION_ENTRIES} />
        </span>
        {ids.length === 0 ? (
          <p className="sg-muted sg-left">Nothing yet — tick entries below to add them.</p>
        ) : (
          <ol className="sg-order" data-gallery-order>
            {ids.map((id, i) => {
              const e = byId.get(id);
              const label = e?.title ?? id;
              return (
                <li key={id} className="sg-order-row" data-gallery-order-row={id}>
                  <span className="sg-order-n">{i + 1}.</span>
                  <span className="sg-order-title">{label}</span>
                  <span className="sg-order-btns">
                    <button
                      className="sg-btn sg-icon"
                      aria-label={`Move ${label} up`}
                      disabled={i === 0}
                      onClick={() => setIds((x) => moveEntry(x, i, -1))}
                    >
                      ↑
                    </button>
                    <button
                      className="sg-btn sg-icon"
                      aria-label={`Move ${label} down`}
                      disabled={i === ids.length - 1}
                      onClick={() => setIds((x) => moveEntry(x, i, 1))}
                    >
                      ↓
                    </button>
                    <button
                      className="sg-btn sg-icon"
                      aria-label={`Remove ${label} from the collection`}
                      onClick={() => setIds((x) => removeEntry(x, id))}
                    >
                      ×
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <fieldset className="sg-field sg-picker" data-gallery-picker>
        <legend className="sg-label">Your entries</legend>
        {own.length === 0 ? (
          <p className="sg-muted sg-left">You have no entries in the gallery yet.</p>
        ) : (
          own.map((e) => (
            <label key={e.id} className="sg-pick" data-gallery-pick={e.id}>
              <input type="checkbox" checked={ids.includes(e.id)} onChange={() => setIds((x) => toggleEntry(x, e.id))} />
              <span className="sg-pick-title">{e.title}</span>
              <span className="sg-card-meta">
                {KIND_LABEL[e.kind]} · {formatGalleryDate(e.publishedAt)}
              </span>
            </label>
          ))
        )}
      </fieldset>

      <Errors errors={errors} />
      <div className="sg-actions">
        <button className="sg-btn sg-primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : saveLabel}
        </button>
        <button className="sg-btn" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        {onDelete && (
          <button className="sg-btn sg-danger sg-push-right" disabled={saving} onClick={() => void onDelete()}>
            Delete collection
          </button>
        )}
      </div>
    </div>
  );
}

// ── collection page ────────────────────────────────────────────────────────

export function CollectionView({
  collectionId,
  backLabel,
  onBack,
  onOpenEntry,
  onOpenAuthor,
  onDeleted,
}: {
  collectionId: string;
  backLabel: string;
  onBack: () => void;
  onOpenEntry: (id: string) => void;
  onOpenAuthor: (authorId: string) => void;
  /** After a delete: leave this page. */
  onDeleted: () => void;
}) {
  const [page, setPage] = useState<Load<CollectionPageResponse>>({ status: "loading" });
  const [editing, setEditing] = useState<Load<GalleryEntry[]> | null>(null);
  const sessionAuthorId = useSessionAuthorId();
  const access = (authorId: string) => editAccess(sessionAuthorId, loadAuthor(), authorId);

  const load = useCallback(() => {
    setPage({ status: "loading" });
    fetchCollectionPage(collectionId)
      .then((data) => setPage({ status: "ready", data }))
      .catch((err: Error) => setPage({ status: "error", message: err.message || "the collection couldn't be loaded" }));
  }, [collectionId]);
  useEffect(load, [load]);

  const back = <BackButton label={backLabel} onBack={onBack} />;
  if (page.status === "loading") {
    return (
      <div className="sg-body">
        {back}
        <div className="sg-state" data-gallery-state="loading">Loading the collection…</div>
      </div>
    );
  }
  if (page.status === "error") {
    return (
      <div className="sg-body">
        {back}
        <div className="sg-state" data-gallery-state="error">
          <p>Couldn&apos;t open the collection: {page.message}.</p>
          <button className="sg-btn" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  const { collection, author, entries } = page.data;
  const { canEdit, key: ownerKey } = access(collection.authorId);

  const startEdit = () => {
    setEditing({ status: "loading" });
    // Adding needs every one of the author's entries, not only those already in here.
    fetchAuthorPage(collection.authorId)
      .then((p) => setEditing({ status: "ready", data: p.entries }))
      .catch((err: Error) => setEditing({ status: "error", message: err.message }));
  };

  const remove = async (key: string | null) => {
    const ok = await showConfirm({
      title: "Delete this collection?",
      description: `"${collection.title}" will be deleted. The entries in it stay in the gallery — only the collection goes.`,
      confirmLabel: "Delete collection",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteCollection(collection.id, key);
      showToast(`Deleted the collection "${collection.title}". Its entries are still in the gallery.`, "info");
      onDeleted();
    } catch (err) {
      showToast(`Couldn't delete it — ${(err as Error).message}`, "error");
    }
  };

  if (editing && canEdit) {
    if (editing.status !== "ready") {
      return (
        <div className="sg-body">
          <BackButton label="← Back to the collection" onBack={() => setEditing(null)} />
          {editing.status === "loading" ? (
            <div className="sg-state" data-gallery-state="loading">Loading your entries…</div>
          ) : (
            <div className="sg-state" data-gallery-state="error">
              <p>Couldn&apos;t load your entries: {editing.message}.</p>
              <button className="sg-btn" onClick={startEdit}>Try again</button>
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="sg-body sg-profile">
        <CollectionEditor
          heading="Edit collection"
          own={editing.data}
          initial={{ title: collection.title, description: collection.description, entryIds: entries.map((e) => e.id) }}
          saveLabel="Save"
          onCancel={() => setEditing(null)}
          onSave={async (req) => {
            const c: GalleryCollection = await updateCollection(collection.id, ownerKey, req);
            const byId = new Map(editing.data.map((e) => [e.id, e]));
            setPage({
              status: "ready",
              data: {
                ...page.data,
                collection: c,
                entries: c.entryIds.map((id) => byId.get(id)).filter((e): e is GalleryEntry => !!e),
              },
            });
            setEditing(null);
            showToast("Collection saved.", "info");
          }}
          onDelete={() => remove(ownerKey)}
        />
      </div>
    );
  }

  return (
    <div className="sg-body sg-profile" data-gallery-collection={collection.id}>
      {back}
      <div className="sg-detail-head">
        <div>
          <h3 className="sg-profile-name">{collection.title}</h3>
          <div className="sg-card-meta">
            Collection by <AuthorName name={author.name} authorId={author.authorId} onAuthor={onOpenAuthor} /> ·{" "}
            {entries.length === 1 ? "1 entry" : `${entries.length} entries`}
          </div>
        </div>
        <div className="sg-actions">
          {canEdit && (
            <button className="sg-btn sg-primary" data-gallery-edit-collection onClick={startEdit}>
              Edit
            </button>
          )}
          <button
            className="sg-btn"
            data-gallery-copy-collection
            onClick={() => void copy(galleryCollectionLink(collection.id), "Collection link")}
          >
            Copy link
          </button>
        </div>
      </div>
      {collection.description && <p className="sg-description">{collection.description}</p>}
      {entries.length === 0 ? (
        <div className="sg-state sg-state-small">This collection is empty.</div>
      ) : (
        <ol className="sg-grid sg-collection-list">
          {entries.map((e) => (
            <li key={e.id} className="sg-collection-item">
              <Card entry={e} onOpen={() => onOpenEntry(e.id)} onAuthor={onOpenAuthor} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export const PROFILE_CSS = `
.sg-profile { display: flex; flex-direction: column; gap: 14px; }
.sg-profile section { display: flex; flex-direction: column; gap: 8px; }
.sg-profile-name { margin: 0 0 2px; font-size: 20px; font-weight: 600; color: var(--text-primary); }
.sg-verified { display: inline-flex; align-items: center; gap: 6px; margin: 2px 0 4px; font-size: 12px; color: var(--text-secondary); }
.sg-verified a { color: var(--accent); text-decoration: none; }
.sg-verified a:hover { text-decoration: underline; }
.sg-avatar { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; background: var(--bg-panel); }
.sg-readme { border: 1px solid var(--border-subtle); border-radius: 8px; padding: 16px 20px; }
.sg-left { text-align: left; margin: 0 !important; max-width: none; }
.sg-description { margin: 0; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
.sg-collection-list { list-style: none; margin: 0; padding: 0; }
.sg-collection-item { display: flex; }
.sg-collection-item > .sg-card { flex: 1; }
.sg-editor { display: flex; flex-direction: column; gap: 12px; }
.sg-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; border: none; padding: 0; margin: 0; }
.sg-label { font-size: 12px; font-weight: 600; display: flex; justify-content: space-between; gap: 8px; color: var(--text-primary); }
.sg-counter { font-weight: 400; opacity: .7; font-variant-numeric: tabular-nums; }
.sg-over { color: var(--text-error, #f27878); opacity: 1; }
.sg-input { padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border-strong); background: var(--bg-input, var(--bg-elevated)); color: var(--text-primary); font: inherit; font-size: 13px; }
.sg-textarea { min-height: 280px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.5; }
.sg-textarea-short { min-height: 64px; resize: vertical; }
.sg-hint { font-size: 11px; opacity: .7; }
.sg-split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.sg-preview { min-height: 280px; max-height: 420px; overflow: auto; border: 1px solid var(--border-subtle); border-radius: 6px; padding: 12px 14px; }
.sg-errors { margin: 0; padding: 8px 12px 8px 28px; border-radius: 6px; border: 1px solid var(--text-error, #f27878); color: var(--text-error, #f27878); font-size: 13px; }
.sg-order { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.sg-order-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border: 1px solid var(--border-subtle); border-radius: 6px; }
.sg-order-n { width: 2em; opacity: .7; font-variant-numeric: tabular-nums; }
.sg-order-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.sg-order-btns { display: flex; gap: 4px; }
.sg-icon { padding: 3px 9px; min-width: 32px; }
.sg-picker { gap: 4px; max-height: 260px; overflow: auto; }
.sg-pick { display: flex; align-items: center; gap: 8px; padding: 5px 4px; cursor: pointer; font-size: 13px; }
.sg-pick-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sg-push-right { margin-left: auto; }
.sg-my-profile { align-self: flex-start; }
@media (max-width: 640px) {
  .sg-split { grid-template-columns: 1fr; }
  .sg-textarea, .sg-preview { min-height: 180px; }
  .sg-readme { padding: 12px; }
  .sg-icon { min-width: 40px; padding: 8px 10px; }
  .sg-pick { padding: 8px 4px; }
}
`;
