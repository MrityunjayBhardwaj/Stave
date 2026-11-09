/**
 * #2314 — an author's bio, rendered like a GitHub profile README.
 *
 * The bio is written by anyone who publishes, and shown to everyone who opens the
 * profile, so it must never run code on Stave's page. Two layers:
 *
 * 1. micromark with its safe defaults: `allowDangerousHtml` and
 *    `allowDangerousProtocol` stay OFF, so raw HTML (`<script>`, `<img onerror>`,
 *    `<iframe>`, a hand-written `<a href="javascript:…">`) comes out as escaped
 *    text, and a markdown link or image to a dangerous protocol gets an empty URL.
 * 2. A DOM pass over that output, inside an inert `<template>` (nothing in it
 *    loads or runs): links keep only http(s) / mailto targets and open in a new tab
 *    with `rel="noopener noreferrer nofollow"`; images keep only the sources
 *    `allowedImageSrc` accepts and are sent with no referrer. Attributes are set
 *    through the DOM, never by splicing strings into HTML.
 *
 * #2366 — a bio's image is requested by every viewer's browser, so whoever runs its
 * host sees who opened the profile and when. Images therefore load only from GitHub's
 * image hosts and Stave's own origin; anything else shows its alt text. This pass
 * runs before an image reaches a live document, so a refused one is never fetched.
 */
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";

const SAFE_LINK = /^(https?:|mailto:)/i;

/**
 * Where a bio's image may load from, over HTTPS, by exact hostname. A bio's author
 * can choose the file on these hosts but can't read who fetched it.
 *
 * - avatars: any account's avatar.
 * - user-images: older images uploaded to GitHub issues and READMEs.
 * - raw: a file in a public repo, the usual way to show one in a profile README.
 *   The repo's owner can change the picture at any time. A file stored with Git LFS
 *   may count towards the owner's LFS bandwidth, a total with no viewer in it.
 *
 * Left out on purpose:
 * - private-user-images: its links are signed and stop working after five minutes.
 * - camo: GitHub's image proxy, which fetches from any site its link names.
 * - the rest of github.com: release downloads keep a public per-file count, which
 *   would let an author count the views of a profile (see GITHUB_ATTACHMENTS).
 */
const IMAGE_HOSTS: ReadonlySet<string> = new Set([
  "avatars.githubusercontent.com",
  "user-images.githubusercontent.com",
  "raw.githubusercontent.com",
]);

/**
 * Images uploaded to GitHub today. github.com answers with a redirect to GitHub's
 * own storage, so only this path on that host is allowed.
 */
const GITHUB_ATTACHMENTS = "/user-attachments/assets/";

/** Characters a URL parser drops or treats as a slash. A real image address has no need of them. */
const URL_TRICKS = /[\\\u0000-\u0020\u007f]/;

/**
 * The address to load a bio image from, or null if it isn't allowed. The answer comes
 * from the parsed URL, the way the browser will read it, never from the string's
 * shape; and it's returned normalised, so the browser fetches what was checked.
 */
export function allowedImageSrc(src: string, pageUrl: string): string | null {
  if (!src || URL_TRICKS.test(src)) return null;
  let url: URL;
  let page: URL;
  try {
    url = new URL(src, pageUrl);
    page = new URL(pageUrl);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  // Stave's own, however it's written. The scheme test keeps out blob:, whose origin is the page's.
  if ((url.protocol === "https:" || url.protocol === "http:") && url.origin === page.origin) return url.href;
  if (url.protocol !== "https:" || url.port) return null;
  const allowed =
    IMAGE_HOSTS.has(url.hostname) || (url.hostname === "github.com" && url.pathname.startsWith(GITHUB_ATTACHMENTS));
  return allowed ? url.href : null;
}

/** Markdown → micromark's escaped HTML, before the link / image pass. Exported for the tests. */
export function markdownToEscapedHtml(markdown: string): string {
  return micromark(markdown, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });
}

/** Footnote and heading anchors stay in the page; everything else must be http(s) or mailto. */
function isSafeLink(href: string): boolean {
  return SAFE_LINK.test(href.trim()) || /^#[\w-]*$/.test(href);
}

/** The bio as HTML that is safe to put into the page. */
export function renderMarkdown(markdown: string): string {
  // No DOM means no way to filter it, and micromark's output still has every image.
  if (typeof document === "undefined") return "";
  const html = markdownToEscapedHtml(markdown);
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const root = tpl.content;

  root.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    if (!isSafeLink(href)) {
      a.removeAttribute("href");
      return;
    }
    if (href.startsWith("#")) return;
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer nofollow");
  });

  root.querySelectorAll("img").forEach((img) => {
    const src = allowedImageSrc(img.getAttribute("src") ?? "", window.location.href);
    if (src === null) {
      // Keep the alt text so the reader still sees what was meant.
      img.replaceWith(document.createTextNode(img.getAttribute("alt") ?? ""));
      return;
    }
    img.setAttribute("src", src);
    img.setAttribute("loading", "lazy");
    img.setAttribute("referrerpolicy", "no-referrer");
  });

  const out = document.createElement("div");
  out.appendChild(root.cloneNode(true));
  return out.innerHTML;
}

/** README-style looks for rendered markdown, scoped under `.sg-md`. */
export const MARKDOWN_CSS = `
.sg-md { font-size: 14px; line-height: 1.6; color: var(--text-primary); word-wrap: break-word; overflow-wrap: anywhere; }
.sg-md > :first-child { margin-top: 0; }
.sg-md > :last-child { margin-bottom: 0; }
.sg-md h1, .sg-md h2, .sg-md h3, .sg-md h4, .sg-md h5, .sg-md h6 { margin: 20px 0 10px; font-weight: 600; line-height: 1.25; }
.sg-md h1 { font-size: 1.75em; padding-bottom: .3em; border-bottom: 1px solid var(--border-subtle); }
.sg-md h2 { font-size: 1.4em; padding-bottom: .3em; border-bottom: 1px solid var(--border-subtle); }
.sg-md h3 { font-size: 1.2em; }
.sg-md h4 { font-size: 1em; }
.sg-md h5, .sg-md h6 { font-size: .9em; opacity: .85; }
.sg-md p, .sg-md ul, .sg-md ol, .sg-md blockquote, .sg-md pre, .sg-md table { margin: 0 0 14px; }
.sg-md ul, .sg-md ol { padding-left: 2em; }
.sg-md ul { list-style: disc; }
.sg-md ol { list-style: decimal; }
.sg-md ul ul { list-style: circle; }
.sg-md li:has(> input[type="checkbox"]) { list-style: none; }
.sg-md li + li { margin-top: .25em; }
.sg-md li > input[type="checkbox"] { margin: 0 .4em 0 -1.3em; vertical-align: middle; }
.sg-md a { color: var(--accent, #58a6ff); text-decoration: none; }
.sg-md a:hover { text-decoration: underline; }
.sg-md a:not([href]) { color: inherit; text-decoration: line-through; opacity: .7; }
.sg-md code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 85%; padding: .2em .4em; border-radius: 5px; background: var(--bg-hover, rgba(255,255,255,.08)); }
.sg-md pre { padding: 12px 14px; overflow: auto; border-radius: 6px; background: var(--bg-editor, rgba(0,0,0,.25)); border: 1px solid var(--border-subtle); line-height: 1.45; }
.sg-md pre code { padding: 0; background: none; font-size: 12.5px; white-space: pre; }
.sg-md blockquote { padding: 0 1em; border-left: 4px solid var(--border-strong); opacity: .85; }
.sg-md table { display: block; width: max-content; max-width: 100%; overflow: auto; border-collapse: collapse; }
.sg-md th, .sg-md td { padding: 6px 13px; border: 1px solid var(--border-strong); }
.sg-md th { font-weight: 600; }
.sg-md tr:nth-child(2n) td { background: var(--bg-hover, rgba(255,255,255,.04)); }
.sg-md img { max-width: 100%; height: auto; border-radius: 4px; }
.sg-md hr { height: 2px; border: 0; background: var(--border-subtle); margin: 20px 0; }
.sg-md del { opacity: .75; }
`;
