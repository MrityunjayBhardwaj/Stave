"use client";

/**
 * #2331 — the Moderation tab, shown only to admins (GET /api/gallery/me says
 * `isAdmin`). Flagged entries with every report on them, each with Open, Take
 * down and Dismiss (both ask for a reason, which goes in the action log), what
 * was taken down and can still be restored (#2401), who is suspended (#2400), and the recent log below. The server checks the session on every call; hiding the
 * tab is only so nobody else sees a view that would answer 403.
 */
import React, { useCallback, useEffect, useState } from "react";

import { showPrompt, showToast } from "../dialogs/host";
import { KIND_LABEL } from "./galleryModel";
import { recordListChange } from "./localShares";
import {
  ACTION_LABEL,
  dismissReports,
  fetchAdminLog,
  fetchFlagged,
  fetchSuspensions,
  fetchTakenDown,
  liftSuspension,
  restoreEntry,
  suspendAuthor,
  takeDownEntry,
} from "./moderation";
import {
  MAX_REPORT_REASON_CHARS,
  type ActiveSuspension,
  type AdminLogRecord,
  type FlaggedEntry,
  type SuspensionDays,
  type TakenDownEntry,
} from "./types";

type Loaded<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

const when = (ms: number) =>
  Number.isFinite(ms)
    ? new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

/** #2400 — the suspend form, opened from an entry's row. */
function SuspendForm({
  authorId,
  authorName,
  onDone,
  onCancel,
}: {
  authorId: string;
  authorName: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [days, setDays] = useState<SuspensionDays>(7);
  const [takeDownAll, setTakeDownAll] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      await suspendAuthor({ authorId, days, takeDownAll, reason: reason.trim().slice(0, MAX_REPORT_REASON_CHARS) });
      showToast(`Suspended ${authorName}.`, "info");
      onDone();
    } catch (err) {
      showToast(`Couldn't do that — ${(err as Error).message}`, "error");
      setSending(false);
    }
  };

  return (
    <div className="sg-mod-suspend" data-gallery-suspend-form={authorId}>
      <div className="sg-card-meta">
        {authorName} won&apos;t be able to publish, edit, or report. They can still browse, delete their own work and make private links.
      </div>
      <label>
        For{" "}
        <select
          data-gallery-suspend-days
          value={days === null ? "permanent" : String(days)}
          onChange={(e) => setDays(e.target.value === "permanent" ? null : (Number(e.target.value) as SuspensionDays))}
        >
          <option value="7">a week</option>
          <option value="30">a month</option>
          <option value="permanent">permanently</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          data-gallery-suspend-all
          checked={takeDownAll}
          onChange={(e) => setTakeDownAll(e.target.checked)}
        />{" "}
        Also take down everything they&apos;ve published, and hide their profile
      </label>
      <input
        className="sg-mod-suspend-reason"
        data-gallery-suspend-reason
        placeholder="Why? It goes in the action log with your name."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="sg-actions">
        <button
          className="sg-btn sg-danger"
          data-gallery-suspend-confirm
          disabled={sending || !reason.trim()}
          onClick={() => void send()}
        >
          Suspend
        </button>
        <button className="sg-btn" disabled={sending} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function ModerationView({ onOpen }: { onOpen: (entryId: string) => void }) {
  const [flagged, setFlagged] = useState<Loaded<FlaggedEntry[]>>({ status: "loading" });
  const [takenDown, setTakenDown] = useState<Loaded<TakenDownEntry[]>>({ status: "loading" });
  const [log, setLog] = useState<Loaded<AdminLogRecord[]>>({ status: "loading" });
  const [suspensions, setSuspensions] = useState<Loaded<ActiveSuspension[]>>({ status: "loading" });
  const [suspending, setSuspending] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchFlagged()
      .then((r) => setFlagged({ status: "ready", data: r.flagged }))
      .catch((err: Error) => setFlagged({ status: "error", message: err.message }));
    fetchTakenDown()
      .then((r) => setTakenDown({ status: "ready", data: r.entries }))
      .catch((err: Error) => setTakenDown({ status: "error", message: err.message }));
    fetchSuspensions()
      .then((r) => setSuspensions({ status: "ready", data: r.suspensions }))
      .catch((err: Error) => setSuspensions({ status: "error", message: err.message }));
    fetchAdminLog()
      .then((r) => setLog({ status: "ready", data: r.actions }))
      .catch((err: Error) => setLog({ status: "error", message: err.message }));
  }, []);

  useEffect(load, [load]);

  const act = async (f: FlaggedEntry, kind: "take-down" | "dismiss") => {
    const title = f.entry?.title ?? f.entryId;
    const reason = (
      await showPrompt(
        kind === "take-down"
          ? {
              title: "Take this down?",
              description: `"${title}" will be removed for everyone. Say why: it goes in the action log with your name.`,
              placeholder: "e.g. hateful title, copied without credit",
              confirmLabel: "Take down",
            }
          : {
              title: "Dismiss these reports?",
              description: `"${title}" stays up and leaves this list. Say why: it goes in the action log with your name.`,
              placeholder: "e.g. reviewed, nothing wrong",
              confirmLabel: "Dismiss",
            },
      )
    )?.trim();
    if (!reason) return;
    setBusy(f.entryId);
    try {
      if (kind === "take-down") {
        await takeDownEntry(f.entryId, reason.slice(0, MAX_REPORT_REASON_CHARS));
        recordListChange(f.entryId, null);
        showToast(`Took down "${title}".`, "info");
      } else {
        await dismissReports(f.entryId, reason.slice(0, MAX_REPORT_REASON_CHARS));
        showToast(`Dismissed the reports on "${title}".`, "info");
      }
    } catch (err) {
      showToast(`Couldn't do that — ${(err as Error).message}`, "error");
    } finally {
      setBusy(null);
      load();
    }
  };

  const lift = async (s: ActiveSuspension) => {
    const reason = (
      await showPrompt({
        title: "Lift this suspension?",
        description: `${s.name} can publish again, and their profile comes back. Entries taken down with it stay down until you restore them. Say why: it goes in the action log with your name.`,
        placeholder: "e.g. suspended by mistake",
        confirmLabel: "Lift",
      })
    )?.trim();
    if (!reason) return;
    setBusy(s.authorId);
    try {
      await liftSuspension(s.authorId, reason.slice(0, MAX_REPORT_REASON_CHARS));
      showToast(`Lifted the suspension of ${s.name}.`, "info");
    } catch (err) {
      showToast(`Couldn't do that — ${(err as Error).message}`, "error");
    } finally {
      setBusy(null);
      load();
    }
  };

  /** The Suspend button and, once clicked, its form. Nothing for an entry with no author. */
  const suspendControls = (key: string, authorId: string | null | undefined, authorName: string) =>
    !authorId ? null : suspending === key ? (
      <SuspendForm
        authorId={authorId}
        authorName={authorName}
        onCancel={() => setSuspending(null)}
        onDone={() => {
          setSuspending(null);
          load();
        }}
      />
    ) : (
      <button className="sg-btn sg-danger" data-gallery-suspend={authorId} disabled={busy !== null} onClick={() => setSuspending(key)}>
        Suspend author
      </button>
    );

  const restore = async (t: TakenDownEntry) => {
    const reason = (
      await showPrompt({
        title: "Restore this?",
        description: `"${t.entry.title}" comes back for everyone, with the same link. Say why: it goes in the action log with your name.`,
        placeholder: "e.g. taken down by mistake",
        confirmLabel: "Restore",
      })
    )?.trim();
    if (!reason) return;
    setBusy(t.entry.id);
    try {
      await restoreEntry(t.entry.id, reason.slice(0, MAX_REPORT_REASON_CHARS));
      recordListChange(t.entry.id, t.entry);
      // #2433 — this browser shows it now; the CDN's cached list reaches everyone else later.
      showToast(`Restored "${t.entry.title}". It can take a few minutes to reappear for everyone else.`, "info");
    } catch (err) {
      showToast(`Couldn't do that — ${(err as Error).message}`, "error");
    } finally {
      setBusy(null);
      load();
    }
  };

  return (
    <div className="sg-mod" data-gallery-moderation>
      <section data-gallery-section="flagged">
        <h3 className="sg-section">Reported</h3>
        <p className="sg-section-note">Each report was sent by someone browsing. Take down or dismiss asks you for a reason.</p>
        {flagged.status === "loading" ? (
          <div className="sg-state sg-state-small">Loading the reports…</div>
        ) : flagged.status === "error" ? (
          <div className="sg-state sg-state-small" data-gallery-state="flagged-error">
            <p>Couldn&apos;t load the reports: {flagged.message}.</p>
            <button className="sg-btn" onClick={load}>Try again</button>
          </div>
        ) : flagged.data.length === 0 ? (
          <div className="sg-state sg-state-small" data-gallery-state="flagged-empty">Nothing is reported right now.</div>
        ) : (
          flagged.data.map((f) => (
            <div key={f.entryId} className="sg-mine-row sg-mod-row" data-gallery-flagged={f.entryId}>
              <div className="sg-mine-text">
                <div className="sg-card-title">{f.entry?.title ?? `(entry ${f.entryId} can't be read)`}</div>
                <div className="sg-card-meta">
                  {f.entry ? `${KIND_LABEL[f.entry.kind] ?? f.entry.kind} by ${f.entry.authorName} · ` : ""}
                  {f.reports.length} {f.reports.length === 1 ? "report" : "reports"}
                </div>
                <ul className="sg-mod-reasons">
                  {f.reports.map((r, i) => (
                    <li key={i} data-gallery-report-reason>
                      <span className="sg-mod-when">{when(r.reportedAt)}</span> {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="sg-actions">
                {f.entry && (
                  <button className="sg-btn" onClick={() => onOpen(f.entryId)}>Open</button>
                )}
                <button
                  className="sg-btn sg-danger"
                  data-gallery-take-down={f.entryId}
                  disabled={busy !== null}
                  onClick={() => void act(f, "take-down")}
                >
                  Take down
                </button>
                <button
                  className="sg-btn"
                  data-gallery-dismiss={f.entryId}
                  disabled={busy !== null}
                  onClick={() => void act(f, "dismiss")}
                >
                  Dismiss
                </button>
                {f.entry && suspendControls(`flagged:${f.entryId}`, f.entry.authorId, f.entry.authorName)}
              </div>
            </div>
          ))
        )}
      </section>

      <section data-gallery-section="taken-down">
        <h3 className="sg-section">Taken down</h3>
        <p className="sg-section-note">Hidden from everyone, and can be restored with the same link until the date shown. After that its files and the author&apos;s email are deleted.</p>
        {takenDown.status === "loading" ? (
          <div className="sg-state sg-state-small">Loading what was taken down…</div>
        ) : takenDown.status === "error" ? (
          <div className="sg-state sg-state-small" data-gallery-state="taken-down-error">
            <p>Couldn&apos;t load what was taken down: {takenDown.message}.</p>
            <button className="sg-btn" onClick={load}>Try again</button>
          </div>
        ) : takenDown.data.length === 0 ? (
          <div className="sg-state sg-state-small" data-gallery-state="taken-down-empty">Nothing can be restored right now.</div>
        ) : (
          takenDown.data.map((t) => {
            const expired = t.restoreBy <= Date.now();
            return (
              <div key={t.entry.id} className="sg-mine-row sg-mod-row" data-gallery-taken-down={t.entry.id}>
                <div className="sg-mine-text">
                  <div className="sg-card-title">{t.entry.title}</div>
                  <div className="sg-card-meta">
                    {KIND_LABEL[t.entry.kind] ?? t.entry.kind} by {t.entry.authorName} · taken down {when(t.removedAt)} ·{" "}
                    {expired ? "past its restore date, waiting for the clean-up" : `restore by ${when(t.restoreBy)}`}
                  </div>
                  {t.reason && <div className="sg-mod-reason">“{t.reason}”</div>}
                </div>
                <div className="sg-actions">
                  <button
                    className="sg-btn"
                    data-gallery-restore={t.entry.id}
                    disabled={busy !== null || expired}
                    onClick={() => void restore(t)}
                  >
                    Restore
                  </button>
                  {suspendControls(`taken-down:${t.entry.id}`, t.entry.authorId, t.entry.authorName)}
                </div>
              </div>
            );
          })
        )}
      </section>

      <section data-gallery-section="suspensions">
        <h3 className="sg-section">Suspended</h3>
        <p className="sg-section-note">Accounts that can&apos;t publish, edit or report. Nothing public says so.</p>
        {suspensions.status === "loading" ? (
          <div className="sg-state sg-state-small">Loading the suspensions…</div>
        ) : suspensions.status === "error" ? (
          <div className="sg-state sg-state-small" data-gallery-state="suspensions-error">
            <p>Couldn&apos;t load the suspensions: {suspensions.message}.</p>
            <button className="sg-btn" onClick={load}>Try again</button>
          </div>
        ) : suspensions.data.length === 0 ? (
          <div className="sg-state sg-state-small" data-gallery-state="suspensions-empty">Nobody is suspended.</div>
        ) : (
          suspensions.data.map((s) => (
            <div key={s.authorId} className="sg-mine-row sg-mod-row" data-gallery-suspended={s.authorId}>
              <div className="sg-mine-text">
                <div className="sg-card-title">{s.name}</div>
                <div className="sg-card-meta">
                  Since {when(s.at)} · {s.until === null ? "permanently" : `until ${when(s.until)}`}
                  {s.hideProfile ? " · profile hidden" : ""}
                </div>
                <div className="sg-mod-reason">“{s.reason}”</div>
              </div>
              <div className="sg-actions">
                <button className="sg-btn" data-gallery-lift={s.authorId} disabled={busy !== null} onClick={() => void lift(s)}>
                  Lift
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section data-gallery-section="admin-log">
        <h3 className="sg-section">Action log</h3>
        <p className="sg-section-note">Every take-down, dismissal, restore, suspension and lift by any admin, and what the clean-up deleted, newest first. Only admins see this.</p>
        {log.status === "loading" ? (
          <div className="sg-state sg-state-small">Loading the log…</div>
        ) : log.status === "error" ? (
          <div className="sg-state sg-state-small" data-gallery-state="log-error">
            <p>Couldn&apos;t load the log: {log.message}.</p>
            <button className="sg-btn" onClick={load}>Try again</button>
          </div>
        ) : log.data.length === 0 ? (
          <div className="sg-state sg-state-small" data-gallery-state="log-empty">No admin actions yet.</div>
        ) : (
          <ol className="sg-mod-log">
            {log.data.map((r, i) => (
              <li key={`${r.at}-${i}`} data-gallery-log-action={r.action} data-gallery-log-target={r.target}>
                <div className="sg-card-meta">
                  {when(r.at)} · {r.admin.name || r.admin.accountId}{" "}
                  <span className="sg-mod-who">({r.admin.provider})</span>
                </div>
                <div>
                  {ACTION_LABEL[r.action] ?? r.action} <code>{r.target}</code>
                </div>
                <div className="sg-mod-reason">“{r.reason}”</div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export const MODERATION_CSS = `
.sg-mod-suspend { display: flex; flex-direction: column; gap: 8px; width: 100%; font-size: 13px; }
.sg-mod-suspend-reason { width: 100%; box-sizing: border-box; padding: 6px 8px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 6px; }
.sg-mod { display: flex; flex-direction: column; gap: 8px; }
.sg-mod section { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
.sg-mod-row { align-items: flex-start; }
.sg-mod-reasons { margin: 6px 0 0; padding-left: 18px; font-size: 13px; display: flex; flex-direction: column; gap: 3px; overflow-wrap: anywhere; }
.sg-mod-when { font-size: 11px; opacity: .7; }
.sg-mod-log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.sg-mod-log li { padding: 8px 12px; border: 1px solid var(--border-subtle); border-radius: 8px; font-size: 13px; overflow-wrap: anywhere; }
.sg-mod-log code { font-size: 12px; }
.sg-mod-who { opacity: .7; }
.sg-mod-reason { font-style: italic; opacity: .9; margin-top: 2px; }
`;
