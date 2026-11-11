"use client";

/**
 * #2511 — the pieces the Extensions list and an extension's page share: the tile, the
 * badges and the Switch on / Switch off button. Both draw the same switch from the same
 * store, so they cannot disagree.
 */
import React from "react";
import { setExtensionEnabled, type ExtensionManifest } from "@stave/editor";

const DEFAULT_TINT = "linear-gradient(135deg, var(--accent), var(--accent-strong))";

/** The square with the extension's glyph. */
export function ExtensionTile({ manifest, size }: { manifest: ExtensionManifest; size: number }) {
  const glyph = manifest.about?.icon ?? manifest.name.slice(0, 1).toUpperCase();
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: Math.round(size / 5.5),
        background: manifest.about?.tint ?? DEFAULT_TINT,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size / 2),
        fontWeight: 600,
      }}
    >
      {glyph}
    </div>
  );
}

/** "experimental" and "on", as the row and the page show them. */
export function ExtensionBadges({ experimental, on }: { experimental: boolean; on: boolean }) {
  return (
    <>
      {experimental && (
        <span style={{ ...badge, ...badgeExperimental }} data-extension-badge="experimental">
          experimental
        </span>
      )}
      {on && (
        <span style={{ ...badge, ...badgeOn }} data-extension-badge="on">
          on
        </span>
      )}
    </>
  );
}

/** Switch on / Switch off. Takes effect at once: the page runtime follows the store. */
export function SwitchButton({
  id,
  name,
  on,
  large,
  where,
}: {
  id: string;
  name: string;
  on: boolean;
  large?: boolean;
  /** which surface draws it, for tests: the list row or the page */
  where: "row" | "page";
}) {
  return (
    <button
      type="button"
      data-extension-switch={id}
      data-extension-switch-in={where}
      data-on={on ? "true" : "false"}
      aria-label={`${on ? "Switch off" : "Switch on"} ${name}`}
      style={{ ...switchBase, ...(large ? switchLarge : null), ...(on ? switchOff : switchOn) }}
      onClick={(e) => {
        // A row opens its page when clicked; the switch inside it only switches.
        e.stopPropagation();
        setExtensionEnabled(id, !on);
      }}
    >
      {on ? "Switch off" : "Switch on"}
    </button>
  );
}

const badge: React.CSSProperties = {
  fontFamily: "var(--font-mono), ui-monospace, monospace",
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: 0.5,
  textTransform: "uppercase",
  borderRadius: 3,
  padding: "1px 5px",
  borderWidth: 1,
  borderStyle: "solid",
  lineHeight: 1.4,
  whiteSpace: "nowrap",
};
const badgeExperimental: React.CSSProperties = { color: "var(--highlight-fg)", borderColor: "var(--highlight-fg)" };
const badgeOn: React.CSSProperties = { color: "var(--success-fg)", borderColor: "var(--success-fg)" };

const switchBase: React.CSSProperties = {
  whiteSpace: "nowrap",
  borderRadius: 3,
  padding: "3px 10px",
  fontSize: 11.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  borderWidth: 1,
  borderStyle: "solid",
};
const switchLarge: React.CSSProperties = { padding: "6px 16px", fontSize: 12.5 };
const switchOn: React.CSSProperties = { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" };
const switchOff: React.CSSProperties = {
  background: "transparent",
  borderColor: "var(--border-strong)",
  color: "var(--text-secondary)",
};
