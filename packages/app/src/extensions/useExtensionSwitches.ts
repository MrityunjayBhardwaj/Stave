"use client";

/**
 * #2511 — the person's extension switches, live. The list row and the extension's page
 * both read this one store (`enablement` in the editor package), so switching from either
 * shows in both at once.
 */
import { useMemo, useSyncExternalStore } from "react";
import { enabledExtensionIds, onExtensionsEnabledChange } from "@stave/editor";

// The store hands back a fresh Set on each read; React needs a value that is equal while
// nothing changed, so the snapshot is the sorted ids as one string.
const snapshot = (): string => [...enabledExtensionIds()].sort().join("\n");
const serverSnapshot = (): string => "";

/** The ids switched on now. */
export function useEnabledExtensions(): ReadonlySet<string> {
  const ids = useSyncExternalStore(onExtensionsEnabledChange, snapshot, serverSnapshot);
  return useMemo(() => new Set(ids ? ids.split("\n") : []), [ids]);
}
