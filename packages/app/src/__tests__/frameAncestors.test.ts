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
});
