// @vitest-environment node
// #2347 — every page and route says only Stave may frame it.
import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("frame-ancestors", () => {
  it("is sent on every path, as 'self'", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const everywhere = rules.find((r) => r.source === "/:path*");
    expect(everywhere).toBeDefined();
    const csp = everywhere!.headers.filter((h) => h.key.toLowerCase() === "content-security-policy");
    expect(csp).toHaveLength(1);
    const directives = csp[0].value.split(";").map((d) => d.trim());
    expect(directives).toContain("frame-ancestors 'self'");
    // the cross-origin isolation headers are still there beside it
    const keys = everywhere!.headers.map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(["Cross-Origin-Opener-Policy", "Cross-Origin-Embedder-Policy"]));
  });

  // The preview's page replaces the header (the last match wins), so it has to
  // say frame-ancestors again; the browser tests can't see a frame it stopped checking.
  it("is still sent on the preview's page, which has its own policy", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const directives = policyOf(rules, "/gallery-player");
    expect(directives).toContain("frame-ancestors 'self'");
  });
});

/** The policy a path ends up with: Next applies matching rules in order, so the last one wins. */
function policyOf(rules: Awaited<ReturnType<NonNullable<typeof nextConfig.headers>>>, path: string): string[] {
  const matching = rules.filter((r) => r.source === "/:path*" || r.source === path);
  const csp = matching.flatMap((r) => r.headers.filter((h) => h.key.toLowerCase() === "content-security-policy"));
  return csp[csp.length - 1].value.split(";").map((d) => d.trim());
}

// #2374 — what may appear in a frame. A wrong list breaks an embed quietly; each
// entry has a browser test (gallery-sandbox.spec.ts, start-screen-intro.spec.ts).
describe("frame-src", () => {
  it("lists exactly what the app embeds, on every page", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(policyOf(rules, "/")).toContain(
      "frame-src 'self' https://www.youtube-nocookie.com https://challenges.cloudflare.com",
    );
  });

  it("allows no frame on the preview's page, where the entry's code runs", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(policyOf(rules, "/gallery-player")).toContain("frame-src 'none'");
    // the rule comes after the general one, or it would lose to it
    expect(rules.findIndex((r) => r.source === "/gallery-player")).toBeGreaterThan(
      rules.findIndex((r) => r.source === "/:path*"),
    );
  });
});

// #2461 — Firefox refuses the sandboxed preview's page unless it allows a
// cross-origin load; the browser tests run Chromium, which never noticed.
describe("Cross-Origin-Resource-Policy", () => {
  it("lets the sandboxed preview frame load its page", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const corp = rules
      .filter((r) => r.source === "/:path*" || r.source === "/gallery-player")
      .flatMap((r) => r.headers.filter((h) => h.key.toLowerCase() === "cross-origin-resource-policy"));
    expect(corp.map((h) => h.value)).toEqual(["cross-origin"]);
  });
});
