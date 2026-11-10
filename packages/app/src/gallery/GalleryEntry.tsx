"use client";

/**
 * #2491 — one gallery entry's page (epic #2485).
 *
 * Laid out as the redesign's mockup: a breadcrumb, then the preview leading on
 * the left with "In this project" (one row per file, each with its own play
 * button) and the code under it, coloured, with line numbers; on the right one
 * column — title, artist, tags, the actions, the details, the safety note, and
 * more by the same artist.
 *
 * Nothing here runs the entry's code: the code is drawn as text (codeColour.ts
 * makes React text nodes, never HTML), and playing happens only inside the
 * sealed preview frame (GalleryPreview.tsx). There is one preview, so one file
 * plays at a time; a row's play button switches the file it holds.
 *
 * Not drawn yet, because the data doesn't exist: a pattern's timeline strip, its
 * length in bars, the tempo and the author-chosen cover come from what is
 * recorded at publish (#2487, #2488); the live piano roll inside the frame is
 * #2489.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AuthorName, EntryPicture, avatarColour, useEntryRecording } from "./GalleryCards";
import { GalleryPreview, type GalleryPreviewHandle } from "./GalleryPreview";
import { previewKindOf } from "./previewProtocol";
import { codeLanguageOf, colourLines, type TokenKind } from "./codeColour";
import { RecordingTimeline, lengthLabel } from "./GalleryTimeline";
import { GALLERY_FILTERS, KIND_LABEL, contentsSummary, fileRole, formatGalleryDate, publishedAgo } from "./galleryModel";
import { shownName } from "./reservedNames";
import { GalleryCrumbs } from "./GalleryBar";
import type { DetailState } from "./galleryStore";
import type { GalleryEntry, GalleryEntryResponse, GalleryKind } from "./types";

type Manifest = GalleryEntryResponse["manifest"];

export interface EntryPageProps {
  detail: DetailState;
  busy: boolean;
  /** "← Back" when something else is under this entry (a profile, a collection). */
  backLabel: string | null;
  onBack: () => void;
  /** The breadcrumb's "Gallery": the grid. */
  onHome: () => void;
  /** The breadcrumb's kind: the grid, filtered to it. */
  onKind: (kind: GalleryKind) => void;
  onAuthor: (authorId: string) => void;
  onRetry: () => void;
  onOpenAsProject: (e: GalleryEntry, m: Manifest) => void;
  onAddToProject: (e: GalleryEntry, m: Manifest) => void;
  onCopyLink: (id: string) => void;
  onReport: (e: GalleryEntry) => void;
  /** The loaded list, for "More by". */
  listed: readonly GalleryEntry[] | null;
  onOpenEntry: (id: string) => void;
  /** The overlay's ×, drawn at the end of the breadcrumb bar. */
  onClose?: () => void;
}

const TOKEN_CLASS: Record<TokenKind, string | undefined> = {
  keyword: "sg-tk",
  string: "sg-ts",
  number: "sg-tn",
  function: "sg-tf",
  comment: "sg-tc",
  plain: undefined,
};

/** The code, coloured, one numbered line per line. */
export function CodeView({ path, content }: { path: string; content: string }) {
  const lines = useMemo(() => colourLines(content, codeLanguageOf(path)), [path, content]);
  return (
    <pre className="sg-code" data-gallery-code={path}>
      {lines.map((line, i) => (
        <span key={i} className="sg-code-line">
          {line.map((t, j) =>
            TOKEN_CLASS[t.kind] ? (
              <span key={j} className={TOKEN_CLASS[t.kind]}>
                {t.text}
              </span>
            ) : (
              <React.Fragment key={j}>{t.text}</React.Fragment>
            ),
          )}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

const PLAY_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z" /></svg>
);
const STOP_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
);

export function EntryPage(props: EntryPageProps) {
  const { detail, busy, backLabel, onBack, onHome, onKind, onAuthor, onRetry, onClose } = props;
  // The file chosen, by path: the list is re-ordered (cover first) once the record arrives.
  const [chosen, setChosen] = useState<string | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [playing, setPlaying] = useState(false);
  const preview = useRef<GalleryPreviewHandle>(null);
  useEffect(() => {
    setChosen(null);
    setAutoStart(false);
  }, [detail.id]);

  const ready = detail.status === "ready" ? detail.data : null;
  // #2487 — what each pattern plays, recorded at publish (none for older entries)
  const rec = useEntryRecording(ready?.entry ?? { id: detail.id, hasRecording: false });
  const kindLabel = ready ? GALLERY_FILTERS.find((f) => f.id === ready.entry.kind)?.label : undefined;
  const kindCrumb =
    ready && kindLabel ? [{ label: kindLabel, hook: "kind", onClick: () => onKind(ready.entry.kind) }] : [];
  const crumbs = (
    <GalleryCrumbs
      backLabel={backLabel}
      onBack={onBack}
      onHome={onHome}
      middle={kindCrumb}
      here={ready?.entry.title ?? "Entry"}
      onClose={onClose}
    />
  );

  if (!ready) {
    return (
      <div className="sg-body sg-entry-page" data-gallery-detail-state={detail.status}>
        {crumbs}
        {detail.status === "loading" && (
          <div className="sg-state" data-gallery-state="loading">Loading the entry…</div>
        )}
        {detail.status === "removed" && (
          <div className="sg-state" data-gallery-state="removed">This was removed from the gallery.</div>
        )}
        {detail.status === "error" && (
          <div className="sg-state" data-gallery-state="error">
            <p>Couldn&apos;t open the entry: {detail.message}.</p>
            <button className="sg-btn" onClick={onRetry}>Try again</button>
          </div>
        )}
      </div>
    );
  }

  const { entry, manifest } = ready;
  // #2488 — the cover first, as the author chose it; the rest in the project's order
  const files = [...(manifest.files ?? [])].sort((a, b) => Number(b.path === rec?.cover) - Number(a.path === rec?.cover));
  // nothing chosen yet: the first file, which is the cover once the record has arrived
  const found = chosen === null ? -1 : files.findIndex((f) => f.path === chosen);
  const idx = found >= 0 ? found : 0;
  const file = files[idx];
  const kind = file ? previewKindOf(file) : null;

  // A row's play: its file into the one preview, playing; on the file already there, play / stop.
  const playRow = (i: number) => {
    if (i === idx) {
      preview.current?.toggle();
      return;
    }
    setAutoStart(true);
    setPlaying(false);
    setChosen(files[i]?.path ?? null);
  };
  const showFile = (i: number) => {
    setAutoStart(false);
    setChosen(files[i]?.path ?? null);
  };

  const recordedFor = (path: string) => rec?.files.find((r) => r.path === path) ?? null;

  const more = (props.listed ?? [])
    .filter((e) => e.authorId && e.authorId === entry.authorId && e.id !== entry.id)
    .slice(0, 3);
  const name = shownName(entry.authorName);

  return (
    <div className="sg-body sg-entry-page" data-gallery-detail={entry.id}>
      {crumbs}
      <div className="sg-entry">
        <div className="sg-entry-main">
          {file && kind ? (
            <GalleryPreview
              idle={recordedFor(file.path) ? <RecordingTimeline rec={recordedFor(file.path)!} className="sg-stage-canvas" /> : undefined}
              ref={preview}
              code={file.content}
              kind={kind}
              fileKey={`${entry.id}/${file.id}`}
              autoStart={autoStart}
              onPlayingChange={setPlaying}
            />
          ) : (
            <div className="sg-stage sg-stage-none">
              <div className="sg-stage-idle">
                <span>{file ? "This file can't be previewed." : "This entry has no files."}</span>
              </div>
            </div>
          )}

          {files.length > 1 && (
            <section className="sg-contents" aria-label="In this project">
              <div className="sg-contents-head">
                In this {entry.kind === "project" ? "project" : "entry"} <span>{contentsSummary(files)}</span>
              </div>
              {files.map((f, i) => {
                const playable = previewKindOf(f) !== null;
                const on = i === idx;
                const role = fileRole(f.path);
                const lines = f.content.split("\n").length;
                const recorded = rec?.files.find((r) => r.path === f.path) ?? null;
                const isCover = rec?.cover === f.path;
                return (
                  <div
                    key={f.id}
                    className={on ? "sg-frow sg-frow-on" : "sg-frow"}
                    data-gallery-file-row={f.path}
                    aria-current={on ? "true" : undefined}
                  >
                    {playable ? (
                      <button
                        className="sg-miniplay"
                        data-gallery-file-play={f.path}
                        aria-label={on && playing ? `Stop ${f.path}` : `Play ${f.path}`}
                        onClick={() => playRow(i)}
                      >
                        {on && playing ? STOP_ICON : PLAY_ICON}
                      </button>
                    ) : (
                      <span className="sg-miniplay sg-miniplay-off" aria-hidden="true" />
                    )}
                    <button className="sg-fname" onClick={() => showFile(i)}>
                      <b>{f.path}</b>
                      <span>
                        {recorded ? lengthLabel(recorded) : `${role} · ${lines} ${lines === 1 ? "line" : "lines"}`}
                      </span>
                    </button>
                    <div className="sg-frow-strip">
                      {recorded && <RecordingTimeline rec={recorded} compact className="sg-frow-canvas" />}
                    </div>
                    {isCover ? <span className="sg-frow-tag" data-gallery-cover>Cover</span> : <span />}
                  </div>
                );
              })}
            </section>
          )}

          {file ? (
            <div className="sg-files-box">
              {files.length > 1 && (
                <div className="sg-files" role="tablist" aria-label="Files">
                  {files.map((f, i) => (
                    <button
                      key={f.id}
                      role="tab"
                      aria-selected={i === idx}
                      className={i === idx ? "sg-file sg-file-on" : "sg-file"}
                      onClick={() => showFile(i)}
                    >
                      {f.path}
                    </button>
                  ))}
                </div>
              )}
              {files.length === 1 && <div className="sg-files sg-files-one">{file.path}</div>}
              <CodeView path={file.path} content={file.content} />
            </div>
          ) : null}
        </div>

        <aside className="sg-side">
          <h3 className="sg-side-title">{entry.title}</h3>
          <div className="sg-byline">
            <span className="sg-av" aria-hidden="true" style={{ background: avatarColour(entry.authorId ?? name) }}>
              {name.trim().slice(0, 1).toUpperCase() || "?"}
            </span>
            <div>
              <b>
                <AuthorName name={entry.authorName} authorId={entry.authorId} onAuthor={onAuthor} />
              </b>
              <span title={formatGalleryDate(entry.publishedAt)}>Published {publishedAgo(entry.publishedAt)}</span>
            </div>
          </div>
          {entry.tags.length > 0 && (
            <div className="sg-side-tags">
              {entry.tags.map((t) => (
                <span key={t} className="sg-side-tag">{t}</span>
              ))}
            </div>
          )}
          <div className="sg-side-actions" data-gallery-actions>
            <button className="sg-btn sg-primary" disabled={busy} onClick={() => props.onOpenAsProject(entry, manifest)}>
              Open as new project
            </button>
            {entry.kind !== "project" && (
              <button className="sg-btn" disabled={busy} onClick={() => props.onAddToProject(entry, manifest)}>
                Add to this project
              </button>
            )}
          </div>
          <div className="sg-side-row">
            <button className="sg-btn sg-ghost" onClick={() => props.onCopyLink(entry.id)}>Copy link</button>
            <button className="sg-btn sg-ghost" onClick={() => props.onReport(entry)}>Report</button>
          </div>
          <dl className="sg-facts">
            <dt>Kind</dt>
            <dd>{KIND_LABEL[entry.kind] ?? entry.kind}</dd>
            <dt>Contains</dt>
            <dd>{contentsSummary(files, ", ") || "nothing"}</dd>
            {rec?.cover && (
              <>
                <dt>Cover</dt>
                <dd>
                  {rec.cover}
                  {rec.files.find((r) => r.path === rec.cover) ? `, ${lengthLabel(rec.files.find((r) => r.path === rec.cover)!)}` : ""}
                </dd>
              </>
            )}
            <dt>Published</dt>
            <dd>{formatGalleryDate(entry.publishedAt)}</dd>
          </dl>
          <div className="sg-note" data-gallery-safe-note>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
            <span>Nothing from this entry has run. Once it&apos;s open, it plays only when you press Play.</span>
          </div>
          {more.length > 0 && (
            <div className="sg-more">
              <h4>More by {name}</h4>
              {more.map((e) => (
                <button key={e.id} className="sg-mini" data-gallery-more={e.id} onClick={() => props.onOpenEntry(e.id)}>
                  <span className="sg-mini-pic">
                    <EntryPicture entry={e} />
                  </span>
                  <span>
                    {e.title}
                    <small>
                      {KIND_LABEL[e.kind] ?? e.kind} · {publishedAgo(e.publishedAt)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export const ENTRY_CSS = `
.sg-entry-page { padding: 0; container-type: inline-size; display: flex; flex-direction: column; }
.sg-entry-page > .sg-entry { flex: 1 0 auto; }
.sg-entry { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 28px; padding: 22px 24px 40px; align-items: start; }
.sg-entry-main { display: grid; gap: 14px; min-width: 0; }
.sg-stage { position: relative; aspect-ratio: 2 / 1; border-radius: 12px; overflow: hidden; border: 1px solid var(--border-subtle); background: radial-gradient(120% 90% at 30% 20%, rgba(124,108,255,.22), transparent 60%), radial-gradient(90% 80% at 85% 90%, rgba(127,214,194,.14), transparent 60%), var(--bg-input, #12121f); }
.sg-stage-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #000; }
.sg-stage-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.sg-stage-idle { position: absolute; inset: 0; display: grid; place-items: center; color: var(--text-muted, var(--text-chrome)); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; opacity: .7; }
.sg-stage-bar { position: absolute; inset: auto 0 0 0; display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: linear-gradient(transparent, rgba(8,8,15,.88)); }
.sg-bigplay { flex: none; width: 44px; height: 44px; border-radius: 50%; border: 0; background: var(--text-primary, #eee); color: var(--bg-elevated, #111); display: grid; place-items: center; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.4); }
.sg-bigplay:hover { transform: scale(1.04); }
.sg-sealed { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; color: rgba(235,235,250,.85); font-size: 12.5px; overflow-wrap: anywhere; }
.sg-stage-close { flex: none; background: rgba(8,8,15,.6); border: 1px solid rgba(255,255,255,.15); color: #eee; border-radius: 8px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
.sg-contents { border: 1px solid var(--border-subtle); border-radius: 12px; overflow: hidden; }
.sg-contents-head { display: flex; align-items: baseline; gap: 10px; padding: 10px 14px; background: var(--bg-hover, rgba(255,255,255,.03)); border-bottom: 1px solid var(--border-subtle); font-size: 13px; font-weight: 600; color: var(--text-primary); }
.sg-contents-head span { font-weight: 400; font-size: 12px; color: var(--text-muted, var(--text-chrome)); }
.sg-frow { display: grid; grid-template-columns: 32px minmax(0, 170px) minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); }
.sg-frow:last-child { border-bottom: 0; }
.sg-frow-strip { min-width: 0; height: 34px; }
.sg-frow-canvas { width: 100%; height: 34px; display: block; border-radius: 6px; }
.sg-frow-tag { font-size: 11px; color: var(--text-muted, var(--text-chrome)); border: 1px solid var(--border-subtle); border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
.sg-frow-on { background: var(--bg-hover, rgba(255,255,255,.05)); }
.sg-miniplay { width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border-strong); background: none; display: grid; place-items: center; color: var(--text-primary); cursor: pointer; padding: 0; }
.sg-frow-on .sg-miniplay { background: var(--text-primary, #eee); color: var(--bg-elevated, #111); border-color: var(--text-primary, #eee); }
.sg-miniplay-off { border-style: dashed; opacity: .4; cursor: default; }
.sg-fname { display: grid; gap: 1px; min-width: 0; text-align: left; background: none; border: 0; padding: 0; cursor: pointer; color: inherit; font: inherit; }
.sg-fname b { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sg-fname span { font-size: 11.5px; color: var(--text-muted, var(--text-chrome)); }
.sg-files-box { border: 1px solid var(--border-subtle); border-radius: 12px; overflow: hidden; }
.sg-files { display: flex; gap: 2px; padding: 6px; background: var(--bg-hover, rgba(255,255,255,.03)); border-bottom: 1px solid var(--border-subtle); overflow-x: auto; }
.sg-files-one { padding: 8px 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--text-muted, var(--text-chrome)); }
.sg-file { flex: none; border: 0; background: none; height: 28px; padding: 0 10px; border-radius: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--text-muted, var(--text-chrome)); cursor: pointer; }
.sg-file-on { background: var(--bg-elevated); color: var(--text-primary); }
.sg-code { margin: 0; padding: 14px 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.7; background: var(--bg-editor, rgba(0,0,0,.25)); color: var(--text-primary); overflow-x: auto; counter-reset: sg-ln; white-space: pre; user-select: text; tab-size: 2; }
.sg-code-line { display: block; padding: 0 16px 0 52px; position: relative; min-height: 1.7em; }
.sg-code-line::before { counter-increment: sg-ln; content: counter(sg-ln); position: absolute; left: 0; width: 36px; text-align: right; color: #55557a; user-select: none; }
.sg-tk { color: #c8a8ff; } .sg-ts { color: #9ee6b8; } .sg-tn { color: #ffc27a; } .sg-tf { color: #8fc8ff; } .sg-tc { color: #6f6f92; font-style: italic; }
.sg-side { display: grid; gap: 18px; align-content: start; min-width: 0; }
.sg-side-title { margin: 0; font-size: 24px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; color: var(--text-primary); text-wrap: balance; overflow-wrap: anywhere; }
.sg-byline { display: flex; align-items: center; gap: 10px; }
.sg-av { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 600; color: #1a1a2e; }
.sg-byline b { display: block; font-weight: 600; color: var(--text-primary); }
.sg-byline b .sg-author-link { color: inherit; text-decoration: none; }
.sg-byline b .sg-author-link:hover { text-decoration: underline; }
.sg-byline span { color: var(--text-muted, var(--text-chrome)); font-size: 12.5px; }
.sg-side-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.sg-side-tag { font-size: 12px; color: var(--text-chrome); }
.sg-side-tag::before { content: "#"; opacity: .6; }
.sg-side-actions { display: grid; gap: 8px; }
.sg-side-actions .sg-btn { height: 40px; display: inline-flex; align-items: center; justify-content: center; }
.sg-side-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: -10px; }
.sg-side-row .sg-btn { height: 40px; }
.sg-ghost { background: none; }
.sg-facts { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: 13px; }
.sg-facts dt { color: var(--text-muted, var(--text-chrome)); }
.sg-facts dd { margin: 0; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.sg-note { display: flex; gap: 10px; padding: 12px; border-radius: 10px; background: var(--bg-hover, rgba(255,255,255,.05)); font-size: 12.5px; color: var(--text-muted, var(--text-chrome)); line-height: 1.45; }
.sg-note svg { flex: none; margin-top: 1px; }
.sg-more { display: grid; gap: 10px; }
.sg-more h4 { margin: 0; font-size: 12.5px; font-weight: 500; color: var(--text-muted, var(--text-chrome)); }
.sg-mini { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 10px; align-items: center; background: none; border: 0; padding: 0; text-align: left; cursor: pointer; color: var(--text-primary); font: inherit; font-size: 13px; }
.sg-mini-pic { position: relative; display: block; width: 64px; height: 40px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border-subtle); background: #101022; }
.sg-mini-pic .sg-thumb, .sg-mini-pic canvas { position: absolute; inset: 0; width: 100%; height: 100%; aspect-ratio: auto; }
.sg-mini .sg-initials { font-size: 13px; }
.sg-mini .sg-kind-tag { display: none; }
.sg-mini small { display: block; color: var(--text-muted, var(--text-chrome)); font-size: 12px; }
/* Narrow (a phone, or a narrow tab): one column in the phone mockup's order, the
   main actions in a sheet held at the bottom while you scroll. */
@container (max-width: 760px) {
  .sg-entry { display: flex; flex-direction: column; gap: 16px; padding: 16px 16px 0; }
  .sg-entry-main, .sg-side { display: contents; }
  .sg-entry > *, .sg-entry-main > *, .sg-side > * { width: 100%; min-width: 0; box-sizing: border-box; }
  .sg-stage { order: 0; aspect-ratio: 4 / 3; }
  .sg-contents { order: 1; }
  .sg-byline { order: 2; }
  .sg-side-tags { order: 3; }
  .sg-files-box { order: 4; }
  .sg-side-row { order: 5; margin-top: 0; }
  .sg-facts { order: 6; }
  .sg-note { order: 7; }
  .sg-more { order: 8; padding-bottom: 8px; }
  .sg-side-title { display: none; }
  .sg-side-actions { order: 99; margin-top: auto !important; position: sticky; bottom: 0; z-index: 2; width: calc(100% + 32px) !important; margin-left: -16px; margin-right: -16px; margin-bottom: 0; padding: 12px 16px 16px; background: var(--bg-app); border-top: 1px solid var(--border-subtle); }
  .sg-side-actions .sg-btn { height: 46px; }
  .sg-crumbs { padding: 12px 16px; }
  .sg-frow { grid-template-columns: 32px minmax(0, 1fr) auto; }
  .sg-frow-strip { display: none; }
}
`;
