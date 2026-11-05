"use client";

/**
 * #2344 — viz files (`.hydra`, `.p5`, `.glsl`) run their code when they are
 * shown: the preview tab their ▶ Play opens, and a backdrop. Both are drawn by
 * the app's `previewProviderFor` (StrudelEditorClient), so this wraps the
 * provider it returns. For a gallery file nobody has agreed to run, the
 * wrapper does not call the real `render` (which mounts and compiles the code)
 * until the trust question (#2328's wording and memory, via runGate.ts) has
 * been answered yes. Cancel leaves a note in place of the visual, with a
 * button to be asked again.
 */

import { useEffect, useState, type ReactNode } from "react";
import type { PreviewContext, PreviewProvider } from "@stave/editor";

type PreviewEditorChromeContext = Parameters<NonNullable<PreviewProvider["renderEditorChrome"]>>[0];
import { askBeforeRunning, mayEvaluate, type AskToRun } from "./runGate";

type Phase = "ok" | "asking" | "declined";

/**
 * Files whose question was answered Cancel in this page. A preview remounts its
 * content (a reload, a pane move); without this every remount would ask again
 * straight after Cancel. The file's own viz controls (▶ Play / ⏸, placement)
 * and the "Run it…" button clear it, and a waiting gate then asks again.
 */
const declined = new Set<string>();
const rearmListeners = new Set<(key: string) => void>();
const keyOf = (projectId: string, fileId: string) => `${projectId}/${fileId}`;

function rearm(key: string): void {
  declined.delete(key);
  for (const cb of [...rearmListeners]) cb(key);
}

/** Test seam. */
export function resetDeclinedPreviewsForTest(): void {
  declined.clear();
}

export function GalleryRunGate({
  projectId,
  fileId,
  ask,
  children,
}: {
  projectId: string;
  fileId: string;
  ask: AskToRun;
  /** Called only once the file may run. */
  children: () => ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>(() =>
    mayEvaluate(projectId, fileId) ? "ok" : declined.has(keyOf(projectId, fileId)) ? "declined" : "asking",
  );
  useEffect(() => {
    if (phase !== "asking") return;
    let live = true;
    void askBeforeRunning(projectId, fileId, ask).then((ok) => {
      // A second ask while one is open answers false; the first one's yes still counts.
      if (!live) return;
      const runs = ok || mayEvaluate(projectId, fileId);
      if (!runs) declined.add(keyOf(projectId, fileId));
      setPhase(runs ? "ok" : "declined");
    });
    return () => {
      live = false;
    };
  }, [phase, projectId, fileId, ask]);

  // After Cancel, a press on this file's viz controls asks again.
  useEffect(() => {
    if (phase !== "declined") return;
    const mine = keyOf(projectId, fileId);
    const cb = (key: string) => {
      if (key === mine) setPhase("asking");
    };
    rearmListeners.add(cb);
    return () => {
      rearmListeners.delete(cb);
    };
  }, [phase, projectId, fileId]);

  if (phase === "ok") return <>{children()}</>;
  return (
    <div
      data-gallery-run-gate={phase}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        height: "100%",
        padding: 16,
        fontSize: 12,
        opacity: 0.8,
        textAlign: "center",
      }}
    >
      {phase === "asking" ? (
        <span>Waiting for your answer before running this code…</span>
      ) : (
        <>
          <span>This code came from the gallery and hasn&apos;t been run.</span>
          <button
            type="button"
            onClick={() => rearm(keyOf(projectId, fileId))}
          >
            Run it…
          </button>
        </>
      )}
    </div>
  );
}

const wrapped = new WeakMap<PreviewProvider, PreviewProvider>();

/**
 * The same provider, with `render` behind the gate for files that may not run
 * yet. Cached per provider so its identity is stable across renders.
 */
export function gatePreviewProvider(
  provider: PreviewProvider,
  projectId: () => string,
  ask: AskToRun,
): PreviewProvider {
  const hit = wrapped.get(provider);
  if (hit) return hit;
  const chrome = provider.renderEditorChrome?.bind(provider);
  const gated: PreviewProvider = Object.assign(Object.create(provider) as PreviewProvider, {
    // The file's own viz controls are the person asking for it to run: after a
    // Cancel, any of them re-arms the question (the visual itself may sit behind
    // the code as a backdrop, where its "Run it…" button can't be reached).
    ...(chrome
      ? {
          renderEditorChrome: (ctx: PreviewEditorChromeContext): ReactNode => {
            const key = keyOf(projectId(), ctx.file.id);
            const wrapped = Object.fromEntries(
              Object.entries(ctx).map(([k, v]) => [
                k,
                typeof v === "function"
                  ? (...args: unknown[]) => {
                      if (declined.has(key)) rearm(key);
                      return (v as (...a: unknown[]) => unknown)(...args);
                    }
                  : v,
              ]),
            ) as unknown as PreviewEditorChromeContext;
            return chrome(wrapped);
          },
        }
      : {}),
    render: (ctx: PreviewContext): ReactNode => {
      const p = projectId();
      if (mayEvaluate(p, ctx.file.id)) return provider.render(ctx);
      return (
        <GalleryRunGate key={`${p}/${ctx.file.id}`} projectId={p} fileId={ctx.file.id} ask={ask}>
          {() => provider.render(ctx)}
        </GalleryRunGate>
      );
    },
  });
  wrapped.set(provider, gated);
  return gated;
}
