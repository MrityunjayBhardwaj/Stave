// @vitest-environment jsdom
/**
 * #2314 — a bio is written by anyone and shown to everyone, so the rendered HTML
 * must be inert. Each case is checked on the parsed DOM (what the page would hold),
 * not on string shapes alone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedImageSrc, markdownToEscapedHtml, renderMarkdown } from "../markdown";

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
        "![me](https://avatars.githubusercontent.com/u/1?v=4) [site](https://example.com) <mailto:ada@example.com> https://auto.link",
      ].join("\n"),
    );
    expect(root.querySelector("h1")!.textContent).toBe("Ada");
    expect(root.querySelector("h2")).toBeTruthy();
    expect(root.querySelectorAll("li").length).toBe(2);
    expect(root.querySelector("pre code")!.textContent).toContain('s("bd sd")');
    expect(root.querySelector("table td")!.textContent).toBe("1");
    expect(root.querySelector("blockquote")).toBeTruthy();
    const img = root.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://avatars.githubusercontent.com/u/1?v=4");
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

describe("#2366 a bio's images load only from GitHub's image hosts and Stave's own", () => {
  const PAGE = "https://stave.live/some/page?x=1";

  const ALLOWED: Array<[name: string, src: string, loads: string]> = [
    ["an avatar", "https://avatars.githubusercontent.com/u/1?v=4", "https://avatars.githubusercontent.com/u/1?v=4"],
    ["an older upload", "https://user-images.githubusercontent.com/1/a.png", "https://user-images.githubusercontent.com/1/a.png"],
    ["a file in a repo", "https://raw.githubusercontent.com/a/b/main/c.svg", "https://raw.githubusercontent.com/a/b/main/c.svg"],
    ["an upload", "https://github.com/user-attachments/assets/25addea2", "https://github.com/user-attachments/assets/25addea2"],
    ["an uppercase host, normalised", "HTTPS://AVATARS.GITHUBUSERCONTENT.COM/u/1", "https://avatars.githubusercontent.com/u/1"],
    ["Stave's own, absolute", "https://stave.live/api/gallery/a/thumbnail", "https://stave.live/api/gallery/a/thumbnail"],
    ["Stave's own, from the root", "/api/gallery/a/thumbnail", "https://stave.live/api/gallery/a/thumbnail"],
    ["Stave's own, relative", "pic.png", "https://stave.live/some/pic.png"],
  ];
  it.each(ALLOWED)("loads %s", (_name, src, loads) => {
    expect(allowedImageSrc(src, PAGE)).toBe(loads);
  });

  const REFUSED: Array<[name: string, src: string]> = [
    ["any other host", "https://evil.example/x.png"],
    ["the allowed name as a username", "https://github.com@evil.example/x.png"],
    ["an avatar host as a username", "https://avatars.githubusercontent.com@evil.example/x.png"],
    ["the allowed name as a prefix", "https://avatars.githubusercontent.com.evil.example/x.png"],
    ["the allowed name as a suffix", "https://evilavatars.githubusercontent.com/x.png"],
    ["a subdomain of an allowed host", "https://x.avatars.githubusercontent.com/x.png"],
    ["the allowed name in the path", "https://evil.example/avatars.githubusercontent.com/x.png"],
    ["the allowed name in the query", "https://evil.example/?https://avatars.githubusercontent.com/x.png"],
    ["plain http", "http://avatars.githubusercontent.com/x.png"],
    ["no scheme, another host", "//evil.example/x.png"],
    ["no scheme, an allowed name as a username", "//avatars.githubusercontent.com@evil.example/x.png"],
    ["slash and backslash", "/\\evil.example/x.png"],
    ["backslashes for slashes", "https:\\\\evil.example\\x.png"],
    ["a backslash before the @", "https://avatars.githubusercontent.com\\@evil.example/x.png"],
    ["a backslash ending an allowed host", "https://evil.example\\.avatars.githubusercontent.com/x.png"],
    ["a tab in the scheme", "ht\ttps://evil.example/x.png"],
    ["a tab in the host", "https://avatars.github\tusercontent.com/x.png"],
    ["a newline in the host", "https://avatars.github\nusercontent.com/x.png"],
    ["a carriage return in the slashes", "https:/\r/evil.example/x.png"],
    ["a tab turning relative into another host", "/\t/evil.example/x.png"],
    ["a leading space", " https://avatars.githubusercontent.com/x.png"],
    ["a null byte", "https://avatars.githubusercontent.com\u0000.evil.example/x.png"],
    ["a port on an allowed host", "https://avatars.githubusercontent.com:8443/x.png"],
    ["a trailing dot", "https://avatars.githubusercontent.com./x.png"],
    ["a password on an allowed host", "https://a:b@avatars.githubusercontent.com/x.png"],
    ["a password with no username", "https://:b@avatars.githubusercontent.com/x.png"],
    ["a username on Stave's own", "https://a@stave.live/x.png"],
    ["github.com outside uploads", "https://github.com/ada/ada/releases/download/v1/x.png"],
    ["a github.com avatar address", "https://github.com/ada.png"],
    ["climbing out of uploads", "https://github.com/user-attachments/assets/../../ada/x.png"],
    ["climbing out, encoded", "https://github.com/user-attachments/assets/%2e%2e/%2e%2e/ada/x.png"],
    ["GitHub's image proxy", "https://camo.githubusercontent.com/abc/def"],
    ["a signed upload that expires", "https://private-user-images.githubusercontent.com/1/a.png?jwt=x"],
    ["Stave on another scheme", "http://stave.live/x.png"],
    ["Stave on another port", "https://stave.live:444/x.png"],
    ["a data image", "data:image/png;base64,AAAA"],
    ["a blob, whose origin is the page's", "blob:https://stave.live/abc"],
    ["javascript", "javascript:alert(1)"],
    ["empty", ""],
    ["not a URL", "https://"],
  ];
  it.each(REFUSED)("refuses %s", (_name, src) => {
    expect(allowedImageSrc(src, PAGE)).toBeNull();
  });

  it("a data: image on a page with no origin still isn't its own", () => {
    expect(allowedImageSrc("data:image/png;base64,AAAA", "about:blank")).toBeNull();
  });

  it("Stave's own is whatever site the page is on, http included for local use", () => {
    expect(allowedImageSrc("/x.png", "http://localhost:3000/")).toBe("http://localhost:3000/x.png");
    expect(allowedImageSrc("https://stave.live/x.png", "http://localhost:3000/")).toBeNull();
  });

  const IN_MARKDOWN: Array<[name: string, markdown: string]> = [
    ["another host", "![cat](https://evil.example/x.png)"],
    ["a username", "![cat](https://github.com@evil.example/x.png)"],
    ["a prefix", "![cat](https://avatars.githubusercontent.com.evil.example/x.png)"],
    ["plain http", "![cat](http://avatars.githubusercontent.com/x.png)"],
    ["no scheme", "![cat](//evil.example/x.png)"],
    ["a path", "![cat](https://evil.example/avatars.githubusercontent.com/x.png)"],
    ["an escaped backslash", "![cat](https:\\\\evil.example/x.png)"],
    ["a backslash the markdown eats", "![cat](https://avatars.githubusercontent.com\\@evil.example/x.png)"],
    ["an encoded tab", "![cat](https://evil&#9;.example/x.png)"],
    ["an encoded newline", "![cat](https://avatars.github&#10;.evil.example/x.png)"],
    ["a tab in angle brackets", "![cat](<https://evil\t.example/x.png>)"],
    ["a reference", "![cat][1]\n\n[1]: https://evil.example/x.png"],
    ["a data image", "![cat](data:image/png;base64,AAAA)"],
  ];
  it.each(IN_MARKDOWN)("through the markdown, %s becomes its alt text", (_name, markdown) => {
    const root = dom(markdown);
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent!.trim()).toBe("cat");
  });

  it("an allowed image reaches the page normalised, with no referrer", () => {
    const img = dom("![me](HTTPS://Avatars.GitHubUserContent.com/u/1)").querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://avatars.githubusercontent.com/u/1");
    expect(img.getAttribute("alt")).toBe("me");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("a relative image is read against the page it's on", () => {
    const img = dom("![t](/api/gallery/a/thumbnail)").querySelector("img")!;
    expect(img.getAttribute("src")).toBe(`${window.location.origin}/api/gallery/a/thumbnail`);
  });

  it("a refused image with no alt text leaves nothing behind", () => {
    const root = dom("a ![](https://evil.example/x.png) b");
    expect(root.querySelector("img")).toBeNull();
    expect(root.innerHTML).not.toContain("evil.example");
    expect(root.textContent).toBe("a  b");
  });

  it("alt text stays text when the image is refused", () => {
    const root = dom("![<img src=x onerror=alert(1)>](https://evil.example/x.png)");
    expect(root.querySelector("img")).toBeNull();
    expect(handlerAttrs(root)).toEqual([]);
  });

  it("links are unaffected: a link to any site stays a link", () => {
    const a = dom("[site](https://evil.example/x)").querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://evil.example/x");
  });

  it("a link around a refused image keeps the link and shows the alt text", () => {
    const root = dom("[![cat](https://evil.example/x.png)](https://ada.example.com)");
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("a")!.getAttribute("href")).toBe("https://ada.example.com");
    expect(root.querySelector("a")!.textContent).toBe("cat");
  });

  describe("with no DOM to filter in", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("nothing is rendered, rather than the images unfiltered", () => {
      vi.stubGlobal("document", undefined);
      expect(renderMarkdown("![cat](https://evil.example/x.png)")).toBe("");
    });
  });
});
