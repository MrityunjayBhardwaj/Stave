"use client";

import React, { useEffect, useRef, useState } from "react";

import type { TurnstileAction } from "./types";

/**
 * #2330 — Cloudflare Turnstile in the publish dialog, the report dialog and (#2364)
 * the check before a private link made signed out (ShareCheckDialog.tsx).
 *
 * Shown only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set (it is inlined at build
 * time). The widget hands back a token through `onToken`; the caller sends it
 * in the TURNSTILE_HEADER header and the server checks it (api/gallery/turnstile.ts).
 * A token is good once and for five minutes: after a failed send, remount the
 * widget (change its React `key`) to get a fresh one. Turnstile refreshes an
 * expired token by itself; `onToken(null)` says the old one is gone meanwhile.
 *
 * The script is loaded from Cloudflare's own URL (their docs say never to proxy
 * or cache it), once per page, with render=explicit so it draws only where we ask.
 *
 * Cross-origin isolation (next.config.ts: COOP same-origin + COEP credentialless):
 * nothing extra is needed. Observed in Chromium on the dev server (2026-11-05,
 * crossOriginIsolated true): api.js answers with CORP cross-origin, and the
 * widget's iframe document (challenges.cloudflare.com/cdn-cgi/challenge-platform/…)
 * answers with COEP require-corp + CORP cross-origin, so it may be framed by an
 * isolated page without the `credentialless` attribute (which we couldn't add
 * anyway: Turnstile makes the iframe itself, inside a closed shadow root). The
 * test key's widget showed "Success!" and handed out its token.
 */

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      action?: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
      size?: "normal" | "flexible" | "compact";
    },
  ): string | undefined;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** The site key this build was made with, or "" when Turnstile is off. */
export function turnstileSiteKey(): string {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window !== "undefined" && window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("no turnstile")));
    script.onerror = () => reject(new Error("the check couldn't load"));
    document.head.appendChild(script);
  }).catch((err) => {
    loading = null; // let the next open try again
    throw err;
  });
  return loading;
}

/** "unloaded": the script never arrived. "refused": it ran and the check failed. */
type Status = "loading" | "ready" | "unloaded" | "refused";

/**
 * Stave's theme is a set of CSS colours, not the OS setting Turnstile's "auto"
 * follows, so read it off the page: light text means a dark theme.
 */
function themeOf(el: HTMLElement): "light" | "dark" {
  const m = getComputedStyle(el).color.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return "dark";
  const [r, g, b] = m.slice(0, 3).map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 128 ? "dark" : "light";
}

export function TurnstileWidget({
  siteKey,
  action,
  onToken,
  testId,
}: {
  siteKey: string;
  /** #2347 — what the token is for; the server refuses a token made for another action. */
  action: TurnstileAction;
  onToken: (token: string | null) => void;
  testId?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  // The latest onToken without re-rendering the widget when the parent re-renders.
  const report = useRef(onToken);
  report.current = onToken;

  useEffect(() => {
    let widgetId: string | undefined;
    let gone = false;
    setStatus("loading");
    loadTurnstile()
      .then((api) => {
        if (gone || !box.current) return;
        widgetId = api.render(box.current, {
          sitekey: siteKey,
          action,
          theme: themeOf(box.current),
          size: "flexible",
          callback: (token) => report.current(token),
          "expired-callback": () => report.current(null),
          "error-callback": () => {
            report.current(null);
            setStatus("refused");
          },
        });
        // The error callback may already have run during render; don't hide it.
        setStatus((s) => (s === "loading" ? "ready" : s));
      })
      .catch(() => {
        if (!gone) setStatus("unloaded");
      });
    return () => {
      gone = true;
      report.current(null);
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          /* already gone */
        }
      }
    };
  }, [siteKey, action]);

  return (
    <div data-testid={testId} data-turnstile-status={status}>
      <div ref={box} />
      {status === "loading" && (
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Loading the &ldquo;are you human&rdquo; check…</span>
      )}
      {status === "unloaded" && (
        <span role="alert" style={{ fontSize: 12, color: "var(--danger-fg, #f87171)" }}>
          The &ldquo;are you human&rdquo; check couldn&apos;t load. Check your connection or any content blocker, then
          close this and try again.
        </span>
      )}
      {status === "refused" && (
        <span role="alert" style={{ fontSize: 12, color: "var(--danger-fg, #f87171)" }}>
          The &ldquo;are you human&rdquo; check didn&apos;t pass, so this can&apos;t be sent. Close this and try again;
          if it keeps failing, try another browser or turn off extensions that block scripts.
        </span>
      )}
    </div>
  );
}
