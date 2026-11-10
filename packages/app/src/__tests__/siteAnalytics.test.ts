import { describe, expect, it } from "vitest";

import { withoutPrivateParts } from "../app/SiteAnalytics";

// #2407 — a private link's key is after the `#`; it must never be in a page view.
describe("withoutPrivateParts", () => {
  it("drops a short private link's key", () => {
    expect(withoutPrivateParts("https://stave.live/s/AAAAAAAAAAA#the-key")).toBe("https://stave.live/s/AAAAAAAAAAA");
  });
  it("drops a long link's whole project", () => {
    expect(withoutPrivateParts("https://stave.live/#share=H4sIAAAA")).toBe("https://stave.live/");
  });
  it("drops the query string", () => {
    expect(withoutPrivateParts("https://stave.live/docs?a=1#b")).toBe("https://stave.live/docs");
  });
  it("leaves an ordinary address alone (control)", () => {
    expect(withoutPrivateParts("https://stave.live/docs/guide")).toBe("https://stave.live/docs/guide");
  });
});
