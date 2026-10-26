"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectMeta } from "@stave/editor";

/** First-attempt budget for the IDB-dependent boot before we retry. */
const BOOT_IDB_BUDGET_MS = 8000;
/** Shorter budget for the automatic + manual retries. */
const RETRY_BUDGET_MS = 4000;

function HidePreloader() {
  useEffect(() => {
    const el = document.getElementById("stave-preloader");
    if (el) {
      el.classList.add("hidden");
      setTimeout(() => el.remove(), 300);
    }
  }, []);
  return null;
}

/**
 * Update the live status line inside the static preloader (layout.tsx) to
 * reflect the real bootstrap phase. Replaces the old fake timed step labels
 * with honest progress. No-op once the preloader has been removed.
 */
function setPreloaderStatus(text: string) {
  const el = document.getElementById("stave-preloader-status");
  if (el) el.textContent = text;
}

/**
 * Blocking screen shown after the persistent boot fails TWICE (initial attempt
 * + one automatic retry). IndexedDB is blocked by another tab, rejected in
 * private-browsing, or corrupted. The user explicitly chooses: retry the load
 * (e.g. after closing the other tab), or continue in a temporary in-memory
 * session. Nothing proceeds silently.
 */
function IdbBlockedScreen({
  onRetry,
  onContinue,
  storageFull,
}: {
  onRetry: () => Promise<boolean>;
  onContinue: () => void;
  /**
   * #1779 — the boot failed because the disk refused a write (a first run
   * creating its project on a full device). "Another tab… private mode" would
   * send the user the wrong way, so the cause gets its own sentence.
   */
  storageFull: boolean;
}) {
  const [retrying, setRetrying] = useState(false);
  const handleRetry = async () => {
    setRetrying(true);
    const ok = await onRetry();
    // On success the parent swaps to the app and unmounts this screen; only
    // reset when the retry failed and we're still mounted.
    if (!ok) setRetrying(false);
  };
  return (
    <div
      role="alertdialog"
      aria-label="Couldn't load your saved projects"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "var(--bg-app, #111)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: 24,
        textAlign: "center",
        fontFamily: 'var(--font-mono), ui-monospace, monospace',
      }}
    >
      {/* A div, not an <h1>: this is the transient BOOT SPLASH, not the document's
          heading. The shell owns the one <h1> now (StaveApp, #889). It used to be
          the only h1 in the whole product, and it disappears the second the editor
          mounts — so the loaded app had no heading at all, and the a11y spec passed
          only by racing this element's ~1s on screen. */}
      <div
        style={{
          fontSize: 32,
          fontWeight: 700,
          color: "var(--accent-strong, #6ab)",
          margin: 0,
          letterSpacing: "-0.5px",
        }}
      >
        Stave
      </div>
      <p
        style={{
          color: "var(--text-primary, #eee)",
          fontSize: 15,
          fontWeight: 600,
          margin: "12px 0 0",
        }}
      >
        Couldn&apos;t load your saved projects
      </p>
      <p
        style={{
          color: "var(--text-secondary, #aaa)",
          fontSize: 13,
          margin: "4px 0 0",
          maxWidth: 420,
          lineHeight: 1.5,
        }}
      >
        {storageFull ? (
          <span data-blocked-storage-full>
            Your browser&apos;s storage for Stave is full, so a project
            can&apos;t be saved. Free space in your browser and retry, or
            continue in a temporary session (your edits won&apos;t be saved).
          </span>
        ) : (
          <>
            Local storage isn&apos;t responding. Another tab running Stave may be
            holding it open, or your browser is in private mode. Close other Stave
            tabs and retry, or continue in a temporary session (your edits
            won&apos;t be saved).
          </>
        )}
      </p>
      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          style={{
            padding: "8px 18px",
            borderRadius: 8,
            border: "1px solid var(--accent-strong, #6ab)",
            background: "var(--accent-strong, #6ab)",
            color: "var(--bg-app, #111)",
            cursor: retrying ? "default" : "pointer",
            opacity: retrying ? 0.6 : 1,
            font: "inherit",
            fontWeight: 600,
          }}
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={retrying}
          style={{
            padding: "8px 18px",
            borderRadius: 8,
            border: "1px solid var(--border-strong, #444)",
            background: "transparent",
            color: "var(--text-primary, #eee)",
            cursor: retrying ? "default" : "pointer",
            opacity: retrying ? 0.6 : 1,
            font: "inherit",
          }}
        >
          Continue without saving
        </button>
      </div>
    </div>
  );
}

/**
 * Non-blocking, dismissible banner shown once the user has chosen to continue
 * in a temporary in-memory session (or a doc-only IDB stall degraded the boot).
 * The app works, but edits won't persist this session — the user is reminded,
 * not trapped.
 */
function DegradedPersistenceNotice() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10000,
        maxWidth: 520,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderRadius: 8,
        background: "var(--bg-elevated, #2a2a2a)",
        border: "1px solid var(--border-strong, #444)",
        color: "var(--text-primary, #eee)",
        fontFamily: 'var(--font-mono), ui-monospace, monospace',
        fontSize: 12,
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
      }}
    >
      <span style={{ lineHeight: 1.4 }}>
        ⚠ Running in a temporary session — <strong>edits won&apos;t be saved
        this session</strong>. Reload to try restoring your saved projects.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          flexShrink: 0,
          padding: "4px 10px",
          borderRadius: 6,
          border: "1px solid var(--accent-strong, #6ab)",
          background: "transparent",
          color: "var(--accent-strong, #6ab)",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        Reload
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        style={{
          flexShrink: 0,
          padding: "4px 8px",
          borderRadius: 6,
          border: "none",
          background: "transparent",
          color: "var(--text-secondary, #aaa)",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        ✕
      </button>
    </div>
  );
}

type BootPhase =
  | { kind: "loading" }
  | { kind: "blocked" }
  | { kind: "ready"; project: ProjectMeta; persisted: boolean };

/**
 * Build the stateful bootstrap orchestrator once the code-split modules have
 * loaded. The bootstrap crosses IndexedDB several times — getLastOpenedProject
 * + createProject + touchProject (the `stave-projects` registry DB) and
 * initProjectDoc (the per-project y-indexeddb DB). ANY of those raw opens can
 * hang forever when IDB is blocked by another tab, rejected in private mode, or
 * corrupted (raw `indexedDB.open` never fires success/error and has no timeout).
 * A single stalled open used to hang the preloader indefinitely — the "keeps on
 * loading" bug (#685).
 *
 * Strategy (retry-then-fallback): bound the whole IDB-dependent boot with a
 * timeout. On failure, retry ONCE automatically — the reported hang is
 * intermittent, which points at transient causes (a momentary lock, a storage
 * hiccup) that a single retry recovers from silently, with full persistence and
 * no user-visible interruption. Only a second failure surfaces a blocking
 * screen where the user explicitly retries or continues in a temporary session.
 */
function makeBootstrapOrchestrator(
  staveAppMod: typeof import("./StaveApp"),
  editor: typeof import("@stave/editor"),
  templates: typeof import("../templates"),
) {
  const { getLastOpenedProject, createProject, initProjectDoc, initProjectDocSync, touchProject, pruneEphemeralArtifacts, EPHEMERAL_ID_PREFIX } = editor;
  const { StaveApp } = staveAppMod;
  const { seedProjectFromTemplate, seedMissingPresetFiles } = templates;

  return function StaveBootstrapOrchestrator(props: Record<string, unknown>) {
    const [phase, setPhase] = useState<BootPhase>({ kind: "loading" });
    // Monotonic token that invalidates superseded boot attempts before they
    // mutate the shared active Y.Doc. A blocked open that clears late (or a
    // duplicate attempt under React StrictMode's double-invoke) must NOT swap
    // the doc out from under a newer attempt or the running app. Bumped
    // synchronously at the start of every attempt, before any await.
    const genRef = useRef(0);

    // One bounded persistent-boot attempt. Resolves { project, persisted } on
    // success, or null on timeout / failure / supersession.
    const attemptPersistentBoot = useCallback(
      async (timeoutMs: number): Promise<{ project: ProjectMeta; persisted: boolean } | null> => {
        const gen = ++genRef.current;
        const boot = (async (): Promise<{ project: ProjectMeta; persisted: boolean } | null> => {
          setPreloaderStatus("Loading your workspace…");
          let project: ProjectMeta | undefined = await getLastOpenedProject();
          if (genRef.current !== gen) return null;
          let isFirstRun = false;
          if (!project) {
            project = await createProject("Untitled");
            if (genRef.current !== gen) return null;
            isFirstRun = true;
          }
          // initProjectDoc is itself bounded and degrades to an in-memory doc on
          // IDB failure, so a doc-only stall keeps the REAL project (just no
          // persistence this session) rather than dropping to a blocked screen.
          setPreloaderStatus("Opening project…");
          const docInit = await initProjectDoc(project.id);
          if (genRef.current !== gen) return null;
          await touchProject(project.id);
          if (genRef.current !== gen) return null;
          if (isFirstRun) seedProjectFromTemplate("starter", project.id);
          // Ensure bundled viz preset files exist in EVERY session — the shell's
          // tab persistence (#175) may hydrate tabs pointing at these viz
          // fileIds, so they must be in the store before StaveApp mounts.
          // Synchronous + IDB-free, so it's safe in the ephemeral path too.
          seedMissingPresetFiles();
          setPreloaderStatus("Preparing editor…");
          return { project, persisted: docInit.persisted };
        })();
        try {
          return await Promise.race([
            boot,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("boot-idb-timeout")), timeoutMs),
            ),
          ]);
        } catch {
          return null;
        }
      },
      [],
    );

    // Start a fully in-memory ephemeral session — touches NO IndexedDB.
    const startEphemeralSession = useCallback(() => {
      genRef.current++; // supersede any pending boot attempt
      initProjectDocSync();
      const project: ProjectMeta = {
        id: `${EPHEMERAL_ID_PREFIX}${crypto.randomUUID()}`,
        name: "Untitled",
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
      };
      seedProjectFromTemplate("starter", project.id);
      seedMissingPresetFiles();
      setPhase({ kind: "ready", project, persisted: false });
    }, []);

    // Initial boot: one attempt, then ONE automatic retry (recovers the common
    // transient case silently). A second failure surfaces the blocking screen.
    useEffect(() => {
      let cancelled = false;
      (async () => {
        let result = await attemptPersistentBoot(BOOT_IDB_BUDGET_MS);
        if (!result && !cancelled) {
          setPreloaderStatus("Still loading — retrying…");
          result = await attemptPersistentBoot(RETRY_BUDGET_MS);
        }
        if (cancelled) return;
        setPhase(result ? { kind: "ready", ...result } : { kind: "blocked" });
        if (result) {
          // #688: the persistent registry is reachable, so reconcile any
          // phantom rows a prior ephemeral session left behind (IDB recovered
          // mid-session). Fire-and-forget; each store prune is IDB-bounded so
          // it can't hang the boot it runs after.
          void pruneEphemeralArtifacts().catch(() => {});
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [attemptPersistentBoot]);

    // Manual retry from the blocking screen. Returns whether it succeeded so the
    // screen can keep showing its retrying state until the app takes over.
    const handleRetry = useCallback(async (): Promise<boolean> => {
      const result = await attemptPersistentBoot(RETRY_BUDGET_MS);
      setPhase(result ? { kind: "ready", ...result } : { kind: "blocked" });
      return !!result;
    }, [attemptPersistentBoot]);

    if (phase.kind === "loading") {
      // The static preloader (layout.tsx) stays visible with its live status
      // line; nothing to render here until we know the outcome.
      return null;
    }

    if (phase.kind === "blocked") {
      return (
        <>
          <HidePreloader />
          <IdbBlockedScreen
            onRetry={handleRetry}
            onContinue={startEphemeralSession}
            storageFull={editor.getStorageStatus().fullSince !== null}
          />
        </>
      );
    }

    return (
      <>
        <HidePreloader />
        {!phase.persisted && <DegradedPersistenceNotice />}
        <StaveApp {...props} initialProject={phase.project} />
      </>
    );
  };
}

/**
 * Code-split entry point. Loads @stave/editor + StaveApp + templates, then hands
 * off to the stateful bootstrap orchestrator (retry-then-fallback for a hung
 * IndexedDB — see makeBootstrapOrchestrator).
 */
export const StrudelEditorDynamic = dynamic(
  () =>
    Promise.all([
      import("./StaveApp"),
      import("@stave/editor"),
      import("../templates"),
    ]).then(([staveAppMod, editor, templates]) => {
      // Warm the Monaco core NOW, while the preloader is still up, so it loads
      // in parallel with the IndexedDB boot instead of on first <Editor> mount
      // (which lands after the shell renders). Fire-and-forget — must never
      // block the boot or the preloader clear (#689).
      void editor.warmMonaco();
      return makeBootstrapOrchestrator(staveAppMod, editor, templates);
    }),
  {
    ssr: false,
    loading: () => null, // preloader in layout handles this
  }
);
