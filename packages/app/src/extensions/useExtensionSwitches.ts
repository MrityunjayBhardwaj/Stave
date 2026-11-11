"use client";

/**
 * #2511 — the person's extension switches, live. The list row and the extension's page
 * both read this one store (`enablement` in the editor package), so switching from either
 * shows in both at once.
 */
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { enabledExtensionIds, extensionFailure, onExtensionsEnabledChange, onPageExtensionsChange } from "@stave/editor";

// The store hands back a fresh Set on each read; React needs a value that is equal while
// nothing changed, so the snapshot is the sorted ids as one string.
const snapshot = (): string => [...enabledExtensionIds()].sort().join("\n");
const serverSnapshot = (): string => "";

/** The ids switched on now. */
export function useEnabledExtensions(): ReadonlySet<string> {
  const ids = useSyncExternalStore(onExtensionsEnabledChange, snapshot, serverSnapshot);
  return useMemo(() => new Set(ids ? ids.split("\n") : []), [ids]);
}

/** Where a failure is read from: the page's runtime, or a stand-in in tests. */
export interface FailureSource {
  subscribe: (fn: () => void) => () => void;
  read: (id: string) => string | undefined;
}

const PAGE_FAILURES: FailureSource = { subscribe: onPageExtensionsChange, read: extensionFailure };

/** The page's runtime by default; a test puts a stand-in here to show a failure. */
export const ExtensionFailureSource = createContext<FailureSource>(PAGE_FAILURES);

/**
 * #2552 — why switching this extension on failed in this page, or `undefined`. Redraws
 * when the runtime's latest pass changes it.
 */
export function useExtensionFailure(id: string): string | undefined {
  const source = useContext(ExtensionFailureSource);
  return useSyncExternalStore(
    source.subscribe,
    () => source.read(id),
    () => undefined,
  );
}
