// @vitest-environment jsdom
/**
 * #2314 — a bio is written by anyone and shown to everyone, so the rendered HTML
 * must be inert. Each case is checked on the parsed DOM (what the page would hold),
 * not on string shapes alone.
 */
import { describe, expect, it } from "vitest";
import { markdownToEscapedHtml, renderMarkdown } from "../markdown";

function dom(markdown: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = renderMarkdown(markdown);
  return div;
}

/** Every attribute name in the tree that starts with `on` (an event handler). */
function handlerAttrs(root: HTMLElement): string[] {
  const out: string[] = [];
  root.querySelectorAll("*").forEach((el) => {
    for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name)) out.push(`${el.tagName}.${a.name}`);
  });
  return out;
}

describe("the bio renderer keeps everything inert", () => {
  it("a <script> is shown as text, never an element", () => {
    const root = dom("hello\n\n<script>window.__pwned = 1</script>");
    expect(root.querySelector("script")).toBeNull();
    expect(root.textContent).toContain("<script>window.__pwned = 1</script>");
  });

  it("an <img onerror> is shown as text: no image, no handler", () => {
    const root = dom('<img src=x onerror="window.__pwned = 1">');
    expect(root.querySelector("img")).toBeNull();
    expect(handlerAttrs(root)).toEqual([]);
    expect(root.textContent).toContain("onerror");
  });

  it("a markdown link to javascript: keeps its text and loses its target", () => {
    const root = dom("[click me](javascript:alert(1))");
    const a = root.querySelector("a")!;
    expect(a.textContent).toBe("click me");
    expect(a.hasAttribute("href")).toBe(false);
    expect(root.innerHTML).not.toMatch(/javascript:/i);
  });

  it("an <iframe> is shown as text", () => {
    const root = dom('<iframe src="https://example.com"></iframe>');
    expect(root.querySelector("iframe")).toBeNull();
    expect(root.textContent).toContain("<iframe");
  });

  it('a raw <a href="javascript:…"> is shown as text, not a link', () => {
    const root = dom('<a href="javascript:alert(1)">x</a>');
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toContain('<a href="javascript:alert(1)">x</a>');
  });

  it("other odd protocols (irc, data, vbscript) lose their target too; images need http(s)", () => {
    const root = dom("[a](irc://x) [b](data:text/html,hi) [c](vbscript:x)\n\n![pic](data:image/png;base64,AAAA)");
    root.querySelectorAll("a").forEach((a) => expect(a.hasAttribute("href"), a.outerHTML).toBe(false));
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("pic");
  });
});

describe("the bio renderer still renders a README", () => {
  it("headings, lists, code, tables, quotes, images and links", () => {
    const root = dom(
      [
        "# Ada",
        "## Things I make",
        "- dub techno",
        "- [x] done task",
        "",
        "```js",
        's("bd sd")',
        "```",
        "",
        "| a | b |",
        "|---|---|",
        "| 1 | 2 |",
        "",
        "> a quote",
        "",
        "![me](https://example.com/me.png) [site](https://example.com) <mailto:ada@example.com> https://auto.link",
      ].join("\n"),
    );
    expect(root.querySelector("h1")!.textContent).toBe("Ada");
    expect(root.querySelector("h2")).toBeTruthy();
    expect(root.querySelectorAll("li").length).toBe(2);
    expect(root.querySelector("pre code")!.textContent).toContain('s("bd sd")');
    expect(root.querySelector("table td")!.textContent).toBe("1");
    expect(root.querySelector("blockquote")).toBeTruthy();
    const img = root.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://example.com/me.png");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    const links = Array.from(root.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://example.com",
      "mailto:ada@example.com",
      "https://auto.link",
    ]);
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    }
  });

  it("the first layer alone already escapes raw HTML (the micromark defaults are on)", () => {
    expect(markdownToEscapedHtml("<script>x</script>")).toBe("&lt;script&gt;x&lt;/script&gt;");
  });
});
