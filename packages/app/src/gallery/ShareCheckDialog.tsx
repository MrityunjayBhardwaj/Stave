"use client";

import React, { useEffect } from "react";

import type { ShareCheckAnswer } from "../shareProject";
import { TurnstileWidget } from "./TurnstileWidget";

/**
 * #2364 — the "are you human" check in front of a private link made signed out.
 *
 * Copy Private Link is one click, so this asks for nothing it doesn't have to:
 * the moment the widget hands out a token the dialog answers and goes away, and
 * for most people that means it flashes up and the link is copied. Only someone
 * Cloudflare wants a closer look at has anything to do here.
 *
 * It only answers with a token. Each opening is a new widget, so a token is never
 * used twice; what happens next, and what a refusal says, is StaveApp's Copy
 * Private Link, the one place every door goes through.
 *
 * The long link stays on offer: it stores nothing on our side, so it needs no
 * check, and it's the way through for someone whose browser blocks Cloudflare.
 */
export function ShareCheckDialog({
  siteKey,
  onAnswer,
}: {
  siteKey: string;
  onAnswer: (answer: ShareCheckAnswer) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onAnswer({ skip: "cancel" });
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onAnswer]);

  return (
    <div style={styles.backdrop} onClick={() => onAnswer({ skip: "cancel" })}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Copy Private Link"
        data-testid="share-check-dialog"
        style={styles.modal}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={styles.title}>One quick check</h3>
        <p style={styles.note}>
          You&apos;re not signed in, so Stave checks you&apos;re a person before storing a short link. It&apos;s copied as
          soon as this passes.
        </p>
        <TurnstileWidget
          siteKey={siteKey}
          action="share-link"
          onToken={(token) => {
            if (token) onAnswer({ token });
          }}
          testId="share-check-turnstile"
        />
        <p style={styles.note}>
          A long link needs no check: it carries the whole project itself, not encrypted, so anyone who has it can read it.
        </p>
        <div style={styles.actions}>
          <button type="button" style={styles.button} onClick={() => onAnswer({ skip: "cancel" })}>
            Cancel
          </button>
          <button
            type="button"
            style={styles.button}
            onClick={() => onAnswer({ skip: "long" })}
            data-testid="share-check-long"
          >
            Copy the long link instead
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 10001,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg-overlay)",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  modal: {
    width: "min(440px, 92vw)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "16px 18px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
    color: "var(--text-chrome)",
  },
  title: { margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text-primary)" },
  note: { margin: 0, fontSize: 13, lineHeight: 1.5 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  button: {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid var(--border-strong)",
    background: "transparent",
    color: "var(--text-primary)",
    fontSize: 13,
    cursor: "pointer",
  },
};
