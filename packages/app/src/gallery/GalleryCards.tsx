"use client";

/**
 * Community gallery cards (#2300, #2314, #2315) — the pieces the browse grid, a
 * profile and a collection page all draw: an entry card, its picture (or a
 * generated one), and an author's name as a link. (#2494: the collection card
 * went with the hidden collections UI.)
 *
 * Nothing here evaluates code: pictures are the stored thumbnails or a gradient.
 */
import React, { useEffect, useState } from "react";
import { fetchGalleryRecording, galleryThumbnailUrl } from "./client";
import { KIND_LABEL, formatGalleryDate, generatedCard, publishedAgo } from "./galleryModel";
import { RecordingTimeline } from "./GalleryTimeline";
import { contentsLine, coverPattern, mayHavePreview, type GalleryRecording } from "./recording";
import { shownName } from "./reservedNames";
import type { GalleryEntry } from "./types";

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

export function GeneratedThumb({ id, title, label }: { id: string; title: string; label: string | null }) {
  const { initials, hue } = generatedCard({ id, title });
  return (
    <div
      className="sg-thumb sg-thumb-gen"
      data-gallery-thumb="generated"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 45% 32%), hsl(${(hue + 50) % 360} 50% 18%))` }}
    >
      <span className="sg-initials">{initials}</span>
      {label && <span className="sg-kind-tag">{label}</span>}
    </div>
  );
}

/**
 * The author's name: a link to their profile when the entry carries an author id
 * (#2314), plain text otherwise (entries published before profiles existed).
 * A real link, so it can be copied or opened in a new tab; a plain click opens the
 * profile inside the overlay. #2465 — shown through shownName, so a name with
 * nothing visible in it reads "Unnamed artist", not as an empty link.
 */
export function AuthorName({
  name: stored,
  authorId,
  onAuthor,
}: {
  name: string;
  authorId?: string;
  onAuthor?: (authorId: string) => void;
}) {
  const name = shownName(stored);
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
 * #2487 — an entry's record of what it plays, fetched when the list says it has
 * one (shared with the entry page: one request per entry). Null until it
 * arrives, and for an entry from before recording.
 */
export function useEntryRecording(entry: Pick<GalleryEntry, "id" | "hasRecording">): GalleryRecording | null {
  const [rec, setRec] = useState<GalleryRecording | null>(null);
  useEffect(() => {
    setRec(null);
    if (!entry.hasRecording) return;
    let live = true;
    void fetchGalleryRecording(entry.id).then((r) => {
      if (live) setRec(r);
    });
    return () => {
      live = false;
    };
  }, [entry.id, entry.hasRecording]);
  return rec;
}

/** A soft colour per artist, stable across visits. */
export function avatarColour(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 70% 78%)`;
}

/** The artist's initial in a coloured circle. */
export function Avatar({ name, colourKey, size = 18 }: { name: string; colourKey: string; size?: number }) {
  return (
    <span
      className="sg-gcard-av"
      aria-hidden="true"
      style={{ background: avatarColour(colourKey), width: size, height: size, fontSize: Math.round(size * 0.55) }}
    >
      {shownName(name).trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

/**
 * #2488 — the card's picture, from stored data only: a music or project entry
 * whose cover is a recorded pattern draws that pattern's timeline; otherwise the
 * captured picture (a visual's frame); otherwise the generated card, as before
 * recording existed.
 */
export function CardPicture({ entry, rec }: { entry: GalleryEntry; rec: GalleryRecording | null }) {
  const cover = entry.kind === "viz" ? null : coverPattern(rec);
  if (cover) return <RecordingTimeline rec={cover} className="sg-gcard-canvas" />;
  if (entry.hasThumbnail) return <Thumb entry={entry} />;
  return <GeneratedThumb id={entry.id} title={entry.title} label={null} />;
}

/**
 * One entry, as the redesign's mockup draws it: the picture with the kind on it
 * (and, for a project, what it holds), then the title, the artist with their
 * initial, how long ago, and the tags. The whole card opens the entry on a click
 * or tap; the title is the button a keyboard reaches. The artist's name is its
 * own link (not nested in a button), so it can open the profile instead.
 *
 * #2495 — and a play button on the picture: the entry opens with its preview
 * already starting. It is this click that lets the preview's sealed frame start
 * sound in Chromium and Firefox (measured; WebKit still wants a press in the
 * frame, which the preview then has focused), so the button calls `onPlay`
 * straight from its own click handler, nothing deferred. It passes the recorded
 * cover file, so the entry starts on the file the card shows.
 *
 * #2548 — only when there is something to preview: a card whose record counts no
 * pattern and no visual has no play button (see `mayHavePreview`).
 *
 * #2578 — a project's "what it holds" label shares the picture's bottom edge
 * with that button: beside it, the label stops short of it; without it, the
 * label may run the full width. A label too long for its room ends in an
 * ellipsis, its whole text in the tooltip.
 */
export function Card({
  entry,
  onOpen,
  onPlay,
  onAuthor,
}: {
  entry: GalleryEntry;
  onOpen: () => void;
  /** Open the entry with its preview starting (the cover file when it is known). */
  onPlay?: (cover: string | null) => void;
  onAuthor?: (authorId: string) => void;
}) {
  const rec = useEntryRecording(entry);
  const hasPlay = !!onPlay && mayHavePreview(rec);
  const count =
    entry.kind === "project"
      ? (contentsLine(rec) ?? `${entry.fileCount} ${entry.fileCount === 1 ? "file" : "files"}`)
      : null;
  return (
    <div className="sg-gcard" data-gallery-card={entry.id} onClick={onOpen} title={entry.title}>
      <div className="sg-gcard-pic" data-gallery-card-picture={rec && coverPattern(rec) && entry.kind !== "viz" ? "timeline" : entry.hasThumbnail ? "thumbnail" : "generated"}>
        <CardPicture entry={entry} rec={rec} />
        <span className="sg-gcard-kind">{KIND_LABEL[entry.kind] ?? entry.kind}</span>
        {count && (
          <span
            className={hasPlay ? "sg-gcard-count sg-gcard-count-beside-play" : "sg-gcard-count"}
            data-gallery-card-count
            title={count}
          >
            {count}
          </span>
        )}
        {onPlay && hasPlay && (
          <button
            type="button"
            className="sg-gcard-play"
            data-gallery-card-play={entry.id}
            aria-label={`Play ${entry.title}`}
            title={`Play ${entry.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onPlay(rec?.cover ?? null);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z" /></svg>
          </button>
        )}
      </div>
      <div className="sg-gcard-text">
        <button
          type="button"
          className="sg-card-open sg-gcard-title"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {entry.title}
        </button>
        <div className="sg-gcard-meta">
          <Avatar name={shownName(entry.authorName)} colourKey={entry.authorId ?? entry.id} />
          <AuthorName name={entry.authorName} authorId={entry.authorId} onAuthor={onAuthor} />
          <span aria-hidden="true">·</span>
          <span title={formatGalleryDate(entry.publishedAt)}>{publishedAgo(entry.publishedAt)}</span>
        </div>
        {entry.tags.length > 0 && (
          <div className="sg-gcard-tags">
            {entry.tags.map((t) => (
              <span key={t} className="sg-gcard-tag">{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** An entry's picture on its own (the entry page's "More by"): it fetches the record itself. */
export function EntryPicture({ entry }: { entry: GalleryEntry }) {
  const rec = useEntryRecording(entry);
  return <CardPicture entry={entry} rec={rec} />;
}

export const CARD_CSS = `
.sg-gcard { display: grid; gap: 10px; align-content: start; text-align: left; color: inherit; cursor: pointer; font: inherit; min-width: 0; }
.sg-gcard-pic { position: relative; aspect-ratio: 16 / 10; border-radius: 10px; overflow: hidden; border: 1px solid var(--border-subtle); background: #101022; transition: border-color .15s; }
.sg-gcard:hover .sg-gcard-pic, .sg-gcard:focus-within .sg-gcard-pic { border-color: #44447a; }
.sg-gcard-pic .sg-thumb { position: absolute; inset: 0; width: 100%; height: 100%; aspect-ratio: auto; }
.sg-gcard-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.sg-gcard-kind { position: absolute; left: 8px; top: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; padding: 3px 7px; border-radius: 6px; background: rgba(8,8,15,.72); color: rgba(235,235,250,.85); backdrop-filter: blur(6px); }
.sg-gcard-count { position: absolute; left: 8px; bottom: 8px; box-sizing: border-box; max-width: calc(100% - 16px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; padding: 3px 7px; border-radius: 6px; background: rgba(8,8,15,.78); color: #ececf4; backdrop-filter: blur(6px); }
.sg-gcard-count-beside-play { max-width: calc(100% - 8px - 8px - 34px - 8px); }
.sg-gcard-play { position: absolute; right: 8px; bottom: 8px; width: 34px; height: 34px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(255,255,255,.18); border-radius: 50%; background: rgba(8,8,15,.78); color: #ececf4; cursor: pointer; backdrop-filter: blur(6px); transition: background .15s, transform .15s; }
.sg-gcard-play svg { margin-left: 2px; }
.sg-gcard-play:hover { background: var(--accent, #7aa2f7); color: #0b0b16; transform: scale(1.06); }
.sg-gcard-play:focus-visible { outline: 2px solid var(--accent, #7aa2f7); outline-offset: 2px; }
.sg-gcard-text { display: grid; gap: 3px; min-width: 0; }
.sg-gcard-title { font-size: 14px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sg-gcard-meta { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12.5px; color: var(--text-muted, var(--text-chrome)); white-space: nowrap; overflow: hidden; }
.sg-gcard-meta .sg-author-link { color: inherit; }
.sg-gcard-meta > a, .sg-gcard-meta > [data-gallery-author-plain] { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.sg-gcard-meta > span:last-child, .sg-gcard-meta > .sg-gcard-av, .sg-gcard-meta > span[aria-hidden] { flex: none; }
.sg-gcard-av { flex: none; border-radius: 50%; display: grid; place-items: center; font-weight: 600; color: #1a1a2e; }
.sg-gcard-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.sg-gcard-tag { font-size: 11.5px; color: var(--text-chrome); }
.sg-gcard-tag::before { content: "#"; opacity: .6; }
.sg-card { display: flex; flex-direction: column; text-align: left; padding: 0; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--bg-panel, transparent); color: inherit; cursor: pointer; overflow: hidden; font: inherit; }
.sg-card:hover, .sg-card:focus-within { border-color: var(--accent, #7aa2f7); }
.sg-card-open { display: block; width: 100%; padding: 0; border: none; background: none; text-align: left; cursor: pointer; font-family: inherit; line-height: inherit; }
.sg-card-open:focus-visible { outline: 2px solid var(--accent, #7aa2f7); outline-offset: 2px; }
.sg-author-link { color: var(--accent, #7aa2f7); text-decoration: none; cursor: pointer; }
.sg-author-link:hover, .sg-author-link:focus-visible { text-decoration: underline; }
.sg-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
`;
