"use client";

/**
 * Community gallery cards (#2300, #2314, #2315) — the pieces the browse grid, a
 * profile and a collection page all draw: an entry card, its picture (or a
 * generated one), a collection card, and an author's name as a link.
 *
 * Nothing here evaluates code: pictures are the stored thumbnails or a gradient.
 */
import React, { useState } from "react";
import { galleryThumbnailUrl } from "./client";
import { KIND_LABEL, formatGalleryDate, generatedCard } from "./galleryModel";
import { collectionCover } from "./profileModel";
import type { GalleryCollection, GalleryEntry } from "./types";

export function Thumb({ entry }: { entry: GalleryEntry }) {
  const [failed, setFailed] = useState(false);
  if (entry.hasThumbnail && !failed) {
    return (
      <img
        className="sg-thumb"
        src={galleryThumbnailUrl(entry.id)}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return <GeneratedThumb id={entry.id} title={entry.title} label={KIND_LABEL[entry.kind]} />;
}

function GeneratedThumb({ id, title, label }: { id: string; title: string; label: string }) {
  const { initials, hue } = generatedCard({ id, title });
  return (
    <div
      className="sg-thumb sg-thumb-gen"
      data-gallery-thumb="generated"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 45% 32%), hsl(${(hue + 50) % 360} 50% 18%))` }}
    >
      <span className="sg-initials">{initials}</span>
      <span className="sg-kind-tag">{label}</span>
    </div>
  );
}

/**
 * The author's name: a link to their profile when the entry carries an author id
 * (#2314), plain text otherwise (entries published before profiles existed).
 * A real link, so it can be copied or opened in a new tab; a plain click opens the
 * profile inside the overlay.
 */
export function AuthorName({
  name,
  authorId,
  onAuthor,
}: {
  name: string;
  authorId?: string;
  onAuthor?: (authorId: string) => void;
}) {
  if (!authorId || !onAuthor) return <span data-gallery-author-plain>{name}</span>;
  return (
    <a
      className="sg-author-link"
      href={`#gallery-author=${encodeURIComponent(authorId)}`}
      data-gallery-author-link={authorId}
      onClick={(e) => {
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onAuthor(authorId);
      }}
    >
      {name}
    </a>
  );
}

/**
 * One entry. The whole card opens it on a click or tap; the title is the button a
 * keyboard reaches. The author's name inside is its own link (not nested in a
 * button), so it can open the profile instead.
 */
export function Card({
  entry,
  onOpen,
  onAuthor,
}: {
  entry: GalleryEntry;
  onOpen: () => void;
  onAuthor?: (authorId: string) => void;
}) {
  return (
    <div className="sg-card" data-gallery-card={entry.id} onClick={onOpen} title={entry.title}>
      <Thumb entry={entry} />
      <div className="sg-card-text">
        <button
          type="button"
          className="sg-card-title sg-card-open"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {entry.title}
        </button>
        <div className="sg-card-meta">
          <AuthorName name={entry.authorName} authorId={entry.authorId} onAuthor={onAuthor} /> ·{" "}
          {formatGalleryDate(entry.publishedAt)}
        </div>
        {entry.tags.length > 0 && (
          <div className="sg-tags">
            {entry.tags.map((t) => (
              <span key={t} className="sg-tag">#{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** #2315 — a collection on a profile. Cover = its first entry with a picture. */
export function CollectionCard({
  collection,
  entries,
  onOpen,
}: {
  collection: GalleryCollection;
  /** The author's entries, to find the cover. */
  entries: readonly GalleryEntry[];
  onOpen: () => void;
}) {
  const cover = collectionCover(collection, entries);
  const n = collection.entryIds.length;
  return (
    <div className="sg-card sg-collection-card" data-gallery-collection-card={collection.id} onClick={onOpen}>
      <div className="sg-cover">
        {cover ? (
          <Thumb entry={cover} />
        ) : (
          <GeneratedThumb id={collection.id} title={collection.title} label="Collection" />
        )}
        <span className="sg-cover-count">{n === 1 ? "1 entry" : `${n} entries`}</span>
      </div>
      <div className="sg-card-text">
        <button
          type="button"
          className="sg-card-title sg-card-open"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {collection.title}
        </button>
        {collection.description && <div className="sg-card-meta sg-clamp">{collection.description}</div>}
      </div>
    </div>
  );
}

export const CARD_CSS = `
.sg-card { display: flex; flex-direction: column; text-align: left; padding: 0; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--bg-panel, transparent); color: inherit; cursor: pointer; overflow: hidden; font: inherit; }
.sg-card:hover, .sg-card:focus-within { border-color: var(--accent, #7aa2f7); }
.sg-card-open { display: block; width: 100%; padding: 0; border: none; background: none; text-align: left; cursor: pointer; font-family: inherit; line-height: inherit; }
.sg-card-open:focus-visible { outline: 2px solid var(--accent, #7aa2f7); outline-offset: 2px; }
.sg-author-link { color: var(--accent, #7aa2f7); text-decoration: none; cursor: pointer; }
.sg-author-link:hover, .sg-author-link:focus-visible { text-decoration: underline; }
.sg-cover { position: relative; }
.sg-cover-count { position: absolute; right: 8px; bottom: 6px; font-size: 11px; padding: 1px 7px; border-radius: 10px; background: rgba(0,0,0,.6); color: #fff; }
.sg-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
`;
