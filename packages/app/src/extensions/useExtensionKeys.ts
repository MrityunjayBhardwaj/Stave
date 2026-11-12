"use client";

/**
 * #2545 — the keys extensions take, live, for Keyboard Shortcuts and an extension's page.
 *
 * Two things change what they show: which extensions are on in this page (the runtime's
 * change event) and which keys the person has handed back (`onExtensionKeysChange`). Both
 * places redraw on either, with no reload, so a key handed back in one shows in the other.
 */
import { createContext, useContext, useEffect, useState } from "react";
import {
  activeExtensionManifests,
  extensionKeysInCode,
  onExtensionKeysChange,
  onPageExtensionsChange,
  type ExtensionKeyInCode,
  type ExtensionManifest,
} from "@stave/editor";

/** Where the switched-on extensions and their taken keys are read from: the page's runtime, or a stand-in in tests. */
export interface ExtensionKeysSource {
  subscribe: (fn: () => void) => () => void;
  /** the extensions on in this page now */
  active: () => readonly ExtensionManifest[];
  /** the keys they take in the code now (declared, not handed back) */
  taken: () => readonly ExtensionKeyInCode[];
}

const PAGE: ExtensionKeysSource = {
  subscribe: (fn) => {
    const a = onPageExtensionsChange(fn);
    const b = onExtensionKeysChange(fn);
    return () => {
      a();
      b();
    };
  },
  active: () => activeExtensionManifests(),
  taken: () => extensionKeysInCode(),
};

/** The page's runtime by default; a test puts a stand-in here. */
export const ExtensionKeysContext = createContext<ExtensionKeysSource>(PAGE);

/**
 * A number that changes whenever the extensions on, or the keys handed back, change.
 * Read the source (`useExtensionKeysSource`) in the same render to see the new state.
 */
export function useExtensionKeysVersion(): number {
  const source = useContext(ExtensionKeysContext);
  const [version, setVersion] = useState(0);
  useEffect(() => source.subscribe(() => setVersion((v) => v + 1)), [source]);
  return version;
}

export function useExtensionKeysSource(): ExtensionKeysSource {
  return useContext(ExtensionKeysContext);
}

/** Hear only the "handed back" setting (the extension's page needs no more: its keys come from its manifest). */
export function useGivenBackVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => onExtensionKeysChange(() => setVersion((v) => v + 1)), []);
  return version;
}
