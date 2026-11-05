"use client";

import React, { useEffect, useRef, useState } from "react";

import { TurnstileWidget, turnstileSiteKey } from "./TurnstileWidget";
import { MAX_REPORT_REASON_CHARS, type GalleryEntry } from "./types";

/**
 * #2330 — Report this entry. It used to be the app's generic prompt; it is its
 * own small dialog now so the Turnstile check (when this site has one) can sit
 * inside it. `send` does the request and throws an Error a person can read;
 * on failure the dialog stays open with the message, and the check is redone
 * (a token is good once).
 */
export function ReportDialog({
  entry,
  send,
  onClose,
}: {
  entry: GalleryEntry;
  send: (reason: string, turnstileToken: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const siteKey = turnstileSiteKey();
  const [reason, setReason] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    field.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, sending]);

  const trimmed = reason.trim();
  const blocked = sending || !trimmed || (!!siteKey && !token);

  const submit = async () => {
    if (blocked) return;
    setSending(true);
    setError(null);
    try {
      await send(trimmed.slice(0, MAX_REPORT_REASON_CHARS), siteKey ? token : null);
      onClose();
    } catch (err) {
      setError((err as Error)?.message || "the report couldn't be sent");
      setSending(false);
      if (siteKey) setRound((r) => r + 1);
    }
  };

  return (
    <div className="sg-report-backdrop" onClick={sending ? undefined : onClose}>
      <form
        className="sg-report"
        role="dialog"
        aria-modal="true"
        aria-label="Report this entry"
        data-testid="gallery-report-dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h3 className="sg-report-title">Report this entry</h3>
        <p className="sg-report-note">
          What&apos;s wrong with &ldquo;{entry.title}&rdquo;? A person reads every report.
        </p>
        <textarea
          ref={field}
          className="sg-report-field"
          value={reason}
          maxLength={MAX_REPORT_REASON_CHARS}
          placeholder="e.g. offensive title, copies someone else's work"
          onChange={(e) => setReason(e.target.value)}
          data-testid="gallery-report-reason"
        />
        {siteKey && (
          <TurnstileWidget key={round} siteKey={siteKey} onToken={setToken} testId="gallery-report-turnstile" />
        )}
        {error && (
          <div className="sg-report-error" role="alert">
            Couldn&apos;t send the report: {error}
          </div>
        )}
        <div className="sg-report-actions">
          <button type="button" className="sg-btn" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button type="submit" className="sg-btn sg-primary" disabled={blocked} data-testid="gallery-report-send">
            {sending ? "Sending…" : "Report"}
          </button>
        </div>
      </form>
    </div>
  );
}

export const REPORT_CSS = `
.sg-report-backdrop { position: fixed; inset: 0; z-index: 10001; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.35); font-family: system-ui, -apple-system, sans-serif; }
.sg-report { width: min(440px, 92vw); display: flex; flex-direction: column; gap: 10px; padding: 16px 18px; background: var(--bg-elevated); border: 1px solid var(--border-strong); border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,.45); color: var(--text-chrome); }
.sg-report-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
.sg-report-note { margin: 0; font-size: 13px; line-height: 1.5; }
.sg-report-field { min-height: 80px; resize: vertical; padding: 7px 9px; border-radius: 6px; border: 1px solid var(--border-strong); background: var(--bg-input, var(--bg-elevated)); color: var(--text-primary); font: inherit; font-size: 13px; }
.sg-report-error { font-size: 12px; line-height: 1.5; color: var(--text-error, #f27878); }
.sg-report-actions { display: flex; justify-content: flex-end; gap: 8px; }
`;
