"use client";

import React from "react";
import { SettingsShell, type ShellTabDef } from "./SettingsShell";
import { SettingsPanel } from "./SettingsPanel";
import { KeyboardShortcutsPanel } from "./KeyboardShortcutsPanel";
import { IconSettings, IconKeyboard } from "./icons";

export type SettingsTab = "settings" | "keys";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** Which surface to show — both File-menu items open the same window. */
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  /** #2556 — the search to open with (an extension's page asks for `@ext:<id>`); empty when left out */
  initialQuery?: string;
}

/**
 * Top-level unified settings window (#739). Replaces the two separate
 * modals (EditorSettingsModal + ShortcutsOverlay) with one shell hosting
 * two tabbed surfaces. Both File-menu entries open this on the right tab.
 */
export function SettingsModal({ open, onClose, tab, onTabChange, initialQuery }: SettingsModalProps) {
  const tabs: ShellTabDef[] = [
    {
      id: "settings",
      label: "Settings",
      icon: <IconSettings />,
      searchPlaceholder: "Search settings",
      render: (query) => <SettingsPanel query={query} />,
    },
    {
      id: "keys",
      label: "Keyboard Shortcuts",
      icon: <IconKeyboard />,
      searchPlaceholder: "Search keybindings",
      render: (query) => <KeyboardShortcutsPanel query={query} />,
    },
  ];

  return (
    <SettingsShell
      open={open}
      onClose={onClose}
      activeTab={tab}
      onTabChange={(id) => onTabChange(id as SettingsTab)}
      tabs={tabs}
      initialQuery={initialQuery}
    />
  );
}
