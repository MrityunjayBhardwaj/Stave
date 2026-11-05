// @vitest-environment jsdom
/**
 * #2319 — on a profile: who may edit once sign-in exists (the signed-in author,
 * or a key from before sign-in), and the badge (GitHub handle linked, or
 * "Google account", with the avatar as a plain <img>).
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { VerifiedBadge } from "../GalleryProfile";
import { editAccess, githubProfileUrl } from "../profileModel";

afterEach(cleanup);

describe("who may edit, with sign-in", () => {
  const held = { name: "Ada", email: "a@x.io", authorId: "old1", authorKey: "k" };

  it("the signed-in author, with no key sent", () => {
    expect(editAccess("auth1", null, "auth1")).toEqual({ canEdit: true, key: null });
  });

  it("another signed-in account may not", () => {
    expect(editAccess("auth2", null, "auth1")).toEqual({ canEdit: false, key: null });
  });

  it("a key from before sign-in still edits its own profile, signed in or not", () => {
    expect(editAccess(null, held, "old1")).toEqual({ canEdit: true, key: "k" });
    expect(editAccess("auth2", held, "old1")).toEqual({ canEdit: true, key: "k" });
    expect(editAccess(null, held, "auth1")).toEqual({ canEdit: false, key: null });
  });
});

describe("the badge", () => {
  it("links a GitHub handle to github.com/<login> and shows the avatar", () => {
    const { container } = render(
      <VerifiedBadge verified={{ provider: "github", login: "ada-l", avatarUrl: "https://avatars.githubusercontent.com/u/1" }} />,
    );
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://github.com/ada-l");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.textContent).toBe("GitHub @ada-l");
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://avatars.githubusercontent.com/u/1");
    expect(img.getAttribute("alt")).toBe("");
    expect(container.querySelector("[data-gallery-verified]")!.getAttribute("data-gallery-verified")).toBe("github");
  });

  it("a Google account says so, with no link", () => {
    const { container } = render(<VerifiedBadge verified={{ provider: "google" }} />);
    expect(container.textContent).toBe("Google account");
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("a login that isn't a GitHub handle's shape is never put in a link", () => {
    expect(githubProfileUrl("ada")).toBe("https://github.com/ada");
    expect(githubProfileUrl("../evil")).toBeNull();
    expect(githubProfileUrl("a/b")).toBeNull();
    expect(githubProfileUrl("-ada")).toBeNull();
    expect(githubProfileUrl(undefined)).toBeNull();
    const { container } = render(<VerifiedBadge verified={{ provider: "github", login: "a/b" }} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("GitHub account");
  });
});
