import type { RecentProjectEntry } from "../recentProjects";

/**
 * The app's menus as one list (#2000).
 *
 * The desktop draws them as the File / Edit / View / Help dropdowns; a phone has no
 * room for a menu bar and draws the same list inside its drawer. Both read THIS, so an
 * item added here is on both, and "every menu item is reachable on a phone" is true by
 * construction rather than by somebody remembering.
 */

export const GITHUB_REPO_URL = "https://github.com/MrityunjayBhardwaj/Stave";

/** What the menus can do, and the few facts their labels and greying depend on. */
export interface MenuActions {
  onOpenEditorSettings: () => void;
  onOpenShortcuts: () => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  /** #2020 — File → Open Recent: recently opened projects, newest first. */
  recentProjects: readonly RecentProjectEntry[];
  onOpenRecent: (projectId: string) => void;
  /** #2019 — Help → Start Screen: bring the start screen back. */
  onOpenStartScreen: () => void;
  onRenameProject: () => void;
  onExportProject: () => void;
  /** #1346 — real-time bounce of the live output to a .wav. */
  onBounceToWav: () => void;
  /**
   * #1356 — whether the active tab HAS a recordable runtime. Read when the list is
   * built, i.e. when the menu is drawn, so it reflects the tab in front of the user.
   *
   * The palette entry for the same command already gates on this via `when`.
   * Without it here the two entry points disagreed: the menu let the user open
   * the modal and choose a length before telling them it could not bounce.
   */
  canBounceToWav: () => boolean;
  onImportProject: () => void;
  onShareProject: () => void;
  /** #2301 — File → Publish to Gallery…; absent where there is nowhere to publish. */
  onPublishToGallery?: () => void;
  onVersionHistory: () => void;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
  onToggleZenMode: () => void;
  zenMode: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** #2300 — View → Community Gallery. */
  onOpenGallery: () => void;
  /**
   * #2319 — the account menu: Sign in, or the signed-in name with My Profile and
   * Sign Out. Absent until the app knows (and in tests that don't care), so the
   * menu doesn't flash "Sign in" for someone who is signed in.
   */
  account?: AccountMenu;
}

/** #2319 — what the account menu needs to know. */
export type AccountMenu =
  | { readonly state: "unavailable" }
  | {
      readonly state: "signed-out";
      /** Configured providers only, in order. */
      readonly providers: ReadonlyArray<{ readonly id: string; readonly name: string }>;
      readonly onSignIn: (providerId: string) => void;
    }
  | {
      readonly state: "signed-in";
      readonly name: string;
      readonly avatarUrl?: string;
      readonly onMyProfile: () => void;
      readonly onSignOut: () => void;
    };

/** The label of the account menu's button: the person's name, or "Sign in". */
export function accountMenuLabel(a: AccountMenu): string {
  return a.state === "signed-in" ? a.name || "Account" : "Sign in";
}

export type MenuEntry =
  | {
      readonly kind: "item";
      readonly label: string;
      /** the keyboard shortcut, or a short note in its place ("open now") */
      readonly shortcut?: string;
      readonly run: () => void;
      readonly disabled?: boolean;
    }
  | { readonly kind: "submenu"; readonly label: string; readonly items: readonly MenuEntry[] }
  | { readonly kind: "divider" };

export interface Menu {
  readonly id: "file" | "edit" | "view" | "help" | "account";
  readonly label: string;
  readonly items: readonly MenuEntry[];
}

const item = (label: string, run: () => void, more: { shortcut?: string; disabled?: boolean } = {}): MenuEntry => ({
  kind: "item",
  label,
  run,
  ...more,
});
const divider: MenuEntry = { kind: "divider" };
const nothing = (): void => undefined;

export function buildMenus(a: MenuActions): Menu[] {
  const recent: MenuEntry[] = a.recentProjects.map((p) =>
    item(p.name, () => a.onOpenRecent(p.id), { shortcut: p.current ? "open now" : undefined, disabled: p.current }),
  );
  if (a.recentProjects.every((p) => p.current)) recent.push(item("No other projects", nothing, { disabled: true }));

  return [
    {
      id: "file",
      label: "File",
      items: [
        item("New Project...", a.onNewProject, { shortcut: "⌘N" }),
        item("Open Project...", a.onOpenProject, { shortcut: "⌘O" }),
        { kind: "submenu", label: "Open Recent", items: recent },
        divider,
        item("Rename Project...", a.onRenameProject),
        item("Version History...", a.onVersionHistory),
        divider,
        item("Open Project File...", a.onImportProject),
        item("Export as .stave", a.onExportProject),
        item("Bounce to WAV...", a.onBounceToWav, { disabled: !a.canBounceToWav() }),
        divider,
        // #2312 — private and public sharing side by side, named so they can't be mistaken.
        {
          kind: "submenu",
          label: "Share",
          items: [
            item("Copy Private Link", a.onShareProject),
            ...(a.onPublishToGallery ? [item("Publish to Gallery...", a.onPublishToGallery)] : []),
          ],
        },
        divider,
        item("Editor Settings...", a.onOpenEditorSettings),
        item("Keyboard Shortcuts...", a.onOpenShortcuts),
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        item("Undo", a.onUndo, { shortcut: "⌘Z", disabled: !a.canUndo }),
        item("Redo", a.onRedo, { shortcut: "⌘⇧Z", disabled: !a.canRedo }),
        divider,
        item("Find...", nothing, { shortcut: "⌘F", disabled: true }),
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        item(a.sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar", a.onToggleSidebar, { shortcut: "⌘B" }),
        item(a.zenMode ? "Exit Zen Mode" : "Zen Mode (Fullscreen)", a.onToggleZenMode, { shortcut: "⌘⌥Z" }),
        divider,
        item("Community Gallery...", a.onOpenGallery),
      ],
    },
    {
      id: "help",
      label: "Help",
      items: [
        item("Start Screen", a.onOpenStartScreen),
        divider,
        item("Documentation", () => window.open("/docs/", "_blank", "noopener,noreferrer")),
        item("GitHub Repository", () => window.open(GITHUB_REPO_URL, "_blank", "noopener,noreferrer")),
      ],
    },
    ...(a.account ? [accountMenu(a.account)] : []),
  ];
}

/** #2319 — the account menu, last: the desktop draws it at the bar's right end. */
function accountMenu(a: AccountMenu): Menu {
  const items: MenuEntry[] =
    a.state === "signed-in"
      ? [item("My Profile", a.onMyProfile), item("Sign Out", a.onSignOut)]
      : a.state === "signed-out"
        ? a.providers.map((p) => item(`Sign in with ${p.name}`, () => a.onSignIn(p.id)))
        : [item("Sign-in isn't set up on this site", nothing, { disabled: true })];
  return { id: "account", label: accountMenuLabel(a), items };
}

/** Every item a menu holds, submenus opened out — what a test or a flat list walks. */
export function flatItems(menus: readonly Menu[]): Array<Extract<MenuEntry, { kind: "item" }>> {
  const out: Array<Extract<MenuEntry, { kind: "item" }>> = [];
  const walk = (entries: readonly MenuEntry[]): void => {
    for (const e of entries) {
      if (e.kind === "item") out.push(e);
      else if (e.kind === "submenu") walk(e.items);
    }
  };
  for (const m of menus) walk(m.items);
  return out;
}
