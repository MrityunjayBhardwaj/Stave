/**
 * The start screen (#2019): when it shows, and how its rows read.
 *
 * It greets a person arriving at Stave, once per start. It never appears in the
 * middle of a session, and three things keep it away at start:
 *
 *   - the person said not to show it (remembered on this device);
 *   - they arrived by a share link — that link has its own question to ask;
 *   - the browser is being driven by a program. An automated browser is not
 *     arriving anywhere, and a screen laid over the editor would swallow the
 *     clicks every script and browser test aims at it. A script that wants the
 *     screen says so (`__STAVE_START_SCREEN__`), which is how the screen itself
 *     gets tested.
 */

export const START_SCREEN_PREF_KEY = "stave:startScreen.show";

/** how many projects the start screen lists, the open one included */
export const START_SCREEN_RECENT_LIMIT = 5;

/** Has the person left "show this when Stave starts" on? Defaults to yes. */
export function startScreenWanted(): boolean {
  try {
    return window.localStorage.getItem(START_SCREEN_PREF_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setStartScreenWanted(wanted: boolean): void {
  try {
    window.localStorage.setItem(START_SCREEN_PREF_KEY, wanted ? "true" : "false");
  } catch {
    /* a browser that will not store the choice simply asks again next time */
  }
}

export interface StartConditions {
  /** the person's remembered choice */
  readonly wanted: boolean;
  /** the page was opened from a share link */
  readonly shareLink: boolean;
  /** the browser is being driven by a program */
  readonly automated: boolean;
  /** an automated browser asked for the screen */
  readonly requested: boolean;
}

export function showsStartScreen(c: StartConditions): boolean {
  if (c.shareLink) return false;
  if (c.automated) return c.requested;
  return c.wanted;
}

/** The conditions as this browser has them right now. */
export function readStartConditions(shareLink: boolean): StartConditions {
  // rendered with no browser at all: nobody has arrived
  if (typeof window === "undefined") return { wanted: false, shareLink, automated: false, requested: false };
  const w = window as unknown as { __STAVE_START_SCREEN__?: boolean };
  return {
    wanted: startScreenWanted(),
    shareLink,
    automated: typeof navigator !== "undefined" && navigator.webdriver === true,
    requested: w.__STAVE_START_SCREEN__ === true,
  };
}

/** The intro film shown at the top of the start screen. */
export const INTRO_VIDEO = {
  id: "LoVfu-FCTAg",
  title: "Introducing Stave",
  /** its opening frame, shipped with the app so nothing is fetched from YouTube until Play is pressed */
  poster: "/start/introducing-stave.jpg",
} as const;

export const introWatchUrl = `https://www.youtube.com/watch?v=${INTRO_VIDEO.id}`;
/** the player without YouTube's tracking cookies, starting at once since Play was just pressed */
export const introEmbedUrl = `https://www.youtube-nocookie.com/embed/${INTRO_VIDEO.id}?autoplay=1&rel=0`;

/**
 * Can the intro play inside the start screen, or must it open on YouTube?
 *
 * Stave isolates its page from other origins (it needs that for shared memory
 * between the editor and its visuals). An isolated page may only frame another
 * site's page if that page agrees, which YouTube's player does not — or if the
 * browser can load the frame without credentials, which only some browsers can.
 * Where neither holds, a frame would be a blank box, so the film opens in a new
 * tab instead. A page that is not isolated can frame anything.
 */
export function introPlaysInline(browser: { isolated: boolean; credentiallessFrames: boolean }): boolean {
  return !browser.isolated || browser.credentiallessFrames;
}

export function readIntroBrowser(): { isolated: boolean; credentiallessFrames: boolean } {
  if (typeof window === "undefined") return { isolated: false, credentiallessFrames: false };
  return {
    isolated: window.crossOriginIsolated === true,
    credentiallessFrames:
      typeof HTMLIFrameElement !== "undefined" && "credentialless" in HTMLIFrameElement.prototype,
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "opened 3 hours ago" — how long since a project was last opened, in words.
 * Past a month it gives the date, which is easier to place than "47 days ago".
 */
export function openedAgo(lastOpenedAt: number, now: number): string {
  const elapsed = Math.max(0, now - lastOpenedAt);
  if (elapsed < MINUTE) return "opened just now";
  if (elapsed < HOUR) {
    const n = Math.floor(elapsed / MINUTE);
    return `opened ${n} minute${n === 1 ? "" : "s"} ago`;
  }
  if (elapsed < DAY) {
    const n = Math.floor(elapsed / HOUR);
    return `opened ${n} hour${n === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(elapsed / DAY);
  if (days === 1) return "opened yesterday";
  if (days < 31) return `opened ${days} days ago`;
  return `opened ${new Date(lastOpenedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
}
