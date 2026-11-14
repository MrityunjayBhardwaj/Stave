"use client";

/**
 * #2556 — redraw when extension settings change: in Settings, on an extension's page, or
 * in another tab (the store's own `storage` listener). Read the store in the same render.
 */
import { useEffect, useState } from "react";
import { onExtensionSettingsChange } from "@stave/editor";

/** A number that changes whenever any extension setting changes. */
export function useExtensionSettingsVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => onExtensionSettingsChange(() => setVersion((v) => v + 1)), []);
  return version;
}
